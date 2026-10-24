"""Shared per-request output budget policy. Profiles retain their normal chat settings.

Arithmetic (see docs/DECISIONS.md D-058):
- Dialogue: a reply is at most `maxBeatsPerReply` (3 for Maya) beats of <= 600 characters plus JSON
  keys. Worst case Japanese (~1-1.5 tokens/character) is ~2.7k tokens, plus ~150 JSON-overhead
  tokens; reasoning models (Gemini/OpenAI-compatible, Claude with thinking) also spend reasoning
  tokens from the same cap. 600 was therefore a truncation hazard, so dialogue is requested with
  max(profile budget, DIALOGUE_MIN_OUTPUT_TOKENS). It is only a cap; unused tokens cost nothing.
- Artifact: the store accepts <= 64 KiB. 16,384 tokens ~ 48 KiB of dense code, ~64 KiB of English
  prose, ~35-45 KiB of CJK. It is also the largest output limit common to supported
  OpenAI-compatible models (e.g. 16,384), so a larger cap would turn into HTTP 400s. A completed
  response over 64 KiB (rare: whitespace-heavy output) fails cleanly as `artifact_too_large`; a
  response cut off at the cap fails as `output_token_limit`. Neither is ever stored.
"""

from .base import GenerationSettings, OutputWorkload

DIALOGUE_MIN_OUTPUT_TOKENS = 4096
TEXT_ARTIFACT_OUTPUT_TOKENS = 16384


def settings_for_workload(settings: GenerationSettings, workload: OutputWorkload) -> GenerationSettings:
    values = settings.model_dump()
    if workload == OutputWorkload.TEXT_ARTIFACT:
        values["max_tokens"] = max(settings.max_tokens, TEXT_ARTIFACT_OUTPUT_TOKENS)
    else:
        values["max_tokens"] = max(settings.max_tokens, DIALOGUE_MIN_OUTPUT_TOKENS)
    return GenerationSettings.model_validate(values)
