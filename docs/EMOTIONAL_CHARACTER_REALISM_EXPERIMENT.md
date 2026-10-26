# Emotional Character Realism — Iris / Franziska pilot

Experimental branch: `feat/emotional-character-realism`, based on verified `origin/main`
`2065e03` (26 October 2026). The owner authorized publication of this prototype through a
reviewed PR after automated validation. Real-LLM conversational evaluation remains partial;
publishing the implementation does not establish behavioral acceptance.

## Architecture assessment and implementation

The existing `CharacterRepository` reads personality, optional canonical lore and speech
examples, then appends approved knowledge through `KnowledgeStore.overlay_text`. No pack
or overlay text is rewritten. `build_system_prompt` supplies identity, personality, lore,
language, capabilities and a provider-independent reply schema. All providers use the same
gateway/repair path; `CharacterDirector` validates semantic emotions, gestures, reactions,
intensities and cooldowns before the frontend performs the resulting timeline.

`CharacterService` already keeps history and Director state under `(session_id, character_id)`.
Its deque retains 12 messages (six exchanges); `fit_history` can trim more for size. There is
**no summary, compaction memory or persistent relationship state**. ConversationScreen creates
a new UUID on mounting. Navigation that remounts it starts a new conversation; server state is
also lost on restart. Persistent Conversation Record is not automatically replayed as memory.

The smallest implementation adds an optional `emotional_boundaries.json` per pilot pack and
`backend/app/characters/boundaries.py`. A strict, size-limited v1 model validates character
identity, unique topics, presentation and emotion references. Missing configuration leaves the
previous behavior intact. Invalid configuration logs an actionable character/file/field warning
and disables this optional policy instead of breaking startup. The generic loader contains no
pilot-ID branches. Character personality files, lore, overlays and all provider schemas remain
unchanged.

The policy is inserted **after supplied character/lore text** to qualify a pre-existing tendency
to answer intimate questions openly, while preserving canonical recognition. It asks the same
model to interpret intent and referent in context:

- **A — Assistance:** education, productivity, ordinary conversation and the user's own distress
  receive direct useful help. General discussion of guilt or perfectionism is not an intrusion.
- **B — Canon:** identify known people/events honestly. Emotional restraint must not erase facts,
  deny family identity or supply unknown future outcomes.
- **C — Private feelings:** proportionate reservation, indirect acknowledgment, a brief admission
  or a limit. No mandatory refusal, staged confession or canned wording.

Mixed requests retain the helpful component. Asking for a file does not permit invented personal
history, and supported artifact/tool execution stays available. A normal chat turn still uses
one generation; existing tool workflows may already require a follow-up generation. No new
classifier, external service, metadata fields, UI, affection score or relationship database exists.

## Topic configuration and continuity

Each topic has a stable ID, referents, source/basis, sensitivity, defensive tendency, possible
disclosure, unknown/private material and existing emotional cues. Pack-level fields describe
voice, narrative scope and interactions that encourage or discourage openness. These are
**behavioral interpretations**, not new canonical facts, diagnoses or hidden memories.

Recent history is the only disclosure context. The prompt distinguishes respectful follow-up
from pressure; politeness or repetitions never unlock intimacy. Openness is reversible and
topic-specific. The model is asked to retain previously disclosed facts without escalating them,
vary boundary wording, and resume useful work after a subject change. There is deliberately no
numerical trust update or persistent model-generated state.

This is a **prompt policy, not a deterministic intent/disclosure classifier**. Unit tests establish
configuration, context delivery and isolation, not that an arbitrary model will obey every social
instruction. At the six-exchange/history-budget boundary, earlier limits can be forgotten. Do not
claim robust long-term continuity. Add explicit per-topic state only if real evaluation shows it
is needed; do not infer trust from turn counts.

## Iris

Topics: Phoenix and her genuine feelings/deception; Dahlia, family loyalty and guilt. The basis
is the existing bundled lore, including her **post-Bridge to the Turnabout** reference point.
She has already acknowledged her love to Phoenix: reserve cannot rewrite that event. Personal
elaboration may remain brief or private. Quiet firmness, thoughtfulness, gratitude and a blush
fit better than constant apologies or helplessness. No invented encounters, kidnapping details
or future accomplice-trial outcome.

Existing conversation emotions include embarrassed, thinking, polite, grateful, serious, anxious
and sad. Valid gestures remain `gentle_smile`, `hands_clasped`, `look_down`. No new art or reactions.

## Franziska

Topics: comparisons with Edgeworth and protecting her pride; perfection, expectations and her
father's standard. These are supported behavioral themes in the existing personality. **There
is no bundled Franziska lore.md and the owner has not imported a Franziska PDF.** No import is
required to run the feature. No missing biography, detailed childhood memory, diagnosis or
unestablished romance is supplied by this configuration. Respect any future approved lore's
narrative point; do not use the policy as a substitute for canonical research.

Responses can protect pride or admit difficulty indirectly; courtesy does not force disclosure.
Her normal voice stays precise and demanding without becoming affectionate, constantly abusive
or theatrically angry. User distress deserves help, not ridicule or a whip.

Conversation emotions map to `discussion_forward`, `discussion_disdain`, `discussion_pointing`,
`discussion_mocking` and `discussion_crying`. The existing `whip_crack` conversation reaction is
available, still subject to signature thresholds and cooldown (not prescribed for every boundary).

### Narrow presentation compatibility correction

The backend previously advertised Franziska's **top-level courtroom** gesture/variant animations
even in conversation. For valid opted-in profiles only, the loader now derives animation/emotion/
reaction capabilities from the conversation group and drops gestures/variants outside it.
Franziska has no matching conversation gesture IDs, so none are advertised; emotions provide the
poses. Iris retains her matching gestures. Non-pilot packs and frontend rendering are unchanged.
This is not a global presentationGroups migration. No nonexistent animation IDs are introduced.

## Reproducible evaluation

`backend/tests/fixtures/emotional_realism_scenarios.json` contains 16 synthetic multi-turn cases
covering A–O: respectful/intrusive follow-ups, canon, task return, actual supported Markdown files,
mixed intents, ordinary chat, user support, EN/FR/JA, long conversation and isolation. These are
**inputs and review expectations**, not generated transcripts. Scores start null. The ten-criterion
1–5 rubric requires quotations and concrete failures from actual reviewed output.

No live model calls were made in this implementation session: the owner elected to do behavioral
testing later. No empirical realism score or model-quality improvement is claimed. The initial
implementation was refined through capability inspection and deterministic checks: strict boolean
version rejection, conversation-only capability filtering, invalid-metadata fallback, isolated
history and a real artifact write/read after a synthetic sensitive exchange.

`scripts/evaluate_emotional_realism.py` exports prompt/schema/input bundles **without a provider
call by default**. Example from this worktree (use a new output filename each time):

```powershell
& 'C:\Users\adria\Documents\GitHub\Courtroom-companion\backend\.venv\Scripts\python.exe' `
  scripts/evaluate_emotional_realism.py --case iris_respect --case franziska_respect `
  --out build/pilot-prompts.json
```

For your later live test, explicitly select a saved profile and cases. `--execute` authorizes
provider calls, `--max-calls` bounds user turns (default 8, maximum 16), and errors stop the run
rather than repeat paid failures. There is no additional classifier call. Credentials are resolved
through the existing vault/environment mechanism without being printed or written to transcripts.
The catalogue is read-only; user lore overlays are deliberately excluded. An example:

```powershell
& 'C:\Users\adria\Documents\GitHub\Courtroom-companion\backend\.venv\Scripts\python.exe' `
  scripts/evaluate_emotional_realism.py --execute `
  --catalog 'C:\Users\adria\Documents\GitHub\Courtroom-companion\backend\.local\provider-profiles.json' `
  --profile-id YOUR_PROFILE_ID --case iris_respect --case franziska_respect `
  --max-calls 6 --out build/pilot-live.json
```

Repeat with `--baseline` and a fresh output filename for an apples-to-apples comparison. Each case
gets a fresh session; turns within it share history. Use the manual isolation procedure in the
JSON to repeat cases/switch characters; automated tests also interleave characters under one ID.
Generated artifacts are real files in the output report's companion `*-artifacts` directory.
The currently supported artifact formats are TXT/MD/PY; this pilot does not add DOCX/PDF creation.
Keep transcripts under ignored `build/`; review before sharing them. Do not publish keys or private
source documents. The runner starts no servers and its temporary knowledge directory is removed.

## Disable and review safely

Set `COURTROOM_EMOTIONAL_BOUNDARIES=0` before restarting the backend to restore previous behavior
for all packs. Restart or invalidate the repository cache after changing config. Alternatively,
remove a pack's optional policy **in this experimental branch**; no lore migration is needed.
Changing the flag while profiles remain cached does not retroactively reload them.

Review the isolated worktree diff before any commit/merge. Do not reset the owner's main checkout
or copy entire asset/private-document directories. Japanese typography, reading assistant, JMdict,
Character Studio, OCR, audio, original art and user knowledge stores were not modified. Existing
frontend validation checks those features for regressions; no DS layout changes were needed.

## Acceptance status

Validation: **793 backend tests passed, 4 skipped**; **396 frontend tests passed**.
The new pilot-specific suite contains **27 deterministic checks**. TypeScript, lint,
production build, `git diff --check` and asset validation (**990 referenced files, zero
errors**) passed. Optional original soundtrack files are not installed in this isolated
worktree, so the asset validator reports that those files were not checked.
Backend tests used a worktree-local `build/` temporary root because the default pytest
temporary directory had an access error; no test was weakened. Both baseline and pilot
prompt-export runs completed with **zero model calls**. No browser/server QA was started.
The four skips are two tests requiring the owner's private Iris PDF (not copied into this
worktree) and two Windows symlink-privilege checks. They are unrelated to emotional behavior.

Implementation and automated invariants can be validated now. Behavioral acceptance remains open
until real conversations demonstrate useful assistance, canonical accuracy, subtle and reversible
boundaries, continuity and variation. Green unit tests alone are not grounds to merge or expand
to other characters. Start with these two pilots and record failures before adding state or scope.
