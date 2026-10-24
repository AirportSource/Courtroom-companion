# Character Director

_`backend/app/director/director.py`, deterministic and character-independent. Tests:
`backend/tests/test_director.py`._

The LLM proposes **semantic intent** (CharacterReply). The director decides the actual
**performance** (PerformanceTimeline) using only the character's data, so the result is always
valid for that character and avoids puppet-like overacting.

## Emotion vs reaction vs gesture

| Concept | Meaning | Playback |
|---|---|---|
| emotion | stable emotional state (`happy`, `thinking`, `anxious`) | looping idle/talking animation |
| reaction | short one-shot event (`shocked`) | plays once at the start of a segment, then the stable pose |
| gesture | how the emotion is physically expressed (`arms_open`, `clasped_hands`) | replaces the emotion's animation, if compatible |

Example: `{"text": "You're serious?", "emotion": "anxious", "reaction": "shock"}` →
`shocked` reaction → `necklace_anxious` talking → `necklace_anxious` idle.

## Pipeline

1. **No usable reply** → one segment with the character's `errorLine` (text + emotion from
   `performance.json`).
2. **Beat limit**: beats beyond `maxBeatsPerReply` are merged into the last kept beat.
3. **Resolve each beat**:
   - emotion: normalize → alias (`emotionAliases`) → known? else `fallbackEmotion`;
   - intensity clamped to 0–1;
   - gesture: known **and** compatible with the emotion → its animation; otherwise ignored;
   - else the emotion's **intensity variant** (first step with `intensity ≤ maxIntensity`);
   - else the emotion's default animation from `character.json`;
   - reaction: explicit (alias → known) or implied by the emotion binding (e.g. `surprised`
     → `shocked`); unknown → ignored.
4. **Merge / hold** (anti-overacting):
   - consecutive beats with the same emotion and pose and no reaction → **merged**;
   - pose change suppressed (pose held, text kept as its own segment) when the previous
     segment was on screen less than the minimum hold, the new beat has no reaction, and its
     intensity is below `strongChangeIntensity`.
5. **Reactions** (in order): kept only if intensity ≥ threshold, fewer than
   `maxReactionsPerReply` already played, and the cooldown since the last reaction (carried
   across replies in `DirectorState`) has passed. Otherwise removed and noted.
6. **Settle**: valid `settleEmotion` → its pose (or the current pose if it's the same emotion);
   otherwise stay in the last segment's pose.

Every correction is recorded in `notes` (shown in the dev panel, never to users).

## Timing estimates

Segment on-screen time ≈ `600 ms + len(text) × msPerChar`. Used for pose-hold and
cooldown maths only; the frontend still drives real timing.

## Character configuration (`performance.json`)

```json
{
  "director": {
    "expressiveness": 0.85,          // 0 stoic … 1 very expressive
    "maxBeatsPerReply": 3,
    "maxReactionsPerReply": 1,
    "reactionCooldownMs": 8000,
    "reactionMinIntensity": 0.6,
    "minPoseHoldMs": 1200,
    "strongChangeIntensity": 0.65,
    "msPerChar": 40
  },
  "gestures": { "arms_open": { "animation": "arms_open", "emotions": ["explaining", "excited"] } },
  "intensityVariants": { "happy": [ { "maxIntensity": 0.45, "animation": "smile_front" } ] },
  "emotionAliases": { "worried": "anxious" },
  "reactionAliases": { "shock": "shocked" },
  "errorLine": { "text": "…", "emotion": "anxious" }
}
```

Expressiveness scales the rules (no character names in code):
- effective min pose hold = `minPoseHoldMs × (1.5 − expressiveness)`;
- effective reaction threshold = `reactionMinIntensity + (0.5 − expressiveness) × 0.4`;
- effective cooldown = `reactionCooldownMs × (1.5 − expressiveness)`.

So Maya (0.85) changes pose sooner and reacts more readily than a future stoic Edgeworth (~0.2).

### Maya's intensity mapping (real animations only)

| Emotion | ≤ 0.45 | ≤ 0.8 | ≤ 1.0 |
|---|---|---|---|
| happy | smile_front | clasped_hands_happy | excited_front |
| excited | smile_front (≤ 0.4) | excited_front | excited_front |
| laughing | hand_mouth_giggle (≤ 0.5) | clasped_hands_laugh | clasped_hands_laugh |

Other emotions use their default animation at every intensity.

## PerformanceTimeline (output)

```json
{
  "characterId": "maya_fey",
  "segments": [
    { "text": "Wait, WHAT?!", "emotion": "surprised", "animation": "neutral_front",
      "intensity": 0.95, "reaction": "shocked", "gesture": null, "estimatedMs": 1080 }
  ],
  "settle": { "emotion": "happy", "animation": "clasped_hands_happy" },
  "notes": []
}
```

Logical IDs only, with no file paths. The frontend (`engine/performance.ts`) paginates each
segment for the 3-line dialogue box and plays the pages as ordinary `DialogueLine`s with
`animation` / `reaction` overrides through the existing resolver, typewriter, blips and
reaction gate. After the last page the character idles in the settle pose.

## Dialogue pagination (beat ≠ page)

The director decides *how* a beat is performed. The paginator only decides how its text is
divided into DS textboxes. It never changes emotion or pose and never re-runs the director.

**Physical fit.** Lines are measured in **logical stage px** with the real stage font. A
canvas measurer reads the CSS-applied font (Ace Attorney, 16px, letter/word spacing from
`ui.json`) after `document.fonts.load`. Geometry comes from `engine/dialogueLayout.ts`, which
`DialogueBox` also applies:
- 242px text width, 3 lines of 15px, 1px top padding;
- the last line keeps 8px free for the continue arrow;
- 1px safety margin.

The paginator wraps lines itself and emits pages with explicit `\n`, so the browser never
re-wraps into a hidden 4th line. Display scale (1×–auto) is never an input.

**Natural breaks** (in order):
1. whole sentences (`Intl.Segmenter` sentence segmentation); a page never ends mid-sentence just to use leftover space;
2. strong clause boundary (`; : — –` / `；：`) or comma (`, 、 ，`), if the page is at least half as full as a plain word break would make it;
3. a clause or comma with at least a third of the fill when the rest of the sentence then fits one more page;
4. the furthest word break, backing off so the next page doesn't start with a < 6-grapheme orphan;
5. grapheme boundaries for unbroken tokens.

**Locale.**
- Line breaks happen after ordinary spaces (not no-break spaces, so French `Attends !` stays together) and between CJK graphemes.
- No line may start with closing punctuation (`!?.,;:…、。！？」` …) or end with an opening bracket/quote.
- Japanese needs no spaces and gets none inserted.

**Reactions.** Only a segment's first page carries its reaction, so advancing pages never
replays it.


## Multi-beat guidance

The prompt asks for 1–3 beats and a new beat only when the emotion clearly changes. The
director enforces the cap and merges or holds anything that would look hyperactive.
