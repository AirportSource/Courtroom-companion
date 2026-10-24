---
name: asset-pipeline
description: Manage Courtroom Companion sprites, backgrounds, UI images, audio, music, and asset manifests. Use when importing, organizing, renaming, validating, or referencing runtime assets.
---

# Asset Pipeline

## Purpose
Maintain a stable runtime asset library for Courtroom Companion.

## Runtime location
Prefer runtime assets under `frontend/public/assets/` unless the repository already establishes another convention.

## Rules
- Never invent filenames or paths.
- Verify every referenced asset exists before adding it to a manifest.
- Never delete source assets merely because they appear unused.
- Search code/manifests before moving or renaming an asset.
- Use stable logical IDs separate from physical filenames.
- Prefer lowercase snake_case identifiers for logical asset IDs.
- Preserve original pixel art without smoothing or destructive resampling unless explicitly requested.
- Keep character-specific data inside character packs where practical.

## Character asset concepts
Prefer:
- logical emotion;
- pose/animation;
- `idle` and `talking` variants where available;
- one-shot reactions for transient animations.

## Audio concepts
Separate:
- dialogue blips;
- UI SFX;
- reaction/effect SFX;
- music.

## Workflow
1. Inventory the real files.
2. Detect duplicates and naming inconsistencies.
3. Propose a mapping before destructive renames.
4. Apply minimal changes.
5. Generate/update manifests from real files only.
6. Validate every manifest path.

## Validation
- no broken manifest paths;
- no duplicate logical IDs;
- no manifest entry for a missing file;
- no accidental deletion of untracked assets;
- browser-accessible runtime paths resolve correctly.
