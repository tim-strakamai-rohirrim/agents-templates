---
name: verification-loop
description: |
  Structured build-test-lint-typecheck verification loop with repo-specific commands.
  Triggers on "verify", "check", "run tests", "lint", "does it pass", "is it working".
---

# Verification Loop

Run verification in this order. If any step fails, fix the issue and re-run from the failing step.

## rohan_api (NestJS)

```bash
cd rohan_api-parent/rohan_api

# 1. Lint
npm run lint

# 2. Build (includes typecheck)
npm run build

# 3. Unit tests
npm run test                          # Full suite
npm run test -- path/to/file.spec.ts  # Single file

# 4. E2E (optional, CI-level)
npm run test:e2e:ci
```

## rohan_ui (Angular)

```bash
cd rohan_ui-parent/rohan_ui

# 1. Lint
npm run lint

# 2. Build (includes typecheck)
npx ng build

# 3. Unit tests
npx ng test --include=path/to/file.spec.ts  # Single file
npm run test:ci                          # Full suite (headless)

# 4. E2E (optional, CI-level)
npm run test:e2e:ci
```

## rohan-python-api (FastAPI)

```bash
cd rohan-python-api/backend

# 1. Lint + typecheck (mypy + ruff check + ruff format --check)
uv run bash scripts/lint.sh

# 2. Unit tests with coverage
uv run bash scripts/test.sh              # Full suite → htmlcov/
uv run pytest path/to/test_file.py       # Single file
uv run pytest -k "test_name_pattern"     # By name

# 3. Format (auto-fix)
uv run bash scripts/format.sh
```

## Rules

### Run Order Matters
Lint catches syntax/style issues cheaply. Build catches type errors. Tests catch logic errors. Run in this order to fail fast.

### Fix Forward, Not From Scratch
If step 3 (tests) fails, fix the test or code, then re-run from step 3. Do not re-run lint and build unless you changed code that could affect them.

### Partial Runs Are Fine
If you only changed Python files, only run the Python verification. If you changed one spec file, run that one test. Full suite is for final verification before committing.

### Never Claim Done Without Evidence
Do not say "all tests pass" unless you ran them and saw the output. Do not say "no lint errors" unless you ran the linter. The output is the proof.

### Cross-Repo Changes
If a change spans multiple repos (e.g., API endpoint + frontend service), verify each repo independently. A passing build in rohan_api does not guarantee rohan_ui still compiles.

### When to Run Full E2E
- Before creating a PR
- After large refactors
- When changing auth, database, or cross-service communication
- NOT on every small change (they're slow)
