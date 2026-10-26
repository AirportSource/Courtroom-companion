# Character Emotional Behavior System

The Iris/Franziska experiment is generalized through the existing `CharacterProfile`,
pack loader, system-prompt composition and CharacterDirector. This remains experimental
behavioral guidance, not proof of emotional authenticity or a deterministic intent classifier.

## Coverage and grounding

The authoritative roster is `frontend/public/assets/characters/index.json`. Every current
ready character has a dedicated `emotional_boundaries.json` beside `personality.md`:

| ID | Baseline and individually grounded themes | Available bundled sources |
|---|---|---|
| `maya_fey` | Warm, energetic, open; being taken seriously, sincere private worries | Personality |
| `dick_gumshoe` | Earnest, loyal, occasionally awkward; competence and financial dignity | Personality |
| `mia_fey` | Composed, perceptive mentor; protective privacy, responsibility and honest doubt | Personality |
| `miles_edgeworth` | Formal, controlled and fair; standards, admitting error, private warmth | Personality |
| `franziska_von_karma` | Proud, competitive, guarded; comparisons and perfection pressure | Personality |
| `larry_butz` | Expressive, optimistic buddy; romantic embarrassment and creative self-worth | Personality |
| `pearl_fey` | Polite, earnest child; learning uncertainty and protective privacy | Personality |
| `iris` | Gentle, quietly strong; Phoenix feelings/deception, family loyalty and guilt | Personality and canonical lore |

None currently use the missing-profile fallback. Future/legacy packs without a profile keep
their existing personality/prompt/performance behavior exactly. Asset-only/partial readiness
rules are unchanged. A valid conservative profile may have **zero sensitive topics**; missing
biography is not a reason to fabricate trauma, private relationships or a confession subject.

No other bundled lore or speech-example files were found in the current roster. The themes
above are explicitly labeled **interpretations of supplied personality**, not new canon.
Private wiki PDFs and local source archives were not read or copied. Approved lore overlays
continue through the existing read-only merge path and remain separate from behavior guidance.
Pearl's profile requires wholesome, non-romantic, child-appropriate interaction.

## Configuration format

The optional v1 format retains all pilot fields: `schemaVersion: 1`, `characterId`,
`presentation: "conversation"`, `interpretation`, `narrativeScope`, `style`, `encourages`,
`discourages` and `topics`. Each topic records `id`, `referents`, `basis`, `sensitivity`,
`defense`, `disclosure`, `private` and valid `emotions`.

Two **optional additive** fields improve reusable temperament/interaction guidance:

- `temperament`: baseline disposition and normal openness; not every character is reserved.
- `responses`: the five named styles `reassurance`, `confrontation`, `criticism`, `affection`,
  `intrusion`. These describe tendencies, not mandatory lines or a lexical classifier.

Old v1 profiles without these fields still load. `topics` can be empty; invented secrets
are never required for completeness. Strict bounded types reject unknown fields, malformed
versions (including booleans), wrong character identity, duplicate topics and unknown emotions.
Files are bounded to 12 KB. Invalid optional data logs a character/file/field diagnostic and
disables that profile atomically; chat continues with the previous behavior.

`COURTROOM_EMOTIONAL_BOUNDARIES=1` enables loading. Unset preserves the merged prototype's
existing default of enabled; this milestone does **not** change that default. `0`, `off`,
or `false` disables the system. Restart the backend or invalidate the repository cache after
changing flags or pack files; already cached profiles do not reload on their own.

## Context and assistant reliability

One shared policy interprets the current message, referent and visible conversation:

1. General assistance and the user's own distress: helpful answers in character, without
   requiring personal disclosure or aggressive performance.
2. Canonical questions: known facts/identity stay known; discomfort never licenses denial or
   invented history. Respect the supplied narrative point and uncertainty.
3. Personal feelings: context-sensitive openness, indirectness or a limit fitting this character.
4. Intrusion/repetition: maintain a proportionate boundary, without mistaking constructive
   criticism or clarification for hostility. Repetition and politeness never unlock intimacy.
5. Topic changes: resume useful help; don't remain embarrassed, angry or evasive indefinitely.

Mixed requests preserve their practical/factual part. Affection never establishes a new
romantic relationship with the user. Existing supported artifact/tool paths stay available;
asking for a document cannot manufacture personal canon. Emotions/gestures remain in the
existing provider-independent reply schema. No additional model call or third-party dependency.

## History decision and limits

Existing `_Session` stores a deque of **12 messages (roughly six exchanges)** and Director
state under `(session ID, character ID)`. `fit_history` may remove older entries to meet its
16,000 cost-unit budget. Tests demonstrate that a turn older than that window is dropped;
an earlier personal boundary can therefore be forgotten. No summarizer currently exists.

We retain this bounded design rather than introduce guessed emotional state, keyword-derived
trust, or extra retention of sensitive material without demonstrated real-conversation need.
There is no new emotional memory, numerical trust, permanent relationship storage or context
growth. Topic independence is a prompt instruction, **not** a guaranteed model decision.
Session/character history isolation is deterministic; browser sessions use random UUIDs.
This is a local application, not a new authenticated multi-user service: API clients must not
reuse session IDs between different users. Restarting/remounting may start a fresh conversation.

## Performance and legacy packs

Legacy single-presentation packs keep their existing top-level animation/emotion/gesture
capabilities; no asset-manifest migration is required. Grouped packs use the declared
conversation group. Gestures and intensity variants that target a different group are excluded
from advertised/emitted capabilities (including Edgeworth's legacy courtroom gestures).
Unknown returned metadata still passes through the existing gateway repair and Director.
Existing reaction/signature thresholds and cooldowns are unchanged. No new sprites, audio,
frontend layout or Japanese-reading changes.

## Testing and manual evaluation

Dynamic backend tests enumerate the actual registry and verify all ready profiles, distinct
temperament/interaction guidance, original lore preservation, enabled/disabled modes, legacy
and missing-profile compatibility, conservative empty topics, invalid optional fields,
all emotion/animation combinations, task return/history transport and interleaved isolation.
Existing pilot-specific and artifact tests remain. These use scripted provider output where
needed and **do not establish natural emotional behavior**.

`backend/tests/fixtures/emotional_realism_scenarios.json` now contains **22 multi-turn cases**:
the original 16 plus one for each additional character, including French/Japanese, reassurance,
criticism/pressure and return to technical help. Review expectations are not generated answers.
The rubric's quality scores remain null until actual model transcripts are reviewed.

The existing `scripts/evaluate_emotional_realism.py` supports all these data-driven cases.
By default it exports prompts with **zero model calls**; `--execute` plus explicit catalogue,
profile ID and a bounded case selection is required for a live run. Use `--baseline` and a fresh
output filename for comparison. No private lore overlays are imported by that evaluation runner.
See the [original experiment guide](EMOTIONAL_CHARACTER_REALISM_EXPERIMENT.md) for commands.
An all-roster export can be made with `--out build/all-character-prompts.json` (omit `--execute`).

Real-LLM conversation testing remains partial. No realism score or universal accuracy is claimed.
Older limits can be forgotten; model adherence, contextual interpretation, variation and emotional
subtlety require actual evaluation before calling this behavior production-proven.

Automated validation for this milestone: **825 backend tests passed, 4 skipped**; **396 frontend
tests passed**; TypeScript, lint, production build, asset validation (**990 referenced files,
zero errors**) and `git diff --check` passed. The skips concern private Iris PDF prerequisites
and Windows symlink privileges. Optional original soundtrack files are not installed in the
isolated checkout. Both complete 22-case prompt exports completed with zero model calls.
