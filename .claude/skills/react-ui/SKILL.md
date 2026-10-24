---
name: react-ui
description: Build and maintain the Courtroom Companion React/TypeScript frontend and Ace Attorney-style scene UI. Use for components, state, rendering, responsive layout, or frontend architecture.
---

# React UI

## Principles
- Use TypeScript.
- Keep visual components focused.
- Keep domain logic out of JSX when practical.
- Reuse generic renderers driven by manifests/configuration.
- Do not hard-code a single character into generic components.
- Keep runtime asset URLs separate from component logic.

## Suggested responsibilities
- `GameScene`
- `BackgroundRenderer`
- `CharacterRenderer`
- `DialogueBox`
- `TypewriterText`
- controls/settings
- audio/state services

Names are suggestions; preserve superior existing architecture.

## Pixel art
Avoid browser interpolation that makes sprites blurry. Preserve intended aspect ratio and scene layering.

## Validation
Run the project's actual frontend checks, normally including build/typecheck/lint if present.
