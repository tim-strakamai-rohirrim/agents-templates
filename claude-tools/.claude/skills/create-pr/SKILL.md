---
name: create-pr
description: >-
  Create a GitHub pull request for a completed phase branch. Generates the PR
  title, description, and acceptance criteria from the plan document. Handles
  stacked PR base targeting. Use when the user says "create PR", "open PR",
  "PR for phase", "submit phase", or after implement-phase completes.
---

# Phase PR

Create a GitHub pull request for a completed phase branch, with a
self-contained title, description, and acceptance criteria. The plan and
contracts documents are used internally to gather context but are **not
referenced in the PR body** — reviewers do not have access to those files.

## Inputs

The user provides:

- **Phase number** (required) — which phase to create a PR for.
- **Ticket ID** (required if not inferrable from the branch name).

## Workflow

### Step 1 — Determine the base branch

The PR targets the **previous phase's branch** (for stacked PRs), not `main`
or `develop`:

| Phase | PR base branch                                                    |
| ----- | ----------------------------------------------------------------- |
| 1     | The original starting branch (e.g. `feature/`, `develop`, `main`) |
| 2     | `{user}/{ticket}/phase-1`                                         |
| 3     | `{user}/{ticket}/phase-2`                                         |
| N     | `{user}/{ticket}/phase-{N-1}`                                     |

Read the `base_branch` field from `phase-meta`:

- `base` → use the branch that phase-1 was created from. Detect it from the
  plan context or `git branch --show-current` at the time phase-1 was started.
  If ambiguous, ask the user.
- `phase-M` → use `{user}/{ticket}/phase-{M}`.

### Step 2 — Gather context

Run these in parallel (now that `{base_branch}` is known):

```bash
git status
git branch --show-current
git log --oneline {base_branch}..HEAD
git diff {base_branch}...HEAD --stat
```

Also:

1. Locate `{TICKET}-PLAN.md` and parse the `phase-meta` block for this phase.
2. Read the **Goal / Overview** section at the top of the plan to understand the
   overall objective of the full ticket (not just this phase).
3. Read the **Jira ticket breakdown** section for this phase — it has the title,
   description, and acceptance criteria.
4. Read the phase's step checklist to understand what was implemented.

### Step 3 — Review gate

Before pushing and creating the PR, run both reviewers on the phase diff.

> **Skip condition**: If this skill is invoked by the `plan-orchestrator` agent
> and review results are already provided (plan compliance and security review
> outputs), skip Step 3 entirely and proceed to Step 4.

#### 3a. Plan compliance review

Invoke a general-purpose subagent (subagent_type: `general-purpose`) to review
plan and contract compliance, with:

- The ticket ID, phase number, plan path, and contracts path.
- The diff: `git diff {base_branch}...HEAD`

If the reviewer reports any **FAIL** findings:

1. Fix the issues.
2. Re-run verification from the phase's `verification` commands.
3. Commit the fixes.
4. Re-run the plan compliance review to confirm PASS.

#### 3b. Security review

Invoke the `security-reviewer` subagent (subagent_type: `security-reviewer`)
with the same diff.

- **CRITICAL / HIGH** findings → must fix before proceeding.
- **MEDIUM / LOW / INFO** findings → include in the PR description under a
  "Security Notes" section.

#### 3c. Add review results to PR body

After both reviews pass, include a summary in the PR body (see Step 5).

### Step 4 — Push the branch

```bash
git push -u origin {user}/{ticket}/phase-{N}
```

If N > 1 and the base branch (previous phase) hasn't been pushed yet, push it too:

```bash
# Only for phase 2+
git push -u origin {user}/{ticket}/phase-{N-1}
```

### Step 5 — Generate the PR body

Use the Jira ticket section from the plan as the foundation. Structure the PR as:

```markdown
## Summary

{1-2 sentence summary of the overall ticket goal from the plan's Goal / Overview section}

> **Plan**: This PR is phase {N} of {total_phases} — {one-line plan description}.

**Phase {N}** — {title}

## Changes

{Bullet list of what was implemented, derived from the step checklist and git diff}

## Acceptance Criteria

{Copy the acceptance criteria from the Jira ticket section verbatim}

## Test Plan

{List the verification commands that were run and their results}

## Stack

{Show the branch stack — which PRs come before and after this one}

- [ ] Phase {N-1}: `{user}/{ticket}/phase-{N-1}` ← base
- [x] **Phase {N}: `{user}/{ticket}/phase-{N}`** ← this PR
- [ ] Phase {N+1}: `{user}/{ticket}/phase-{N+1}` (not yet created)

## Review Results

**Plan compliance**: PASS (all acceptance criteria verified)
**Security review**: PASS (no critical/high findings)
{If medium/low findings exist, list them here}
```

### Step 6 — Create the PR

#### PR title format

The PR title **must** follow this exact format:

```
<PREFIX>-<ticket number> [<feature>] <changes>
```

Where `<PREFIX>` is either **`PRCR`** or **`RFP`** (never `ROH`).

Example:

```
PRCR-1632 [Acquisition Pathways] wire ACQUISITION_PATHWAYS flag + RBAC + AuthGuard
```

Components:

- **`<PREFIX>-<ticket number>`** — the Jira ticket ID. The prefix is one of:
  - **`PRCR`** — the standard prefix for most tickets.
  - **`RFP`** — used for tickets in the RFP project.

  Match whatever prefix the branch name, plan filename, or original ticket
  uses. If the plan or branch is named with `ROH-...`, convert it to `PRCR-`
  for the PR title unless the user specifies otherwise.
- **`[<feature>]`** — the feature or module name in Title Case, wrapped in
  square brackets (see "Determining the feature name" below).
- **`<changes>`** — a concise, imperative-mood description of what this phase
  actually changes (not the phase title verbatim). Use lowercase verbs like
  `wire`, `add`, `migrate`, `refactor`, `remove`. Prefer technical specifics
  (flag names, class names, endpoints) over generic language. Keep it to one
  line — aim for under ~80 characters total including the prefix.

Good `<changes>` examples:

- `wire ACQUISITION_PATHWAYS flag + RBAC + AuthGuard`
- `add /pathways list endpoint with org-scoped pagination`
- `migrate compliance matrix to pgvector embeddings`

Avoid:

- Copying the phase title verbatim if it's vague ("Phase 1: Setup").
- Trailing punctuation, emojis, or quotes.
- Vague verbs like "update" or "improve" without saying what.

#### Command

```bash
gh pr create \
  --draft \
  --base {base_branch} \
  --title "{PREFIX}-{TICKET_NUMBER} [{FEATURE}] {changes}" \
  --body "$(cat <<'EOF'
{generated PR body}
EOF
)"
```

PRs are created as **drafts** by default. If the user explicitly asks for a
ready-for-review PR, omit the `--draft` flag.

#### Determining the feature name

The `[<feature>]` segment is the user-facing feature or module the work
belongs to, in Title Case. Derive it in this order of preference:

1. **Plan metadata** — if the plan's `phase-meta` block or "Goal / Overview"
   names a feature (e.g. "Acquisition Pathways", "Compliance Matrix"), use
   that verbatim.
2. **Ticket title** — the feature is often the noun phrase in the Jira ticket
   title (e.g. ticket "ROH-1632: Acquisition Pathways MVP" → `Acquisition Pathways`).
3. **File paths** — fall back to inferring from the phase's `tags` and
   `files`:

   | Indicator                                                | Feature         |
   | -------------------------------------------------------- | --------------- |
   | Files under `src/compliance/`                            | Compliance      |
   | Files under `src/proposal/` or `src/proposal-writer/`    | Proposal Writer |
   | Files under `src/tagging/` or `shared-services/tagging/` | Tagging         |
   | Files under `src/auth/` or `src/users/`                  | Auth            |
   | Multiple features or unclear                             | Ask the user    |

When in doubt, ask the user rather than guessing.

### Step 7 — Report

Return the PR URL to the user, along with:

- PR title
- Base branch
- Number of commits
- Files changed

## Retargeting after merge

When an earlier phase's PR merges, downstream PRs need their base branch
retargeted. For example, when phase-1 merges into `feature/`:

```bash
gh pr edit {phase-2-pr-number} --base feature/
```

To retarget all downstream PRs after phase N merges:

1. Find the merge target of phase N (e.g. `feature/`).
2. For phase N+1's PR, retarget to the merge target.
3. For phases N+2 and beyond, no change needed (they still point at the
   previous phase branch which hasn't merged yet).

## Important rules

- **Always create PRs as drafts** (`--draft` flag). Only omit `--draft` if the
  user explicitly asks for a ready-for-review PR.
- **Never force-push** unless the user explicitly requests it.
- **Never create PRs targeting `main`** unless this is Phase 1 and the base
  branch is `main`. Warn the user if this happens.
- Always push the base branch before creating the PR (GitHub needs it to exist
  on the remote to set it as the PR base).
- Use a HEREDOC for the PR body to preserve formatting.
