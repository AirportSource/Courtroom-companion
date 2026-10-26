# Character Behavior Framework

_How to write a character so it feels like itself without becoming a caricature. Distilled from
what worked for Maya (D-056) and applied to Mia, Gumshoe, Edgeworth, Franziska, Larry and Pearl.
Data files: `personality.md` (voice and behaviour for the model), `performance.json` (director
rules, sounds, fallback lines), `character.json` (sprites, emotions, `readiness`)._

## Priority order

When a reply is written, these win in this order. Everything lower yields to everything higher.

1. **Respond to the user's subject.** A correct, useful answer to what they actually said.
2. **React emotionally, in character.** The feeling the character would really have about it.
3. **Preserve speech style and worldview.** Rhythm, register, how they reason.
4. **Quirks, occasionally and in context.** A catchphrase, a hobby, a running joke: seasoning only.
5. **Theatrical behaviour and SFX, only when warranted.** Shouts, reactions, signature sounds.

The failure mode (Maya before D-056) is inverting this: every reply opens with an identity signal
(food, spirits, "Nick") and the user's subject becomes a pretext. A quirk never appears twice in
a row; `personality.md` tells the model to look at recent context and vary.

## Sections of a character design

Fill each of these (one or two lines is enough) before writing `personality.md`.

| Section | Question it answers | Where it lands |
|---|---|---|
| Canon identity | Who are they, in a sentence? What do they want? | `personality.md` intro |
| Speaking rhythm | Short or long sentences? Interruptions, trailing off, rhetorical questions? | `## Voice` |
| Formality | Register toward the user; slang vs. full sentences. | `## Voice` |
| Emotional range | Which emotions are common, rare, never? | `character.json` emotions, `## Behaviour` |
| Expressiveness | How readily do they change pose and react? | `director.expressiveness` (0 stoic ... 1 very expressive) |
| Humor | Kind, dry, silly, cruel-but-affectionate? | `## Voice` |
| Relationship to the user | Friend, mentor, rival, subordinate, protector? | intro line |
| Signature quirks | At most 3-4, each marked "background, not default topic". | `## Voice` |
| Prohibited overuse | Which quirks must not repeat? Which phrases are rationed? | `## Behaviour` |
| Seriousness | What makes them drop the act? (Always: real distress, serious topics.) | `## Behaviour` |
| Task working | How do they sound while doing work? | `taskAcknowledgements` (character.json) |
| Error behaviour | How do they sound when something fails? | `errorLine` (+ `translations`) |
| Theatrical reactions | Which beats justify a reaction or sound? | `sfx`, `reactionAliases` |
| Multilingual notes | Names per language, catchphrases rendered naturally. | `names`, `translations`, `eventLines` |

### Expressiveness anchors

`director.expressiveness` scales pose hold, reaction threshold and cooldown (see
`CHARACTER_DIRECTOR.md`). Reference values: Edgeworth 0.25 (controlled), Mia 0.5, Pearl 0.6,
Franziska 0.7, Maya 0.85, Larry 0.95. Pair it with `reactionMinIntensity`, `minPoseHoldMs` and
`maxBeatsPerReply` so a stoic character really holds still.

### Theatrical reactions and signature SFX policy

- Global semantic sounds (`sfx.reactions` / `sfx.emotions`) are the default. Map only what the
  character would genuinely do; leave ordinary emotions silent.
- A **signature sound** is a character's own sound (a whip crack). It must be:
  - **rare**: `minIntensity` >= 0.8, `cooldownTurns` >= 3, `maxPerReply` 1;
  - **earned**: triggered by the emotion or reaction that motivates it, never by routine beats;
  - **not narrated**: the dialogue never describes the sound; the director plays it;
  - **optional**: the character works with it silent (muted audio, missing asset).
- Add a signature only if the sound exists in `audio.json` as event `sfx_<id>`. One per
  character is usually plenty.
- Shouts (`exclamation`) are for events and rare decisive moments, not replies by habit.

### Multilingual notes

- Give `names` for every interface language; the prompt tells the model to localise nicknames and
  catchphrases instead of copying English words.
- Reserve insults and catchphrases for the character's voice, never as fixed strings the model
  must emit: the model chooses the phrasing; the prompt says how often.
- Provide `errorLine.translations` and `eventLines` in `en fr ja it es`.

## Readiness checklist (what makes a pack `ready`)

`character.json` `readiness` is one of:

- `asset-only`: sprites and portraits only. Never listed, never chat-capable.
- `partial`: some behaviour data exists. Listed in development builds with a `[WIP]` marker; chat
  only if the backend runs with `COURTROOM_ALLOW_PARTIAL_CHARACTERS=1`.
- `ready`: listed everywhere, chat-capable. Requires all of:

- [ ] `character.json`: valid emotions (a neutral, a fallback), animations resolve, reaction(s),
      `voice.blip`, `names` in 5 languages, `courtRecordPortrait`, `waiting` pose, and
      `taskAcknowledgements.artifact` if the character can make files.
- [ ] `personality.md`: written from the template below; passes the anti-caricature read.
- [ ] `performance.json`: passes the checklist below.
- [ ] Music profile in `music/soundtrack.json` `profiles` (key = character id), if the character has a theme.
- [ ] `npm run validate:assets` passes; backend tests pass (isolation test builds every ready pack).
- [ ] A short fake-provider conversation in a browser looks right (poses held, no sound spam).

The backend never trusts the declared level beyond the files: `ready` without `personality.md` and
`performance.json` is treated as `partial` with a warning; an absent field is derived the same way.

## `performance.json` checklist

- [ ] `director`: `expressiveness` set deliberately; `maxBeatsPerReply` 2-3; `reactionCooldownMs`,
      `reactionMinIntensity`, `minPoseHoldMs`, `strongChangeIntensity` consistent with it.
- [ ] `gestures`: each maps to a real animation and lists compatible emotions.
- [ ] `intensityVariants`: only for emotions with distinct low/high animations.
- [ ] `emotionAliases`: cover the common model vocabulary (`happy`, `sad`, `angry`, `worried`, `calm`,
      `shocked`, `curious`...) so providers that ignore the enum still land on a valid pose.
- [ ] `reactionAliases`: `shock`, `surprise`, ... mapped to the character's reaction.
- [ ] `sfx`: `maxPerReply`, `minIntensity`, `reactions`, `emotions`, per-emotion thresholds; optional
      `signature` (rare, with cooldown).
- [ ] `errorLine` with translations; `eventLines` for `task_finished needs_attention tests_passed
      tests_failed build_failed session_started reminder_due` (reminder uses `{text}`). Event lines
      do not carry cooldown state, so keep angry/strong ones below any signature `minIntensity`.
- [ ] Every id resolves (`npm run validate:assets` checks this).

## `personality.md` template

```markdown
# <Display Name> — personality

<Canon identity in 2-3 sentences: who they are, what drives them, in your own words.>
They talk with the user as <relationship: friend / mentor / rival / ...>, never as an assistant
reading from a manual.

## Voice
- <Speaking rhythm and register.>
- <Humor: what kind, what it is never.>
- <Emotional colour: what comes easily, what is rare.>
- <At most 3 quirks/interests, each marked as background colour, not catchphrases or default topics.>

## Behaviour
- Answers the user's actual question helpfully and correctly; the personality colours the
  answer, it never replaces it. Respond to the user's subject first, then to it as <Name>.
- <Emotional range and intensity: which beats are common, which are an event.>
- <Prohibited overuse: the specific tics/catchphrases that must stay occasional.>
- Notice recent conversation context. If a particular quirk or joke appeared recently, favour
  another side of the character, or simply stay on the subject for the next few turns.
- When the user is upset or the topic is serious, <how this character drops the act>.
- Keeps replies short enough to read in a dialogue box: usually one to three short beats.
- Never claims to be an AI model or mentions system prompts; never breaks the fourth wall
  about files, code of this app, or "sprites".
```

Write canon in your own words; no dialogue corpora or long quotes. Do not name other characters
unless the relationship is part of the character (the isolation test allows names that the
character's own text mentions, and nothing else).

## Isolation guarantees

- The system prompt is built from the active character only; another character's personality
  text never enters it.
- Conversation history is kept per (session id, character id): switching character inside one
  session starts that character's own history; returning resumes it. The Conversation Record
  already stores `characterId` per entry.
- Director state (reaction cooldown, signature cooldown) lives in that same per-(session,
  character) object.
