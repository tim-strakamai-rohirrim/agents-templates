---
name: compare-branches
description: |
  Compare two git branches implementing the same feature in a repository. Produces a
  structured analysis covering data shape, formatting, placement, semantics, and an
  overall verdict with cherry-pick recommendations. Use when the user says "compare
  branches", "which branch is better", "diff two implementations", or names two
  branches to evaluate.
---

# Compare Branches

Compare two branches that implement the same (or overlapping) feature in a single git repository. The goal is an opinionated verdict: what to keep from each, what to discard, and why.

## Prerequisites

Identify from the user's request:
1. **Repository path** — the git repo (or worktree) containing both branches.
2. **Branch A and Branch B** — full ref names (e.g. `tim/tag-ui-column`, `tim/PRCR-1421`).
3. **Common ancestor** — usually `main`; confirm with `git merge-base`.

## Workflow

### 1. Understand the scope

```bash
# Find the merge base
git merge-base <branchA> <branchB>

# Commits unique to each branch (relative to their shared base)
git log --oneline <merge-base>..<branchA>
git log --oneline <merge-base>..<branchB>
```

If branches share a base (common in feature forks), their unique commits are the ones to compare. If they diverged at different points, note this — the comparison is still valid but context matters.

### 2. Extract the diffs

For each branch, get its diff against the common ancestor (or against the commit just before its unique work):

```bash
git diff <branchA>~N..<branchA>   # where N = number of unique commits
git diff <branchB>~M..<branchB>
```

If each branch has only one unique commit, `~1` suffices. For multi-commit branches, diff from the merge base:

```bash
git diff <merge-base>..<branchA>
git diff <merge-base>..<branchB>
```

Read the full content of changed files on each branch when the diff alone doesn't give enough context (e.g. to judge placement within a file).

### 3. Analyze across dimensions

Compare the two implementations across every relevant dimension. Not all dimensions apply to every comparison — skip irrelevant ones.

| Dimension | What to evaluate |
|-----------|-----------------|
| **Data shape / schema** | Field names, types, nesting, redundancy. Prefer minimal shapes with no duplicate semantics. |
| **Formatting / readability** | Code layout, JSON formatting (inline vs multi-line), alignment. Prefer what's easier to read and diff. |
| **Placement / organization** | Where in the file are changes placed? Logical grouping matters (e.g. DDL near table definition). |
| **Semantic correctness** | Do values mean what they claim? Is NULL vs empty-object vs empty-array used correctly? |
| **Idempotency / safety** | For migrations: IF NOT EXISTS, ON CONFLICT, safe re-runs. |
| **Documentation / comments** | Migration notes, sync warnings, rationale comments. Prefer present-and-useful over absent. |
| **Completeness** | Does one branch seed more data, handle more edge cases, or cover more products? |
| **Consistency** | Does the implementation match the conventions of the surrounding codebase? |

### 4. Produce the comparison

Structure the output as:

```
## Comparison: `<branchA>` vs `<branchB>`

[One sentence summarizing what both branches do.]

### N. [Dimension Name]

| Branch | Approach |
|--------|----------|
| `branchA` | [concise description] |
| `branchB` | [concise description] |

**`branchX` is better here.** [1-2 sentences explaining why.]

... repeat for each relevant dimension ...

## Verdict

**`branchX` is the stronger branch overall**, but it should adopt [specific things] from `branchY`. Specifically:

1. **Keep from `branchX`**: [list]
2. **Adopt from `branchY`**: [list]

The ideal result looks like [one sentence describing the merged best-of-both].
```

### 5. Offer next steps

After presenting the verdict, offer actionable follow-ups:

- **"Want me to apply these recommendations?"** — Implement the cherry-picked improvements on the preferred branch.
- **"Want me to update the spec docs to match?"** — If spec/plan/contract docs exist, update them to reflect the chosen approach.
- **"Want me to open a PR?"** — If the work is ready.

## Judgment Principles

When forming opinions, weight these in order:

1. **Correctness** — Wrong is never better than ugly. Semantic accuracy wins.
2. **Simplicity** — Fewer fields, less redundancy, smaller API surface.
3. **Readability** — Future developers must understand this at a glance.
4. **Consistency** — Match what the codebase already does.
5. **Completeness** — Handling edge cases and seeding real data beats leaving TODOs.

## Edge Cases

- **Branches with no shared base**: Compare the full diffs against `main` for each.
- **One branch is a superset**: Note which parts are additive and evaluate only the overlapping scope.
- **Branches in different repos**: Extend the analysis to compare across repos, noting which repo each change belongs to.
- **More than two branches**: Compare pairwise, then synthesize a combined recommendation.
