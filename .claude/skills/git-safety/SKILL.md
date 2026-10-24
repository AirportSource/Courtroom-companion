---
name: git-safety
description: Safely use Git in the Courtroom Companion repository, especially around untracked game assets and cross-machine sync. Use before destructive Git operations, asset moves, commits, pulls, resets, or ignore-rule changes.
---

# Git Safety

## Rules
- Run `git status` before risky operations.
- Never use `git reset --hard`, `git clean -fd`, force push, or destructive checkout without explicit user approval.
- Never delete untracked assets as cleanup.
- Check `.gitignore` and `git check-ignore -v <path>` when files seem missing.
- Before renaming/moving assets, search repository references.
- Do not commit or push unless explicitly requested.
- Do not rewrite history unless explicitly requested.

## Cross-machine asset debugging
If an asset exists on one machine but not another:
1. verify `Test-Path` / filesystem existence;
2. verify whether Git ignores it;
3. verify whether it is tracked with `git ls-files`;
4. verify it appears in the intended commit;
5. only then diagnose pull/branch/remote issues.

## Validation before commit
- inspect staged diff;
- ensure no secrets, build output, or accidental large unrelated files;
- confirm requested assets are staged.
