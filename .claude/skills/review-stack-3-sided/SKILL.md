---
name: review-stack-3-sided
description: >-
  Drive a set of stacked draft PRs through the 3-sided review loop until every
  layer earns an approve verdict. For each PR: run /review-pr-3-sided in a
  subagent; if it is not an approval, run /pr-review in a DIFFERENT subagent to
  address the findings; repeat until approved. Process each repo's stack in
  bottom-up order and, once a layer is approved, propagate it up into the layers
  stacked on top (merge commits, never rebase/force-push) before moving on. Use
  when the user says "3-sided review the stack", "review the stack until
  approved", "run the review loop on these PRs", "review-pr-3-sided each PR", or
  asks to loop 3-sided review + pr-review across a PR stack.
---

# Review Stack (3-Sided, loop-to-approval)

Orchestrate the review of one or more **stacks of draft PRs** from the main
conversation. Per PR: an independent 3-sided review, then — only if it isn't an
approval — a fix pass by a *different* subagent, looping until the review
approves. Stacks are handled bottom-up; an approved layer is propagated up its
stack before the next layer is reviewed.

**Orchestrate from the main conversation.** Do not hand the whole loop to one
coordinator subagent. You spawn the reviewer/fixer subagents, read their
verdicts, and do the merge-ups; the heavy work (the reviews, the fixes) is what
runs in subagents.

## Inputs

Gather from the request (infer, then state your assumptions — don't stall):

- **The PRs / stacks.** Either explicit PR numbers, or a ticket/branch prefix to
  discover them. Group into per-repo stacks and order each **bottom-up** (base
  `main`/`develop` first, then each PR whose base is the branch below it).
- **Repo processing order** (optional). Repos are independent — default to
  running them **in parallel**, each stack internally sequential. Honor an
  explicit order if the user gives one (e.g. "api, then database, then ui").
- **Exclusions** (optional). PRs the user is handling separately.
- **Round cap** (optional, default **3**). Max review rounds per layer before
  stopping and reporting an unresolved layer.

## The per-layer loop

For each PR layer, **bottom-up within its stack**:

1. **Review (Step 1).** Spawn a subagent that invokes `/review-pr-3-sided` on the
   PR. On rounds 2+, reuse the *same* reviewer subagent via SendMessage with
   `--follow-up` so it verifies its own prior findings were resolved (keeps
   context, won't re-litigate). Read the **aggregated verdict** from the agent's
   report.
2. **Fix (Step 2) — only if Step 1 is not an approval.** Spawn a **DIFFERENT**
   subagent that runs `/pr-review` to triage and address the findings (fix valid
   ones, push back on wrong/out-of-scope ones with a PR reply, skip nits),
   verify, commit, and push. Reuse the *same* fixer across rounds via
   SendMessage.
3. **Repeat 1→2** until Step 1 returns an approval, or the round cap is hit
   (then stop that layer and report the outstanding findings).
4. **Propagate up.** Once the layer is approved, merge it up into every layer
   directly stacked on it (see Merge-up), verify, and push — then move to the
   next layer.

Reviewer and fixer are **always different agents** — the fixer must never grade
its own work. Keep one reviewer thread and one fixer thread per PR across rounds.

## Merge-up (NOT rebase)

"Rebase the layers on top of the approved layer" means **merge the approved
lower branch up into each higher branch via a merge commit.** In this workspace
`git rebase` and force-push (including `--force-with-lease`) are **denied** —
never use them. Never push to `main`/`develop`.

For each branch stacked directly on the just-approved branch:

```bash
cd {repo_path}
git fetch origin -q
# Skip if the upper branch already contains the lower tip (no new commits to carry):
git merge-base --is-ancestor origin/{lower} origin/{upper} && echo "already up to date" && exit 0
git checkout -B {upper} origin/{upper}
git merge --no-edit {lower}          # resolve conflicts if any
# verify (repo-appropriate), then:
git push origin {upper}
```

Only merge up when the lower layer actually gained commits this loop (the
`--is-ancestor` check tells you). Then review the upper layer — its diff now
includes the merged fixes.

## Verification after fixes / merge-ups

Run the repo's checks before pushing a merge or trusting a fix:

- **rohan_api (NestJS):** `npm run lint`; the touched specs
  (`npm run test -- <spec>`); `npm run build`.
- **rohan_ui (Angular):** `npm run lint` (only require the files you touched to
  be clean — the repo has pre-existing unrelated lint errors in
  proposal-engine/acquisition-center); the touched specs
  (`npm run test:ci -- --include='<spec>'`); `npm run build`.
- **Database:** no build step — re-read the SQL for validity/idempotency.

## Subagent prompt notes (learned the hard way)

- **Reviewers must finish inline.** `/review-pr-3-sided` dispatches its own
  intent/disagreeable/security lens-reviewers. A subagent tends to *yield*
  ("waiting for a notification") when it does this. Tell it explicitly: complete
  the whole review in this turn; if it spawns lens sub-reviewers, wait for them
  **synchronously** (`run_in_background: false`); do not yield before printing
  the verdict. If one yields anyway, resume it via SendMessage with that
  instruction.
- **Make the reviewer report a machine-readable verdict.** Ask for a first line
  `VERDICT: <approve | changes-requested>` (map anything non-approving to
  changes-requested). **Gate on this reported verdict**, not on the GitHub review
  event — self-authored PRs can't self-approve, so `/review-pr-3-sided` posts the
  verdict as a COMMENT.
- **Ground reviewers and fixers on the authoritative spec.** If the plan/contracts
  were amended, point them at the current doc (e.g.
  `specs/plans/{TICKET}/...`) and name superseded/stale copies explicitly.
  Otherwise a reviewer grounds on a stale contract and raises false blockers for
  intentionally-removed fields; a follow-up with correct grounding clears them.
- **Fixers do the work themselves** — tell them not to spawn further subagents
  (bounds nesting depth). Give them the branch checkout command
  (`git fetch origin && git checkout -B {branch} origin/{branch}`) and the
  verification commands.

## Gotchas

- **Shallow clones → "refusing to merge unrelated histories".** A stacked branch's
  common ancestor can be below the shallow boundary, so `git merge` / `merge-base`
  fail. Check `git rev-parse --is-shallow-repository`; if true,
  `git fetch --unshallow origin` (or `--depth=N`) before ancestry checks and
  merge-ups.
- **PRs stay draft the entire time** — never flip to ready; the human gets the
  next look after the loop approves.
- **Cross-repo parallel, intra-repo sequential.** Different repos have different
  working dirs → safe to run concurrently. Within one repo, run layers one at a
  time so only one agent writes to that working dir.
- **Commit trailer:** end commit bodies with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Never modify plan/contracts docs** as part of this loop (unless the user asks
  separately).

## Reporting

When all stacks are done, report per PR: rounds run, final verdict, fix commit
SHAs, merge-up SHAs, findings fixed vs. pushed back, and any layer that hit the
round cap without approving (with its outstanding findings). Note non-blocking
items reviewers approved despite, and any deploy-ordering caveats surfaced.
