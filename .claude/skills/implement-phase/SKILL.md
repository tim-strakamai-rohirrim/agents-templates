---
name: implement-phase
description: >-
  Implement a single phase from a PLAN.md document. Reads the plan and contracts,
  creates the phase branch, implements each step, runs verification, and commits.
  Use when the user says "implement phase", "do phase N", "start phase", "code
  phase", or wants an agent to execute a plan phase.
---

# Implement Phase

Pick up a single phase from a `*-PLAN.md` document, implement it, and commit.

## Inputs

The user provides:
- **Phase number** (required) — which phase to implement.
- **Ticket ID** (required if not inferrable) — e.g. `PRCR-1260-v2`.
- **Git user** (optional, defaults to extracting from `git config user.name`).

## Workflow

### Step 1 — Load phase context

1. Locate the plan: `{TICKET}-PLAN.md` at the workspace root.
2. Locate the contracts: `{TICKET}-contracts.md` at the workspace root.
3. Parse the `phase-meta` YAML block for the requested phase to extract:
   - `files` — all files this phase touches
   - `contracts` — which contract sections to read
   - `depends_on` — prerequisite phases
   - `verification` — commands to run after implementation
   - `repo` — which repo this phase targets
4. Read the **phase context summary** at the bottom of the plan (the compact
   paragraph for this phase). This is your briefing — it tells you what prior
   phases produced and what to watch out for.
5. Read the **step checklist** for this phase (the `- [ ]` items).

### Step 2 — Read the contracts

From the contracts doc, read only the sections listed in the phase's `contracts`
field. These give you exact TypeScript interfaces, DTOs, SQL DDL, error messages,
and response shapes. **Match these exactly** — do not deviate from the contracts.

Also read the **Contract → Phase mapping table** at the top to confirm you have
the right sections.

### Step 3 — Verify prerequisites

For each phase in `depends_on`:
- Check that its branch exists: `git rev-parse --verify {user}/{ticket}/phase-{M}`
- If a prerequisite branch doesn't exist, stop and tell the user.

### Step 4 — Set up the branch

Use the `stacked-branches` skill (read `.claude/skills/stacked-branches/SKILL.md`)
to create or switch to the phase branch.

If the branch already exists and has commits, check it out and continue from
where it left off (the phase may be partially implemented from a prior run).

**If your invoking prompt says another agent holds this repo's primary
checkout** (parallel phases or a concurrent AI review cycle), do not switch
branches there. Create a dedicated worktree of the nested repo and do all
work inside it:

```bash
cd {repo_path}
git worktree add ../{repo-name}-{TICKET}-phase-{N} -b {user}/{ticket}/phase-{N} {base_ref}
```

For `rohan_api` worktrees, the gitignored `.env`, `.env.test`, and
`scripts/add_user_local.sql` are missing — copy them from the primary before
running verification (read
`.claude/skills/copy-rohan-api-worktree-files/SKILL.md`). Leave the worktree
in place when done (PR creation pushes from it) and include its path in your
report.

### Step 5 — Read existing code

Before writing any code, read every file listed in the phase's `files` array.
Also read any files that existing code in those files imports or depends on, to
understand the patterns in use (decorators, error handling, naming conventions,
test structure).

For test files, also read a few existing tests in the same file to match the
style, mocking patterns, and assertion approach.

### Step 6 — Implement

Work through the step checklist (`- [ ] 1.1`, `- [ ] 1.2`, etc.) in order.

For each step:

1. Read the step description and any sub-bullets for detail.
2. Read the relevant contract section for exact shapes.
3. Make the code change.
4. If the step mentions a test, write the test.

**Implementation rules**:

- Follow the existing code patterns in the file — match indentation, naming,
  decorator usage, import style, and error handling.
- Use the exact type names, field names, error messages, and status codes from
  the contracts doc.
- Prefer `Number()` over `parseInt()`.
- Prefer `fakeAsync`/`tick` over `setTimeout` for async test assertions.
- Use the latest Angular syntax supported by the project.
- Use Angular's `formatDate` for timestamp formatting.
- Prefer private helper class functions when they exist and fit the use case.
- Do not add narrating comments (no "// Import the module", "// Handle the error").
- Do NOT reference the plan or contracts docs in code comments (no "// per PLAN.md
  phase 3", "// see contracts"). The plan document is not generally accessible, so
  such references are dead links to readers. Write comments that explain intent,
  non-obvious decisions, and tricky logic on their own terms.
- Run the linter after substantive edits to catch issues early.

### Step 7 — Verify

Run every command in the phase's `verification` array:

```bash
# Example for a NestJS phase:
npm run lint
npm run test -- src/compliance/compliance.service.spec.ts
npm run test -- src/compliance/compliance.controller.spec.ts
```

If any verification fails:
1. Read the error output.
2. Fix the issue.
3. Re-run the failing command.
4. Repeat until all verifications pass.

Do **not** commit until all verifications pass.

### Step 8 — Commit

Use the `git-commit` skill (read `.claude/skills/git-commit/SKILL.md`) to commit.

The commit message should follow this format:
```
{TICKET} [{MODULE}] {short imperative description}

Phase {N}: {phase title from plan}
```

Determine the module name from the phase's files (e.g. files under
`src/compliance/` → `Compliance`). See `create-pr` skill for the full
module mapping table.

Example:
```
PRCR-1260 [Compliance] Add converted_html_key column to compliance_documents

Phase 1: Store converted HTML key
```

### Step 9 — Report

After committing, report to the user:

1. **Steps completed** — list each step and its status.
2. **Files changed** — `git diff --stat HEAD~1`.
3. **Verification results** — pass/fail for each command.
4. **Branch** — current branch name.
5. **Next phase** — what phase comes next and its prerequisites.

## Handling partial phases

If you run out of context or hit an issue you can't resolve:

1. Commit what you have so far (if it passes lint).
2. Report which steps are done and which remain.
3. The user (or a subsequent agent) can resume by re-invoking this skill
   for the same phase — Step 4 will detect the existing branch and continue.

## Repo-specific commands

| Repo | Lint | Test (single file) | Test (all) |
|------|------|--------------------|------------|
| `rohan_api` | `npm run lint` | `npm run test -- path/to/file.spec.ts` | `npm run test` |
| `rohan_ui` | `npm run lint` | `ng test --include=path/to/file.spec.ts` | `npm run test:ci` |
| `rohan_python_api` | `uv run bash scripts/lint.sh` | `uv run pytest path/to/test.py` | `uv run bash scripts/test.sh` |

## Important constraints

- Do **not** modify files outside the phase's `files` list without good reason
  (e.g. a shared import file). If you must, note it in the report.
- Do **not** skip steps. If a step seems wrong or impossible, stop and ask.
- Do **not** modify the plan or contracts documents.
- Do **not** push branches — that's handled by `create-pr`.
- Respect the contracts exactly. If the contract says the error message is
  `"Document not found or does not belong to this project."`, use that exact string.
