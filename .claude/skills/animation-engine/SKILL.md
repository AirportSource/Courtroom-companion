---
name: animation-engine
description: Implement or modify Courtroom Companion sprite animation behavior, especially idle/talking cycles, one-shot reactions, frame timing, and state transitions.
---

# Animation Engine

## State model
Typical flow:

`idle -> talking -> idle`

Temporary reaction:

`idle/talking -> reaction(one-shot) -> previous or resolved idle`

## Rules
- Distinguish looping animations from one-shot reactions.
- Use one animation controller per rendered character.
- Avoid independent unmanaged `setInterval` calls scattered across components.
- Clean up timers/animation frames when components unmount or state changes.
- Preserve pixel-art rendering.
- If a requested animation is missing, fall back safely.
- Talking state should be driven by dialogue playback state, not guessed from text content.

## Timing
Animation FPS belongs in character/animation data where possible rather than hard-coded globally.

## Validation
Test:
- initial idle;
- start talking;
- end talking;
- change emotion while idle;
- change emotion while talking;
- reaction and return;
- missing animation fallback.
