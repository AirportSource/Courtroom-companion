---
name: character-engine
description: Design or modify the generic Courtroom Companion character-pack and emotion/animation system. Use for character manifests, emotion maps, adding characters, or avoiding Maya-specific hardcoding.
---

# Character Engine

## Goal
The engine must support Maya, Phoenix, Edgeworth, and future custom characters without rewriting the renderer.

## Core principle
Application logic consumes logical character state, not hard-coded Maya filenames.

## Preferred abstraction
A character pack may define:
- id;
- display name;
- default pose;
- emotion map;
- animation definitions;
- audio/blip configuration;
- optional personality metadata.

## Rules
- Never hard-code Maya-specific paths in generic renderer components.
- Resolve logical emotion -> animation through character data.
- Provide safe fallbacks, normally `neutral`.
- Missing optional animations must not crash the application.
- Character-specific configuration belongs in data/manifests, not conditionals scattered through React.

## Validation
Adding a second mock character should require data/assets, not renderer rewrites.
