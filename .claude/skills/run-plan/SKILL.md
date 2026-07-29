---
name: run-plan
description: >-
  Drive a phased implementation plan to completion from the main conversation.
  Reads a {TICKET}-PLAN.md, assesses which phases are done by checking branch
  and PR status, then launches the plan-workflow.js Workflow script (multi-phase)
  or a direct agent pipeline (single phase) to implement, review-gate, open a
  draft PR, and run the AI review cycle plus the 3-sided review loop per phase —
  each phase starting its reviews as soon as its own PR opens. Use when the user says
  "run the plan",
  "orchestrate the plan", "continue the plan", "implement all phases", "do
  phase N", or wants autonomous multi-phase execution.
---

# Run Plan

Orchestrate a phased implementation plan **from the main conversation** — do
not delegate orchestration to a coordinator sub-agent. You parse the plan,
assess state, and launch the work; heavy lifting (implementation, reviews, PR
creation, AI review cycles) runs in sub-agents. Deterministic control flow
(dependency gating, file-overlap checks, cycle joins) lives in
`plan-workflow.js` next to this skill, executed via the **Workflow tool** —
this skill's instructions are your explicit authorization to call Workflow.

## Inputs

Gather from the user's request (ask only if you cannot infer):

- **Ticket ID** (e.g. `PRCR-1260-v2`) — required. Infer from the current
  branch name if not given.
- **Phase scope** (optional) — a single phase ("do phase 3"), a range, or all
  remaining phases. **Default: all remaining phases, autonomously, with no
  confirmation between phases.** PRs are created as drafts and stay drafts.

`{TICKET}-PLAN.md` and `{TICKET}-contracts.md` must exist at the workspace
root (produced by the planner-architect skill).

## Step 1 — Parse the plan (main loop, lightweight)

Read `{TICKET}-PLAN.md` and extract every ` ```phase-meta ` YAML block into a
phase list: `phase`, `title`, `repo`, `base_branch`, `depends_on`, `files`,
`contracts`, `verification`.

Resolve the git user for branch naming (`git config user.name`, kebab-cased,
or ask) and the base branch that `base_branch: base` maps to.

## Step 2 — Assess phase status (main loop)

For each phase:

```bash
git -C {repo_path} rev-parse --verify {user}/{ticket}/phase-{N} 2>/dev/null
gh pr list --repo {owner}/{repo} --head {user}/{ticket}/phase-{N} --json number,state,isDraft
```

Classify: **merged** | **pr-open** | **branch-exists** | **not-started**.

**Samwise size pre-flight (cheap, static).** While parsing, count each
phase's substantive `files` (exclude docs, tests, snapshots, images,
`*.lock` — Samwise's size math ignores those). If a phase declares **> 25**
substantive files, its PR will ESCALATE to human review on size alone. Flag
it in the status table (e.g. a `⚠ 28 files` note) and mention it to the user
before launching — the planner-architect skill owns the fix (splitting the
phase), so surface it rather than silently proceeding. Line count can't be
known until the diff exists; this is a files-only heads-up.

Show the user a status table before launching anything:

```
Phase | Title                        | Status        | PR
------|------------------------------|---------------|-----
1     | Store converted HTML key     | merged        | #142
2     | Serve document HTML content  | pr-open       | #143
3     | Delete source document       | branch-exists | —
4     | Per-document auto-tagging    | not-started   | —
```

## Step 3 — Launch

### Multi-phase scope → Workflow (default)

Invoke the Workflow tool with the static script and computed args:

```yaml
Workflow:
  scriptPath: .claude/skills/run-plan/plan-workflow.js
  args:
    ticket: "{TICKET}"
    gitUser: "{user}"
    workspaceRoot: "/Users/tim/Documents/code/rohan"
    baseBranch: "{resolved base, e.g. main}"
    repoPaths:
      rohan_api: rohan_api-parent/rohan_api
      rohan_ui: rohan_ui-parent/rohan_ui
      rohan_python_api: rohan-python-api
      onering: ONERING
    maxFixRounds: 2
    maxThreeSidedRounds: 3     # per-PR 3-sided review→fix rounds
    skipAiReview: false        # true only if the user opted out of the bot cycle
    skipThreeSided: false      # true only if the user wants the stack pass done later
    phases: [ {parsed phase objects, each with its assessed status} ]
```

The workflow takes each phase from not-started to an **open draft PR that has
been through the bot (CodeRabbit/Copilot) cycle and the 3-sided review loop**.
Both reviews start **as soon as that phase's PR opens** — they do not wait for
the rest of the stack, and they overlap with later phases implementing. The
bottom-up property still holds because a dependent's PR step merges up every
commit its dependencies' review chains pushed before opening (see Cycle joins).

The script handles, deterministically in code (not model judgment):

- **Dependency-gated waves** — phases run as soon as their `depends_on` are
  satisfied; cross-repo phases in the same wave run concurrently.
- **Same-repo contention** — a second concurrent phase in the same repo is
  told to create a nested-repo worktree (see Worktrees below).
- **File-overlap guard** — a phase whose `files` overlap a dependency's is
  held until that dependency's AI review cycle finishes.
- **Contract-compliance gate** — `plan-compliance-reviewer` with a
  schema-validated verdict; a fix loop (max `maxFixRounds`) where re-review
  rounds carry the original findings forward so the reviewer verifies its own
  findings were resolved. **Security is deliberately not gated here** — the
  3-sided pass's `pr-security-reviewer` covers the same threat taxonomy plus
  robustness and testability, minutes later on the same code. Compliance stays
  pre-PR because contract drift is much more expensive to fix once the branch
  is pushed and dependents have stacked on it.
- **Post-PR review chain, per phase** — as soon as a phase's PR opens (as
  draft), that phase's chain starts and runs without blocking the next wave:
  the bot cycle (pr-ai-review-cycle: CodeRabbit + Copilot), then the **3-sided
  review→fix loop** (`/review-pr-3-sided`; if the verdict isn't `approve`, a
  **different** agent runs `/pr-review` on the findings; repeat up to
  `maxThreeSidedRounds`, findings carried forward so the re-review verifies its
  own findings). The PR stays draft throughout.
- **Cycle joins** — before a phase's PR opens, its dependencies' review chains
  are awaited and every commit they pushed (bot fixes *and* 3-sided fixes) is
  propagated to the stacked branch **via merge commits — never rebase, never
  force-push** (force-push is denied in this workspace).

The workflow runs in the background and you are notified on completion —
do not poll. While it runs, relay notable progress to the user. When it
returns, **proceed straight to Step 4** (do not stop for confirmation —
default is hands-off to completion).

## Step 4 — mop up the layers 3-sided didn't approve

The 3-sided loop already ran per phase inside the workflow. The workflow's
return value has `three_sided_unapproved` — the layers that hit
`maxThreeSidedRounds` without an `approve`. **If it is empty, skip to
reporting.**

Otherwise, drive only those layers to approval by invoking the
**`review-stack-3-sided`** skill from the main conversation. That skill owns the
per-layer loop (`/review-pr-3-sided` → if not approved, a *different* subagent
runs `/pr-review` → repeat) and the bottom-up merge-up propagation of each
approved layer into the layers stacked on it (merge commits, never
rebase/force-push) — which matters here because a mopped-up layer's new fixes
must reach the already-approved layers above it.

Invoke it with:

- **The PRs** — only the unapproved layers' PRs, grouped into per-repo stacks and
  ordered bottom-up by `depends_on` / `base_branch`, plus the approved layers
  stacked above them as merge-up targets. Say which layers already approved so it
  doesn't re-review them.
- **Round cap** — default 3 (the round cap the user set, if any).
- **Outstanding findings** — the `blocking` list the workflow returned per
  unapproved layer, so its reviewer resumes rather than starting cold.
- **Grounding docs** — point its reviewers/fixers at `{TICKET}-PLAN.md` and
  `{TICKET}-contracts.md`; name any superseded/stale copies explicitly so a
  reviewer doesn't raise false blockers against an old contract.

Do not hand-roll the loop yourself — hand it to that skill so there's one
implementation of the stack logic. When it finishes, report per-phase results
in plain prose: PR URLs, review summaries, bot-cycle rounds, the final 3-sided
verdict and rounds run per layer (PRs that reached `approve` are ready for the
human pass; for the rest, list the outstanding findings), merge-up SHAs, and
anything blocked. PRs stay draft the entire time.

### Single phase ("do phase 3") → direct agents with SendMessage

A one-phase run doesn't need the workflow. Drive it from the main loop:

1. **Implement** — spawn an agent on the implement-phase skill for phase N
   (same prompt shape as `implementPrompt` in plan-workflow.js).
2. **Contract-compliance gate** — spawn a `plan-compliance-reviewer` agent for
   an explicit PASS/FAIL verdict plus findings. Do **not** also spawn
   `security-reviewer` — step 6's 3-sided pass owns security (same reasoning as
   the multi-phase gate above).
3. **Fix loop** — if the compliance verdict is FAIL, spawn a fixer agent with
   the findings. Then **SendMessage the original reviewer agent** — not a fresh
   one — with the fixer's report: "verify each of your findings is resolved in
   the updated diff." The reviewer keeps its context, so it checks what it
   actually meant. Max 2 rounds; if still blocked, stop and report.
4. **Create PR** — spawn an agent on the create-pr skill (skip its review
   gate; include the compliance summary). Draft, always.
5. **AI review cycle** — spawn a background agent (`run_in_background: true`)
   on the pr-ai-review-cycle skill. The harness notifies you when it
   completes — do not poll or sleep while waiting.
6. **3-sided to approval** — after the bot cycle completes, invoke the
   **`review-stack-3-sided`** skill on this single PR (a one-layer stack).
   It runs the `/review-pr-3-sided` → `/pr-review` loop to an `approve`
   verdict. Same skill, same one implementation of the loop as the
   multi-phase path — don't hand-roll it here. When it approves, tell the
   user the PR is ready for their human pass. PR stays draft.

## Worktrees (nested repos)

The built-in `isolation: "worktree"` flag worktrees the **workspace root**
repo, which does not contain the nested code repos — never use it for phase
work. When two agents need the same nested repo concurrently (parallel
same-repo phases, or an AI review cycle fixing phase N while phase N+1
implements), the later agent creates a worktree per the existing convention:

```bash
cd {repo_path}
git worktree add ../{repo-name}-{TICKET}-phase-{N} -b {user}/{ticket}/phase-{N} {base_ref}
```

For `rohan_api`, the gitignored `.env`, `.env.test`, and
`scripts/add_user_local.sql` must then be copied from the primary — see
`.claude/skills/copy-rohan-api-worktree-files/SKILL.md`. The workflow script
already embeds these instructions in its agent prompts.

## Failure handling and resume

- **Implementation or review-blocked failure** — the workflow stops that
  phase's dependent chain, finishes independent chains, and returns the
  findings. Report them; after fixes, re-run this skill — Step 2's status
  assessment makes re-runs idempotent (done phases are skipped).
- **Workflow dies mid-run** — the tool result included a `runId`. Re-invoke
  with `resumeFromRunId` after fixing the cause; completed agent calls replay
  from cache.
- **A phase branch exists with partial work** — implement-phase resumes it;
  pass status `branch-exists` only when the implementation is actually
  complete (commits match the step checklist), otherwise `not-started`.

## Important rules

- **Orchestrate in the main conversation.** Do not spawn the legacy
  `plan-orchestrator` agent unless the Workflow tool is unavailable or the
  user asks for it by name.
- **PRs are created as drafts and must remain drafts** — the human gets the
  next look. Never flip one to ready.
- **Never force-push, in any form** (including `--force-with-lease`).
  Stacked-branch updates propagate via merge commits.
- Never push to `main` or `develop` directly.
- Never modify the plan or contracts documents.
- Run all phases hands-off by default; stop only for review-blocked findings
  the fix loop couldn't resolve, or scope changes only the user can decide.
