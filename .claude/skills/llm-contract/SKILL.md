---
name: llm-contract
description: Design or modify the structured contract between the conversational LLM and Courtroom Companion. Use for schemas, model outputs, validation, emotion/effect/music intent, or LLM integration.
---

# LLM Contract

## Principle
The LLM proposes semantic intent. The application validates and executes it.

The LLM must not directly choose arbitrary filesystem paths or execute UI/audio actions.

## Example conceptual response
```json
{
  "text": "Oh! I see the problem.",
  "emotion": "happy",
  "intensity": "normal",
  "effect": null,
  "musicMood": "calm"
}
```

## Rules
- Use a strict schema.
- Enumerate supported values where practical.
- Validate all model output.
- Unknown emotion/effect/music values must fall back safely.
- Keep dialogue text separate from presentation metadata.
- Do not expose arbitrary local paths or executable commands through model output.
- Do not make the renderer depend on a specific LLM vendor.

## Scope
Do not implement the LLM backend unless explicitly requested. This skill also governs schema design before backend integration.
