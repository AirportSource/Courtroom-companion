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
canvas measurer reads the CSS-applied 16px Igiari → DotGothic16 stack and the metrics from
`ui.json` after both bundled fonts load; system Japanese fonts are tertiary fallbacks. Geometry
comes from `engine/dialogueLayout.ts`, which
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

## Semantic SFX (D-049)

Segments may carry `"sfx": "<name>"` (closed set: surprise, shock, realization, comic, emphasis, tension, notification, soft_transition), chosen from `performance.json` `sfx`:

```json
"sfx": { "maxPerReply": 1, "minIntensity": 0.75,
         "reactions": { "shocked": "shock", "shock": "shock", "surprise": "surprise",
                        "realization": "realization", "comic": "comic", "emphasis": "emphasis" },
         "emotions": { "surprised": "surprise", "excited": "emphasis", "playful": "comic", "happy": "comic" },
         "emotionMinIntensities": { "surprised": 0.55, "excited": 0.60, "playful": 0.70, "happy": 0.70 } }
```

Rules:
- Explicit semantic reactions select their named sound without requiring the emotion fallback threshold, regardless of the separate visual-reaction cooldown/cap. Visual one-shots retain the existing threshold, cooldown and per-reply cap so they cannot overplay.
- Emotion-only fallbacks use their configured per-emotion threshold. Ordinary anxious, neutral, calm and thinking beats stay silent unless explicitly mapped.
- At most one sound per segment. Explicit semantic reactions are not silenced by the emotion-fallback cap; `maxPerReply` limits only fallback sounds.
- A suppressed inferred visual reaction may still receive its moderate mapped emotion sound. Director diagnostics record the beat values, selected sound or suppression reason.
- Deterministic. The shared provider-independent prompt requests semantic reactions only at genuinely theatrical moments.

The frontend plays audio.json event `sfx_<name>` once, on the segment's first page only, before text reveal while a visual reaction is underway. Dev builds show event playback outcomes and provide audition buttons; production UI has neither.

## Waiting performance (D-049)

`character.json` `waiting` names the pose shown while a reply is generated (Maya: `thinking` / `thinking_side`, idle loop, no reaction).

## Signature SFX (character-specific sounds)

A character may own a sound that is not in the global set, for example a whip crack. It is data in
`performance.json` `sfx.signature` (at most 4 per character), with no character names in code:

```json
"sfx": {
  "reactions": { "emphasis": "emphasis" },
  "signature": [
    { "id": "whip", "reactions": ["whip_crack", "emphasis"], "emotions": [],
      "minIntensity": 0.85, "cooldownTurns": 5, "maxPerReply": 1 }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | `^[a-z][a-z0-9_]{1,31}$`, never one of the global names. The frontend plays audio.json event `sfx_<id>`. |
| `reactions` / `emotions` | Triggers (OR): the reaction the model asked for is listed, **or the visual one-shot that survived the reaction rules is** (so the sound syncs with the animation, e.g. `whip_crack`), or the beat's resolved emotion is. At least one valid trigger is required. |
| `minIntensity` | The beat needs this intensity (default 0.7). |
| `cooldownTurns` | Replies that must stay free of this sound after a use (default 3). With 4 it plays on replies 1, 6, 11. |
| `maxPerReply` | Uses per reply (default 1). |

Resolution per beat: **signature override** (eligible and out of cooldown) -> explicit semantic
reaction sound -> emotion fallback sound -> silence. While a signature is cooling down the beat
falls back to the character's ordinary semantic sound, so a strong beat still has some feedback.
`notes` records every signature decision (used, skipped for intensity, per reply, cooldown).

**Where the cooldown lives.** The director stays a pure function of `(reply, profile, state)`.
`DirectorState` gained `turn` and `signature_last_turn`; `CharacterService` keeps it in
`_sessions[(session_id, character_id)]` next to the existing reaction-cooldown state, so the
cooldown is per conversation and per character, needs no history replay and is reset with the
backend process (as the reaction cooldown is). `direct(..., signatures=False)` is for stateless
callers.

**Frontend.** The director emits the id as `sfx`. `engine/sfx.ts` accepts a name only if it is a
global semantic name or a registered signature: `loadAudio()` registers every audio.json event
named `sfx_<id>` that is not global. Unknown, malformed or unmapped names are dropped by the
parser and are silent no-ops. `validate-assets` checks that each `signature` id has the audio
event and that triggers resolve.

## Readiness

`character.json` `"readiness": "asset-only" | "partial" | "ready"`.

- Backend (`CharacterRepository`): declared level, capped by the files (`ready` needs both
  `personality.md` and `performance.json`; if absent the level is derived the same way).
  `service.chat` uses `get_for_chat` and refuses anything not chat-allowed with
  `CharacterNotReadyError` (a `CharacterNotFoundError`, so the API answers 404); `ids()` lists
  chat-allowed packs. `partial` packs chat only with `COURTROOM_ALLOW_PARTIAL_CHARACTERS=1`;
  `asset-only` never does. `capabilities` includes `readiness`.
- Frontend: a missing/unknown value counts as `partial` (the browser cannot see the other
  files). `loadCharacterSummaries` and `CharacterSelectScreen` list `ready` only in production;
  development builds also list `partial` with a `[WIP]` marker; `asset-only` is never listed.
  Optional `group` (e.g. `"aa1"`) orders the menu by game.
- The select list scrolls (`MenuList`, `maxHeight = visibleRows x rowHeight`), so the number of
  characters is not limited by the 256x192 screen.
- Music: a character's theme stays in `music/soundtrack.json` `profiles`, keyed by character id;
  nothing about music is stored in `character.json`.

## Presentation context integration (D-087, 2026-10-26)

Character identity ≠ presentation context. The Director still emits semantic emotion/animation/reaction IDs for the same character. Frontend `selectPresentation` projects explicit conversation/courtroom group data before the existing resolver. Unavailable stable poses fall back inside that group; reactions use group → shared character collection → existing semantic fallback. No source paths enter the Director. Waiting and render placement may vary by group. Legacy packs including Maya are unchanged. Franziska's shared whip reaction, signature sound, anger trigger and cooldown remain intact. Schema, sources and regression evidence: [migration report](PRESENTATION_DS_MIGRATION.md).

## Restrained realization and Pearl SFX tuning (2026-10-26, D-090)

Semantic realization now includes actual understanding of a useful clarification/detail, without requiring a theatrical beat. Routine acknowledgment or correction alone stays quiet; no keyword classifier was introduced. Prompt guidance chooses one clear realization, and the Director suppresses repeated explicit realization SFX within the same reply while retaining other explicit semantic behavior. Frontend realization event selects the supplied lightbulb WAV.

Pearl remains data-driven: strong positive states→soft_transition; strong playful/laughing→comic; original surprise fallback retained. The one-fallback-per-reply limit and sensitive/low-intensity quiet cases remain. Franziska signature threshold/cooldown unchanged; its single event now contains timed swing+impact. Tests, exact thresholds and listening limitations: `TARGETED_CORRECTIONS.md`.

## Whip ownership, shared sounds and frequency (2026-10-26, D-091/D-092)

- A signature with `performs` owns that reaction: firing sets the reaction (its effect cues play whip then whack), not eligible drops it. Inbox events (`signatures=False`) never perform it.
- Resolution of WHICH sound: character `semanticSounds` -> shared audio.json pools -> global `sfx_<name>`. WHEN: explicit request (strong) or emotion fallback (threshold, `maxPerReply`, `fallbackCooldownTurns`, `categoryCooldownTurns`, drought allowance).
- Shared names for every character: surprise, shock, realization, comic, emphasis, angry, flabbergasted, encouragement (+ aliases scared, insightful, you_can_do_it).
- Dev panel lines show requested name, character, character/shared candidates, final sound, played or why not, plus the director's SFX notes (cooldowns).
