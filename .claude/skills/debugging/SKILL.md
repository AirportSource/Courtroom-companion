---
name: debugging
description: Debug Courtroom Companion failures systematically. Use for runtime errors, broken assets, animation/audio bugs, build failures, or unexpected behavior.
---

# Debugging

## Workflow
1. Reproduce the issue.
2. Gather the smallest relevant logs/state.
3. Trace the actual execution/path.
4. Form a concrete root-cause hypothesis.
5. Make the smallest justified change.
6. Re-run the reproduction.
7. Run relevant regression checks.

## Rules
- Do not make multiple speculative architectural changes at once.
- Do not hide errors with broad try/catch or silent fallbacks unless that is the intended behavior.
- Do not "fix" missing assets by inventing alternate paths.
- For asset failures, verify exact case-sensitive path and browser URL.
- For React problems, consider lifecycle, rerenders, stale state, and cleanup.
- For audio issues, consider browser autoplay and duplicate playback.

## Report
Explain root cause separately from the fix.
