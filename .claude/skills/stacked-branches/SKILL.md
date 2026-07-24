---
name: stacked-branches
description: >-
  Manage stacked git branches for phased implementation plans. Create phase
  branches, check stack status, and propagate changes downstream. Use when the
  user says "create phase branch", "start phase", "stack status", or when the
  implement-phase skill needs to set up a branch. For bringing an already-pushed
  stack (open PRs) up to date with main, use the rebase-stacked-prs skill.
---

# Stacked Branches

Manage a stack of git branches where each phase of a plan gets its own branch,
built on top of the previous phase. PRs target the previous phase's branch,
forming a reviewable chain.

## Branch naming convention

```
{user}/{ticket}/phase-{N}
```

Examples: `tim/PRCR-1260/phase-1`, `tim/PRCR-1260/phase-2`

## Prerequisite: find the plan

Before any operation, locate the plan document:

1. If the user specifies a ticket (e.g. "PRCR-1260"), look for `*PRCR-1260*-PLAN.md` at the workspace root.
2. If not specified, check the current git branch name for a ticket pattern (`PRCR-\d+` or `ROH-\d+`) and search for the matching plan.
3. Parse `phase-meta` YAML blocks from the plan to build the phase list.

## Operations

### 1. Create a phase branch

**Trigger**: "create phase branch", "start phase N", or called by `implement-phase`.

**Input**: phase number (N), ticket ID, git user name.

**Steps**:

1. Determine the **git root** of the current working directory:
   ```bash
   git rev-parse --show-toplevel
   ```

2. Read the plan and extract the `phase-meta` block for phase N.

3. Determine the **base branch**:
   - If `base_branch: base` → use the current branch (the branch checked out when work started — typically `feature/`, `develop`, or `main`). Detect it:
     ```bash
     git branch --show-current
     ```
   - If `base_branch: phase-M` → use `{user}/{ticket}/phase-{M}`. Verify it exists:
     ```bash
     git rev-parse --verify {user}/{ticket}/phase-{M}
     ```
     If it doesn't exist, stop and tell the user phase M must be created first.

4. Create the branch:
   ```bash
   git checkout -b {user}/{ticket}/phase-{N} {base_ref}
   ```
   Where `{base_ref}` is the resolved base branch name.

5. Confirm:
   ```bash
   git log --oneline -1
   git branch --show-current
   ```

### 2. Check stack status

**Trigger**: "stack status", "show branches", "phase branches".

**Steps**:

1. Parse the plan for all phase numbers and the ticket ID.

2. For each phase, check if the branch exists and its ahead/behind status relative to its base:
   ```bash
   git rev-parse --verify {user}/{ticket}/phase-{N} 2>/dev/null
   ```

3. For branches that exist, show commit count and last commit:
   ```bash
   git log --oneline {base}..{user}/{ticket}/phase-{N}
   ```

4. Display a summary table:
   ```
   Phase | Branch                        | Status          | Commits | Base
   ------|-------------------------------|-----------------|---------|------------------
   1     | tim/PRCR-1260/phase-1         | exists (current)| 3       | feature/
   2     | tim/PRCR-1260/phase-2         | exists          | 2       | phase-1
   3     | tim/PRCR-1260/phase-3         | not created     | -       | phase-2
   ```

### 3. Propagate changes downstream

**Trigger**: "rebase stack", "rebase downstream", "update stack after phase N changed".

This is needed when you add commits to an earlier phase (or to `main`) and need
to update all phases that stack on top of it.

> **If any branch in the stack has an open PR or has been pushed, use the
> [`rebase-stacked-prs`](../rebase-stacked-prs/SKILL.md) skill instead.** It
> propagates via **merge commits** (no force-push) and also handles the case
> where an earlier phase was squash-merged into `main`. A literal `git rebase`
> rewrites SHAs and would require force-pushing every branch — which is denied
> in this workspace.

For **local-only, not-yet-pushed** stacks, propagate with merges (still no
rebase, so the flow is identical to the pushed case):

1. Identify the changed phase (N) and all downstream phases from the plan's
   `depends_on` chain.

2. For each downstream phase in order (N+1, N+2, ...), merge the parent in:
   ```bash
   git checkout {user}/{ticket}/phase-{M}
   git merge --no-edit {user}/{ticket}/phase-{M-1}
   ```

3. If a merge has conflicts:
   - Stop and report the conflicting files.
   - Do **not** force-resolve. Tell the user which phase and files conflict.
   - Run `git merge --abort` to leave the branch in a clean state.

4. After all merges succeed, check out the branch the user was on before the
   operation.

### 4. Switch to a phase branch

**Trigger**: "switch to phase N", "checkout phase N".

```bash
git checkout {user}/{ticket}/phase-{N}
```

Verify the branch exists first. If not, offer to create it.

## Detecting the user and ticket

- **User**: extract from the current branch if it matches `{user}/...`, or from git config:
  ```bash
  git config user.name
  ```
  Use the first name, lowercased (e.g. "Tim Smith" → "tim").

- **Ticket**: extract from the plan filename, current branch name, or ask the user.

## Multi-repo awareness

This workspace may contain multiple git repos and worktrees. The skill operates on
whichever repo the current working directory belongs to. If the plan's `phase-meta` specifies
a `repo` field (e.g. `rohan_api`, `rohan_ui`), verify you're in the right repo before
creating branches.

## Important rules

- **Never force-push** or rewrite shared/remote history.
- **Never delete** phase branches without explicit user request.
- When creating branches, always verify the base branch exists first.
- If a phase depends on multiple prior phases (`depends_on: [1, 3]`), use the highest-numbered phase as the base (the stack is linear even if the plan has fan-in dependencies).
- Stacked branches are local by default. Pushing happens via the `create-pr` skill.
