---
name: repo-inspector
description: Inspect the Courtroom Companion repository before making changes. Use for repository orientation, unfamiliar code, asset/path verification, architecture discovery, or before broad refactors.
---

# Repo Inspector

## Purpose
Establish the actual repository state before editing anything.

## Source of truth
The filesystem and tracked Git state are authoritative. Do not assume documentation paths are current.

## Workflow
1. Run `git status`.
2. Inspect the repository tree at a useful depth.
3. Read `CLAUDE.md`, `README.md`, `AGENTS.md`, relevant docs, manifests, package files, and `.gitignore`.
4. Identify the files actually involved in the requested task.
5. Search for existing references before renaming, moving, or deleting files.
6. Report contradictions between documentation and repository state.

## Rules
- Never invent a file, asset, directory, command, dependency, or manifest entry.
- Do not create duplicate architecture when an existing implementation already exists.
- Prefer the smallest relevant inspection over reading the entire repository blindly.
- Treat generated folders such as `node_modules`, `dist`, caches, and build outputs as non-source unless explicitly needed.

## Validation
Before editing, be able to state:
- current branch and working-tree state;
- relevant source files;
- relevant asset paths;
- existing conventions that must be preserved.

## Stop conditions
Stop and report rather than guessing when:
- the requested file/asset cannot be found;
- documentation conflicts materially with the filesystem;
- destructive changes would affect untracked or user-created assets.
