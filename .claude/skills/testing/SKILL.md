---
name: testing
description: Validate Courtroom Companion changes with targeted tests, builds, type checks, linting, and runtime checks. Use after code changes or when verifying a fix.
---

# Testing

## Principle
Do not claim a change works merely because the code looks correct.

## Workflow
1. Identify the narrowest relevant validation.
2. Run targeted tests/checks first.
3. Run broader build/lint/type checks when appropriate.
4. Report exact commands and outcomes.
5. Distinguish pre-existing failures from regressions.

## Typical frontend checks
Use only commands that actually exist in `package.json`, such as:
- `npm run build`
- `npm run lint`
- project test command

## Rules
- Never invent test commands.
- Do not silently ignore failures.
- Avoid changing unrelated code just to make an unrelated global check green.

## Final report
State:
- checks run;
- pass/fail;
- remaining warnings/failures;
- anything not tested.
