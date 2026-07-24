---
name: rebase-stacked-prs
description: >-
  Update ("rebase") a stacked PR and its downstream stack onto the latest main
  WITHOUT force-pushing — by merging main up the stack via merge commits. Also
  fixes the case where earlier phases were squash-merged into main, so the PR
  diff re-shows changes already on main. Use when the user says "rebase PR",
  "rebase the stack", "update stack against main", "the PR diff includes changes
  already merged into main", or "make the PR show only net-new changes".
---

# Rebase Stacked PRs (merge-based, no force-push)

Bring a stack of PRs up to date with `main` so each PR shows **only its own
net-new changes** — without rewriting history.

## Hard constraints

- **NEVER force-push and NEVER `git reset --hard`** on these branches. They have
  open PRs and are shared. Force-push is denied in this workspace.
- Updates from `main` are propagated via **merge commits**, never `git rebase`.
  (A literal rebase rewrites SHAs and would require force-pushing every branch in
  the stack.) Despite the user saying "rebase", the operation here is a merge.

## When to use this

Two related symptoms, same fix:

1. **Stack is behind main.** The PR's base branch (`main`) advanced; the branch
   needs the new commits.
2. **PR diff shows changes already merged into main.** This happens when an
   earlier phase was **squash-merged** into `main` as its own PR. Squash-merge
   mints new SHAs, so git no longer sees the branch's copy of that phase as the
   same history. The PR's merge-base stays stale and the diff re-shows the
   already-merged content. Merging the current `main` in moves the merge-base
   forward and collapses that duplicate content out of the diff.

## Procedure

### 1. Map the stack

```bash
gh pr view <PR> --repo <owner>/<repo> \
  --json number,headRefName,baseRefName,isDraft,mergeable
```

Find every PR in the stack and record each PR's head → base. A stack looks like:

```
PR 2034  phase-S5 → main      (bottom)
PR 2035  phase-S6 → phase-S5
PR 2036  phase-S8 → phase-S6  (top)
```

Use `gh pr list --search "<TICKET> in:title" --state open` to discover siblings.
Order them bottom → top; that's the propagation order.

### 2. Pre-flight

```bash
git fetch origin
git status --short                 # working tree must be clean
```

For each branch, compare local vs origin. If a local branch is **behind** origin
(someone pushed merge work), fast-forward it first — never reset:

```bash
git merge-base --is-ancestor <local> origin/<local> && echo "ff possible"
git checkout <branch> && git merge --ff-only origin/<branch>
```

If a branch has **diverged** from origin, stop and report — do not force anything.

### 3. Merge main into the bottom branch

```bash
git checkout <bottom-branch>            # e.g. phase-S5
git merge --ff-only origin/<bottom-branch> 2>/dev/null || true
git merge --no-edit origin/main
```

Resolve any conflicts normally (no force). A clean merge ("ort strategy") needs
no edits.

### 4. Propagate down the stack

Merge each branch into the next, bottom → top. This carries the new `main`
through the whole stack via merge commits:

```bash
git checkout <phase-S6> && git merge --no-edit <phase-S5>
git checkout <phase-S8> && git merge --no-edit <phase-S6>
```

### 5. Verify BEFORE pushing

This is the step that proves the PR diffs are now correct.

**a. Each branch contains the new main, and stack bases are intact:**

```bash
for b in <phase-S5> <phase-S6> <phase-S8>; do
  git merge-base --is-ancestor origin/main "$b" \
    && echo "$b: contains main" || echo "$b: MISSING main"
done
git merge-base --is-ancestor <phase-S5> <phase-S6> && echo "S6 contains S5: OK"
git merge-base --is-ancestor <phase-S6> <phase-S8> && echo "S8 contains S6: OK"
```

**b. The bottom PR's diff now equals the true net diff vs main.** After merging
main in, the merge-base should BE `origin/main`, so the three-dot diff (what
GitHub shows) equals the two-dot diff:

```bash
git merge-base origin/main <bottom-branch>      # must equal origin/main
git rev-parse origin/main
git diff --stat origin/main...<bottom-branch>   # three-dot (GitHub's view)
git diff --stat origin/main..<bottom-branch>    # two-dot — must match the above
```

**c. Confirm no already-merged content remains.** Grep the diff for definitions
that earlier squash-merged phases introduced (enums, columns, DTO classes). You
should see only **usages**, never the original definitions:

```bash
git diff origin/main..<bottom-branch> \
  | grep -nE "enum <SomeEnum>|export class <SomeDto>|<migrated_column>"
# Expect: no definition lines. Import/usage lines are fine.
```

### 6. Push (no force) and confirm

```bash
git push origin <phase-S5> <phase-S6> <phase-S8>
```

All three must be fast-forward pushes (`oldsha..newsha`, never `+`). Then confirm
GitHub recomputed each PR to only its phase's net-new changes:

```bash
gh pr view <PR> --repo <owner>/<repo> --json additions,deletions,changedFiles,files
```

A `mergeStateStatus` of `BLOCKED` / `UNSTABLE` is just draft status + CI running,
**not** a merge conflict (`mergeable` will still be `MERGEABLE`).

## Notes

- Merges in this flow are typically clean and additive. They don't need a local
  build — CI on the PRs covers it. Say so rather than implying you ran tests.
- PRs stay in **draft** throughout; this skill never marks them ready.
- If the user only names the bottom PR, still propagate downstream — otherwise
  the upper PRs break or re-show conflicts at their next merge.
- This is the merge-based counterpart to the `stacked-branches` skill's create /
  status operations. Use that skill to create branches; use this one to bring an
  already-pushed stack up to date with main.
