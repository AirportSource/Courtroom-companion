---
name: audio-engine
description: Implement or modify Courtroom Companion dialogue blips, UI/effect SFX, music playback, looping, volume controls, and crossfades.
---

# Audio Engine

## Architecture
Prefer a centralized audio service/manager rather than `new Audio(...)` throughout React components.

## Categories
- dialogue blips;
- UI sounds;
- reaction/effect SFX;
- music.

## Dialogue blips
- synchronize with typewriter text;
- do not trigger on every whitespace character;
- support throttling/cooldown;
- character config selects the blip;
- allow future pitch/volume variation.

## Music
- maintain one logical active music track;
- avoid duplicate playback when React rerenders;
- support loop playback;
- support fade/crossfade transitions;
- do not restart the same track unnecessarily.

## Rules
- Never reference nonexistent audio files.
- Respect browser autoplay restrictions.
- Keep music volume separate from SFX/blip volume.

## Validation
Test repeated renders, rapid dialogue changes, mute/volume state, track transitions, and cleanup.
