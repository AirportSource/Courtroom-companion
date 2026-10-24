---
name: ace-attorney-behavior
description: Apply the intended Ace Attorney-style presentation behavior for Courtroom Companion. Use when implementing dialogue flow, sprite reactions, typewriter pacing, blips, effects, and music transitions.
---

# Ace Attorney Presentation Behavior

## Dialogue lifecycle
1. Resolve character and emotion.
2. Select idle pose before dialogue if needed.
3. Start typewriter text.
4. Switch to talking animation while text is actively revealing.
5. Play throttled dialogue blips during text reveal.
6. Apply punctuation pauses where supported.
7. When reveal ends, return to the corresponding idle pose.
8. Show continuation indicator.

## Reactions
One-shot reactions may temporarily interrupt idle/talking state and then resolve to an appropriate stable state.

## Effects
Effects such as shock/screen shake are semantic events, not direct arbitrary code from the LLM.

## Music
- avoid changing music every line;
- preserve a track while the scene mood is stable;
- crossfade intentional changes;
- do not restart the already-active track.

## UX principle
Favor the feel of Ace Attorney over unnecessary realism. Text, sprite timing, blips, reactions, and pacing should feel coordinated.
