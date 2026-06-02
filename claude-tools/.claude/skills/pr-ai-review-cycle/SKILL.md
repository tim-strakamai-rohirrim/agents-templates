---
name: pr-ai-review-cycle
description: >-
  Run an automated AI-review cycle on a draft PR without flipping it out
  of draft. Summons CodeRabbit (via slash command) and Copilot (via
  reviewer request), addresses every bot comment, and loops until no new
  bot comments appear. The PR stays in draft the entire time so the
  human gets the next look. Use when the user says "run AI review",
  "AI review cycle", "ready and review", or it is invoked by the
  plan-orchestrator after a PR is created.
allowed-tools:
  - Read
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
---

# PR AI Review Cycle

Drives a **draft** PR through one or more rounds of automated AI review.
The PR is never flipped to ready-for-review — bots are summoned via
slash command (CodeRabbit) and reviewer request (Copilot), both of
which work on drafts. The human always gets the next look.

Designed to be invoked by the `plan-orchestrator` agent after PR
creation, or manually by the user.

## Inputs

- **`pr_number`** (required) — PR to cycle. If omitted, infer from the current
  branch via `gh pr view --json number`.
- **`repo`** (optional) — `{owner}/{repo}`. Defaults to the repo of the current
  working directory.
- **`max_loops`** (optional, default `2`) — hard cap on review rounds to
  prevent runaway loops if a bot keeps re-commenting. Round 1 catches the
  initial bot pass; round 2 confirms convergence after any fix commit.
- **`wait_seconds`** (optional, default `120` — 2 minutes) — **maximum**
  wait window per round. Used as the deadline for the adaptive poll in
  Step 2a; the cycle exits the wait as soon as new bot comments appear,
  so this is the worst-case wait, not the typical one.
- **`poll_interval_seconds`** (optional, default `20`) — how often the
  adaptive poll checks for new bot comments inside the wait window.
- **`bots`** (optional, default `["coderabbit", "copilot"]`) — which
  bots to summon in Step 1. Set to a subset for cheaper cycles on
  trivial phases (e.g. `["coderabbit"]` for a types-only change).

## Guarantees

- The PR **stays in draft for the entire cycle**. Bots are summoned via
  slash commands and reviewer requests that work on drafts; the PR is
  never flipped to ready-for-review.
- Only comments authored by GitHub Apps (`user.type == "Bot"`) are addressed.
  Human comments are intentionally ignored — the user wants those for the
  manual review pass.
- Each loop only addresses comments that are **new since the previous loop**
  (tracked by `created_at` timestamp), so we never re-fix the same comment.

## Workflow

### Step 0 — Resolve inputs and capture cycle start

```bash
PR_NUMBER="${pr_number:-$(gh pr view --json number -q .number)}"
REPO="${repo:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
MAX_LOOPS="${max_loops:-2}"
WAIT_SECONDS="${wait_seconds:-120}"
POLL_INTERVAL_SECONDS="${poll_interval_seconds:-20}"
BOTS="${bots:-coderabbit copilot}"  # space-separated list

CYCLE_START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LAST_SEEN="$CYCLE_START"
LAST_PUSHED_COMMIT=""
```

Verify the PR is currently a draft. If it is already non-draft, warn the
user and ask whether to proceed (a non-draft PR may already have human
review comments that should not be auto-addressed).

```bash
IS_DRAFT="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json isDraft -q .isDraft)"
```

### Step 1 — Summon the bots (PR stays in draft)

Summon the configured bots without changing the PR's draft state. Each
bot has its own summoning mechanism that works on draft PRs:

```bash
for bot in $BOTS; do
    case "$bot" in
        coderabbit)
            # Slash command — works on drafts, ignores auto-review config.
            # Use 'review' (incremental) so subsequent rounds only see
            # the new commits.
            gh pr comment "$PR_NUMBER" --repo "$REPO" \
                --body "@coderabbitai review"
            ;;
        copilot)
            # Request Copilot as a reviewer — works on drafts.
            # The reviewer slug for the GitHub App is
            # 'copilot-pull-request-reviewer'. Some tenants accept it
            # bare; others require the '[bot]' suffix. Try bare first,
            # fall back to the suffixed form.
            gh api "repos/$REPO/pulls/$PR_NUMBER/requested_reviewers" \
                -X POST -f 'reviewers[]=copilot-pull-request-reviewer' \
                2>/dev/null || \
            gh api "repos/$REPO/pulls/$PR_NUMBER/requested_reviewers" \
                -X POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
            ;;
        *)
            echo "Unknown bot in BOTS: '$bot' — skipping." >&2
            ;;
    esac
done
```

No trap is needed — the PR is still draft, so there is no state to
unwind on failure. (Earlier versions of this skill flipped to ready
in this step and used an EXIT trap to undo it; that is no longer the
case.)

### Step 2 — Cycle loop

For `iteration` in `1..MAX_LOOPS`:

#### 2a. Adaptive wait — poll for new bot comments

Replace the previous fixed `sleep "$WAIT_SECONDS"` with an adaptive poll:
check for new bot comments every `POLL_INTERVAL_SECONDS`, and exit the
wait as soon as **any** new bot comment appears (so we don't burn the
full window on PRs where the bot responded in 30s). The poll only stops
early on the first comment; the fetch in 2b still pulls the complete
batch authored during the wait, so a CodeRabbit walkthrough that posts
before the inline review doesn't trick us into starting too early.

```bash
DEADLINE=$(( $(date +%s) + WAIT_SECONDS ))
echo "Iteration $iteration/$MAX_LOOPS — polling for new bot comments (max ${WAIT_SECONDS}s)…"

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    NEW_COUNT=$(
      {
        gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
          --jq "[.[] | select(.user.type == \"Bot\") | select(.created_at > \"$LAST_SEEN\")] | length";
        gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" --paginate \
          --jq "[.[] | select(.user.type == \"Bot\") | select((.submitted_at // \"\") > \"$LAST_SEEN\")] | length";
        gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate \
          --jq "[.[] | select(.user.type == \"Bot\") | select(.created_at > \"$LAST_SEEN\")] | length";
      } | awk '{ s += $1 } END { print s+0 }'
    )

    if [ "$NEW_COUNT" -gt 0 ]; then
        echo "Detected $NEW_COUNT new bot entr(y/ies) after $(( $(date +%s) - (DEADLINE - WAIT_SECONDS) ))s — proceeding."
        # Tiny settle delay so a bot that posted its walkthrough mid-poll
        # has time to land its inline comments before we fetch the full
        # batch in 2b.
        sleep 10
        break
    fi

    sleep "$POLL_INTERVAL_SECONDS"
done
```

#### 2b. Fetch bot comments and reviews since LAST_SEEN

Both **inline review comments** and **review-summary bodies** can contain
actionable feedback. Fetch both, filter to bots, and filter to entries
newer than `LAST_SEEN`.

```bash
# Inline review comments
gh api "repos/$REPO/pulls/$PR_NUMBER/comments" \
  --paginate \
  --jq "[.[] | select(.user.type == \"Bot\") | select(.created_at > \"$LAST_SEEN\")]"

# Review-summary bodies (where Copilot, CodeRabbit, BugBot post their headline)
gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" \
  --paginate \
  --jq "[.[] | select(.user.type == \"Bot\") | select(.submitted_at > \"$LAST_SEEN\")]"

# Issue-style comments on the PR conversation tab
gh api "repos/$REPO/issues/$PR_NUMBER/comments" \
  --paginate \
  --jq "[.[] | select(.user.type == \"Bot\") | select(.created_at > \"$LAST_SEEN\")]"
```

If the combined result is **empty** → the cycle has converged. Break the
loop and proceed to Step 3. (The adaptive poll in 2a already exited the
wait early when comments arrived, so reaching 2b with an empty batch
means the full `WAIT_SECONDS` elapsed without any new bot activity.)

If non-empty → continue to 2c.

##### 2b-guard: skip a fix round when no new commit landed last round

If `iteration > 1` and `LAST_PUSHED_COMMIT` is empty (the previous round
did not push a commit), bots have nothing fresh to react to. Break the
loop now — another wait round will not change the picture.

```bash
if [ "$iteration" -gt 1 ] && [ -z "$LAST_PUSHED_COMMIT" ]; then
    echo "Previous round pushed no new commit — bots have nothing new to react to. Converging."
    break
fi
```

#### 2c. Delegate fixes to a sub-agent

Launch a `general-purpose` Task sub-agent. Its job is to apply the same
discipline as the `pr-review` skill, but only against the bot comments we
just collected:

```yaml
Task tool call:
  subagent_type: "general-purpose"
  description: "Address AI bot comments on PR #{PR_NUMBER} (round {iteration})"
  prompt: |
    You are addressing automated AI review comments on PR #{PR_NUMBER}
    in {REPO}. The PR is currently checked out at {branch}.

    Read the pr-review skill at `.claude/skills/pr-review/SKILL.md` and
    follow its triage process (categorize, push back when warranted, fix
    when valid). Apply that process ONLY to the bot comments below — do
    not fetch additional comments.

    Bot comments to address (JSON):
    {paste the combined inline + summary + issue comments JSON here}

    When you are done:
    1. Run the appropriate verification command for the repo (build / lint
       / test) to confirm nothing is broken.
    2. Commit with a message like
       `chore({TICKET}): address AI review round {iteration}` and push to
       the PR branch.
    3. Report back:
       - Comments fixed (count + brief list)
       - Comments pushed back on (count + reasons)
       - Comments deemed nits / out-of-scope (count)
       - Verification result
       - Commit SHA pushed
```

Wait for the sub-agent to return.

#### 2d. Update LAST_SEEN, record the round's commit, and loop

```bash
LAST_SEEN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LAST_PUSHED_COMMIT="${commit_sha_from_subagent:-}"
```

If the sub-agent reported it pushed a new commit (`LAST_PUSHED_COMMIT`
is non-empty), continue to the next iteration — the new commit may
trigger another bot pass. If the sub-agent made no changes (everything
was a nit or push-back), set `LAST_PUSHED_COMMIT=""` and the 2b-guard
above will break the next iteration immediately.

### Step 3 — Verify PR is still draft

The cycle never flipped the PR out of draft, so there is nothing to
undo. As a safety check, confirm the state hasn't changed (a human or
another agent could have flipped it manually mid-cycle):

```bash
IS_STILL_DRAFT="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json isDraft -q .isDraft)"
if [ "$IS_STILL_DRAFT" != "true" ]; then
    echo "WARNING: PR #$PR_NUMBER is no longer in draft state. Someone flipped it mid-cycle." >&2
    # Report in Step 4 — do NOT silently re-draft, the user may have intended this.
fi
```

### Step 4 — Report

Output a structured summary:

```markdown
## AI Review Cycle — PR #{PR_NUMBER}

**Rounds run**: {N} of {MAX_LOOPS}
**Final state**: draft (ready for human review)

### Round summary

| Round | Bot comments | Fixed | Pushed back | Nits | Commit |
|-------|--------------|-------|-------------|------|--------|
| 1     | {n}          | {n}   | {n}         | {n}  | {sha}  |
| 2     | {n}          | {n}   | {n}         | {n}  | {sha}  |

### Outstanding bot comments

{Any comments the sub-agent pushed back on, with the reason — so the
human reviewer can sanity-check the disagreement.}

### Next step

PR is back in draft. Open {pr_url} and do the human pass.
```

## Error handling

- **A bot-summon command fails** (e.g. permissions, bot not installed) →
  log a one-line warning, drop that bot from the cycle for this run,
  and continue with the rest. Do not abort — the other bot may still
  produce useful comments.
- **Both bot-summon commands fail** → report and stop. There is nothing
  to wait for. PR stays in draft.
- **Sub-agent reports build/lint failure after fixes** → report the
  failure and ask the user whether to retry, rollback, or stop. The
  PR is still draft, so no state needs unwinding.
- **`MAX_LOOPS` reached with comments still pending** → report the
  unresolved comments in the summary and recommend the user run the
  cycle again manually or address them in the human pass.
- **Cycle interrupted (Ctrl-C / agent killed)** → no special handling
  needed; the PR was always in draft.
- **PR was flipped out of draft mid-cycle** (Step 3 warning) → report
  it in the final summary and let the user decide whether to re-draft.

## Important rules

- **Never flip the PR out of draft.** Bot summons use slash commands and
  reviewer requests; neither requires changing draft state.
- **Never address human comments** in this cycle. Filter strictly by
  `user.type == "Bot"`.
- **Never force-push**. The sub-agent should append commits, not rewrite
  history, so the PR review thread stays coherent.
- **Always use a fresh sub-agent per round** so its context window stays
  scoped to the bot comments it is fixing.
- **Only summon configured bots.** Default is CodeRabbit + Copilot; pass
  a different `bots` list to override.
