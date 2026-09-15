---
name: plan-and-review
description: >-
  Use when the user wants a plan for a ticket, QA finding, or bug that will be
  handed to coding agents — "plan this", "plan F5", "plan and review",
  "architect this ticket", "get a plan ready for run-plan" — and whenever a
  {TICKET}-PLAN.md is produced by one agent and needs an independent check
  before any code is written. Also use when the user asks for the planner
  followed by a plan review, or for a plan they intend to run unattended.
---

# Plan and Review

A plan that goes straight from planner to `run-plan` ships its mistakes into a
PR stack. One extra pass — a **different** agent, fresh context, verifying the
plan's claims against the repo — costs one edit instead of a rebuilt stack.

Three steps, in order, in this conversation: **plan** (subagent) → **review**
(different subagent) → **apply edits** (you, in the main conversation).

## Step 0 — resolve inputs

| Input | How |
|---|---|
| Source of requirements | Ticket description, a finding in a QA findings doc (read the finding in full — don't work from the summary line), or the user's prose |
| Ticket ID | The Jira ID if one exists. **If none exists, default a descriptive slug** (`AP-F5-HELM-CHAT`) and tell the user in your final message to swap in a real number before branches get cut — the slug ends up in every phase branch name |
| Repos in play | From the workspace `CLAUDE.md` |

Don't ask the user which repo or which fix direction. That is what the planner
investigates and what the reviewer checks.

## Step 1 — planner subagent

Dispatch one subagent (`run_in_background: false` — step 2 needs its output and
nothing else can usefully happen meanwhile). Its first action is invoking the
`planner-architect` skill.

The prompt must carry all five of these or the run comes back thin:

1. **The full finding/requirement text**, pasted in, plus the file:line to read
   for the rest. Include low-confidence secondary observations, marked as such.
2. **"Do NOT ask me clarifying questions — I am not available. Where the skill
   says to ask, record the item under Open questions with a proposed default
   answer and proceed. Produce the complete plan in this one run."**
   `planner-architect` step 1 says to ask the user; without this the subagent
   stalls or returns a stub.
3. **A concrete investigation brief** — name the searches and the question to
   answer on each side (server route + DTO, client call site, which side has other
   working callers). "Investigate the bug" produces guesswork.
4. **"Decide the fix direction on evidence, not guesswork."** Name the candidate
   directions, require a one-line reason for the chosen one and a recorded
   trade-off for the rejected one. If genuinely ambiguous: Open Question #1 with
   a default, phases planned against that default.
5. **Scope pressure** — for a bug: "shortest correct diff wins, no refactors, no
   new abstractions/services/config, reuse existing patterns, expect 2-4 phases,
   do not pad." Plus: real repo-relative paths, real `base_branch`/`depends_on`,
   **runnable** verification commands from `CLAUDE.md`, and a manual repro step
   naming the environment the bug was found in.

Ask it to report back: file paths written, fix direction + one-line reason,
phase list with tags/repos, open questions.

## Step 2 — review subagent

A **new** subagent (never the planner — an author re-reading their own plan
re-reads their own reasoning, and a fresh context is the whole point). Its first
action is invoking the `review-plan` skill.

The prompt must carry:

- The plan and contracts paths, and that a missing `-spec.md` is expected.
- The **original** requirement source, so coverage is checked against the
  finding rather than against the plan's restatement of it.
- **"Verify that claim against the actual code — do not take the plan's word for
  it."** State the plan's load-bearing decision (the fix direction) explicitly
  and invite the reviewer to overturn it: "if the rejected alternative is
  actually the better call, say so plainly."
- Which open questions might be load-bearing — i.e. the phases are wrong if the
  default answer is wrong — and ask for a verdict on each.
- YAGNI pressure in **both** directions: flag scope creep *and* flag anything
  genuinely missing (unverified AC, nonexistent path, verification command that
  won't run, untested error path).
- **"Do NOT edit the plan documents — review only. Report the specific edits you
  recommend so I can apply them."**

`review-plan` has a `--fix` mode. Use it only when you would apply every finding
unread — recommended edits routinely need arbitration, and applying them in the
main conversation keeps the diff visible to the user.

## Step 3 — apply the edits

You apply them, in the main conversation, from the reviewer's list.

Use exact-string replacement with a **match-count assertion**, so a stale target
fails loudly instead of silently doing nothing:

```python
n = s.count(old); assert n == 1, "edit %d matched %d times" % (i, n)
```

Then grep the applied markers to confirm, and fix the second-order spots the
reviewer's line numbers didn't name — a file removed from a phase's `files:`
block is usually also a row in the file-touch matrix.

Only re-dispatch a reviewer if blockers remain after your edits. One planner +
one reviewer + your edits is the normal shape.

## What the review actually catches

Calibration from live runs — a plan can be well-researched and still ship these:

- A snippet in the **wrong test framework** for the target repo (Jasmine idiom in
  a Jest repo) — copy-pasted, doesn't run.
- Prose ambiguous about **which** `try`/`catch` a step goes in, where the natural
  reading reintroduces the bug the ticket exists to fix.
- Steps that break tests the plan never mentions → phase verification goes red.
- An AC that only holds on a tenant with entitlements the plan never states.
- Mechanical **false positives** (a nested table parsed as the contract mapping
  table) — say so, don't "fix" them.

## Common mistakes

| Mistake | Consequence |
|---|---|
| One subagent doing both steps | The plan is graded by its own author |
| Letting the planner ask questions | Subagent stalls; you get a stub back |
| Backgrounding step 1 | Nothing to do while you wait; foreground it |
| Reviewer trusting the plan's citations | Wrong direction sails through with 40 confident file:line refs |
| Fixing every mechanical MAJOR | Some are parser artifacts; verify before editing |
| Sed-style edits without assertions | Silent no-ops; you report edits that never landed |
| Skipping to `run-plan` on `REVISE` | The blockers become a rebuilt PR stack |

## Output

Report to the user: plan + contracts paths, the fix direction and its one-line
reason, the phase list, the review verdict with blocker/major counts, what you
changed in response, and anything still needing their decision (a real ticket
number, a load-bearing open question). Then say whether it is ready for
`run-plan`.
