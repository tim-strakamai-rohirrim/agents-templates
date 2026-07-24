---
name: "Review PR (3-Sided)"
description: "3-Sided Code Review with Aggregated Verdict — dispatches intent, disagreeable, and security reviewers in parallel, aggregates findings, then posts the review to GitHub"
category: Code Review
tags: [code-review, pr, parallel, security, multi-agent]
---

3-Sided Code Review with Aggregated Verdict

Review this PR: `$ARGUMENTS`

`$ARGUMENTS` may contain a PR reference (URL or number) plus optional flags `--dry-run`, `--allow-partial`, `--confirm-target`, `--inline-only`, `--follow-up`, `--no-checkout`. Tokenize on whitespace and match each flag as a standalone token — never as a substring. A branch name like `feature/add-dry-run-mode` MUST NOT be treated as the `--dry-run` flag.

Severity rubric: `agents/_severity-rubric.md`. The aggregator and all three subagents MUST use it verbatim.

## Phase 0 — Normalize and validate input (main agent)

Refuse to proceed if any step fails. No fallback to defaults that silently change the post target.

1. **Tokenize** `$ARGUMENTS`. Extract the first non-flag token as the PR reference.
2. **Parse PR target**:
   - Bare integer: `pr_number=<that>`; default `owner/repo` to the current repo via `gh repo view --json nameWithOwner -q .nameWithOwner`.
   - Full URL: regex `^https://github\.com/([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)/pull/([0-9]+)$`. Reject anything else.
3. **Validate every field with strict regex**, even from `gh` output:
   - `pr_number` ~ `^[0-9]+$`.
   - `owner` ~ `^[A-Za-z0-9._-]{1,39}$`.
   - `repo` ~ `^[A-Za-z0-9._-]{1,100}$`.
   - `commit_id` (head SHA, used later) ~ `^[a-f0-9]{40}$`.
4. **Reject shell metacharacters** in any extracted value. Never interpolate raw `$ARGUMENTS` into a shell command — only interpolate validated, regex-matched variables.
5. **Wrong-target guard (SSRF)**: if the parsed `owner/repo` differs from `gh repo view --json nameWithOwner -q .nameWithOwner`, refuse to post unless `--confirm-target` is present in the token list. Print the parsed target and exit with a clear error.

## Phase 1 — Context gathering (main agent, before dispatch)

0. **Record the caller's current branch**: `ORIGINAL_REF=$(git -C <repo_root> symbolic-ref --quiet --short HEAD || git -C <repo_root> rev-parse HEAD)` (branch name if on one, else the detached SHA). Phase 4.7 restores it on every exit path, so the review never leaves the caller on a different branch.
1. **Pin the head SHA now**: `HEAD_SHA=$(gh pr view <pr_number> --repo <owner>/<repo> --json headRefOid -q .headRefOid)`. Validate against the SHA regex. Reuse this exact value in Phase 4 — never re-resolve at post time.
1a. **Check out the PR code at `HEAD_SHA` (do not review the current working tree)**. Subagents read files with Read/Glob/Grep, so they MUST be pointed at a checkout that actually contains the PR's commits — never the caller's cwd, which is usually on `main` and will make every reviewer hallucinate "missing implementation" blockers.

   **Escape hatch**: if the token list contains the standalone token `--no-checkout`, skip the worktree entirely and set `CHECKOUT_ROOT=<repo_root>` (the caller's cwd) — for when the user has *already* checked out the PR branch and wants the working tree reviewed as-is (including uncommitted changes). Verify it before trusting it: `test "$(git -C <repo_root> rev-parse HEAD)" = "$HEAD_SHA"`; if it mismatches, warn that the working tree is not at `HEAD_SHA` (findings may not correspond to the diff) and continue only because the user opted in. No worktree is created, so Phase 4 skips cleanup.

   Otherwise, create a throwaway detached worktree so the user's working tree is untouched:
   ```bash
   git -C <repo_root> fetch origin "pull/<pr_number>/head" --depth 1   # works for fork PRs too
   CHECKOUT_ROOT=$(mktemp -d -t review-pr-3-sided.XXXXXX)
   git -C <repo_root> worktree add --detach "$CHECKOUT_ROOT" "$HEAD_SHA"
   test "$(git -C "$CHECKOUT_ROOT" rev-parse HEAD)" = "$HEAD_SHA"   # verify; abort if mismatch
   ```
   `<repo_root>` is the local clone of `<owner>/<repo>` (resolve it from the Phase 0 `gh repo view` directory; in a multi-repo workspace pick the clone whose `nameWithOwner` matches). If no local clone exists or the fetch/worktree fails, fall back to the GitHub Contents API at `HEAD_SHA` for file reads and tell each subagent to use it — never silently review the wrong tree. Register `CHECKOUT_ROOT` for cleanup in Phase 4.
2. **Self-review preflight**:
   - `PR_AUTHOR=$(gh pr view <pr_number> --repo <owner>/<repo> --json author -q .author.login)`.
   - `ME=$(gh api user -q .login)`.
   - If `PR_AUTHOR == ME`, mark `SELF_REVIEW=1`. GitHub blocks `--approve` and `--request-changes` on own PRs; Phase 4 will force `--comment`.
3. **Fetch and parse the diff once**:
   - `gh pr diff <pr_number> --repo <owner>/<repo>` → store raw diff.
   - Parse unified diff `@@` headers into a lookup table `CHANGED_LINES: { <path>: [<line_range>, ...] }` for added/modified lines (RIGHT side) and a separate table for deleted lines (LEFT side). Phase 3 uses this set; raw subagent claims do not pass without a match here.
4. **Fetch PR metadata** (title, description, linked issues, target branch, file list, diff size, CI status, existing review comments). For existing review comments, capture author (human vs. bot — CodeRabbit, Copilot, prior `/review-pr-3-sided` runs), path/line, body, and resolution state. Phase 3 dedupes against these.
5. **Detect project conventions**: read `CLAUDE.md`, `CONTRIBUTING.md`, and linter configs (`.eslintrc*`, `ruff.toml`, `pyproject.toml`, `.markdownlint*`) into the context bundle.
6. **Gather intent sources** (`INTENT_SOURCES`): the PR description; the linked Jira ticket body (extract `PRCR-NNNN`/`ROH-NNNN` from the branch name or PR title, fetch via the Jira MCP tools if available); and any `{TICKET}-PLAN.md` / `contracts.md` in the repo (Glob for them). Record explicitly which sources were found and which are absent — the intent reviewer degrades its scope accordingly.
7. **Assemble context bundle** = { PR metadata, raw diff, CHANGED_LINES tables, conventions excerpts, CI status, existing comments (with author + resolution state), INTENT_SOURCES, HEAD_SHA, CHECKOUT_ROOT, SELF_REVIEW }. Pass this bundle to every subagent so reviews are grounded, not generic. Each subagent prompt MUST state that `CHECKOUT_ROOT` is the checkout at `HEAD_SHA` and that all file reads (Read/Glob/Grep) go there — not the caller's cwd.
8. **Large-diff check**: if the diff exceeds ~3,000 changed lines or ~40 files, partition the file list into coherent groups (by directory/module, keeping a file's tests in the same group as its source). Run Phase 2 once per partition (same three lanes, partition-scoped bundle), then aggregate all partitions together in Phase 3. Never feed a diff that would silently truncate into a single reviewer context.

## Phase 2 — Dispatch three subagents in parallel

Dispatch all three in a single message (parallel Task tool calls). Pass the full context bundle from Phase 1 to each. Each subagent MUST cite `file:line` for every finding, rate severity per `agents/_severity-rubric.md`, and return findings as a JSON array (schema in the next subsection). No praise-only output.

| Subagent | `subagent_type` | Role |
|----------|-----------------|------|
| 1 | `pr-intent-reviewer` | Spec/intent compliance — missing requirements, contract drift, untested acceptance criteria, scope creep, missed reuse |
| 2 | `pr-disagreeable-reviewer` | Adversarial — logic bugs, race conditions, silent failures, lying naming/comments |
| 3 | `pr-security-reviewer` | Security (OWASP), robustness (retry/timeout/leaks), testability (gap-specific test skeletons) |

The three lanes ask disjoint questions: *is it what was asked for* (intent), *is it right* (disagreeable), *is it safe* (security). Any reviewer may file `strengths`; none is dedicated to praise.

Each agent's full role definition lives in its own file under `.claude/agents/`.

### Subagent output contract (JSON)

Reviewers MUST emit findings as a JSON block parseable by the aggregator. Reject any reviewer output that does not match this schema.

```json
{
  "reviewer": "pr-intent-reviewer | pr-disagreeable-reviewer | pr-security-reviewer",
  "findings": [
    {
      "severity": "blocker | major | minor | nit",
      "confidence": "high | medium | low",
      "path": "relative/path/from/repo/root",
      "line": 42,
      "side": "RIGHT | LEFT",
      "lane": "intent | reuse | disagreeable | security | robustness | testability",
      "out_of_diff": false,
      "evidence": "verbatim source line backing the claim (see evidence rules below)",
      "summary": "one sentence",
      "fix": "concrete diff or named action — no generic advice"
    }
  ],
  "strengths": [
    { "path": "...", "line": 12, "note": "concrete reason it matters" }
  ],
  "open_questions": [ "string" ]
}
```

Each row MUST satisfy: `severity ∈ {blocker, major, minor, nit}`, `confidence ∈ {high, medium, low}`, `line ≥ 1`, `path` non-empty, `evidence` non-empty. `out_of_diff` defaults to `false` when absent. Malformed rows are dropped; if all rows from a reviewer are malformed, treat that lane as failed (see Phase 3 partial-failure rules).

**Evidence rules:**

- In-diff finding (`out_of_diff: false`): `evidence` is the verbatim `+` or `-` line from the raw diff (without the leading `+`/`-` marker), copied exactly — no paraphrase. The aggregator string-matches it against the diff; no match → auto-drop.
- Out-of-diff finding (`out_of_diff: true`, lanes `security`/`robustness`/`disagreeable`): only allowed when the PR's changed code **newly reaches or exposes** the cited code (new call path, new input flow, new config that feeds it). `evidence` is the verbatim source line read from the checkout at `HEAD_SHA`, and `summary` must name the in-diff line that creates the exposure. These never count toward the verdict math (see Phase 3), but they are preserved — not dropped.
- Missing-implementation finding (`out_of_diff: true`, lane `intent`): the defect is absence, so there is no diff line to cite. `path`/`line` point at the requirement source (`contracts.md:N`, `{TICKET}-PLAN.md:N`, or `PR_DESCRIPTION:1` / `<TICKET-KEY>:1` for non-file sources); `evidence` is the verbatim requirement text; `summary` states what was searched to confirm absence. These **do** count toward the verdict math (a missing requirement is a real defect of this PR) but get no inline comment.

### Partial-failure contract

If any of the three subagents errors, times out, or returns unparseable output:

- Without `--allow-partial`: refuse to post. Write the partial output to `./.review-pr-3-sided.<pr_number>.partial.md` and exit non-zero.
- With `--allow-partial`: proceed with the surviving reviewers and prepend to the umbrella body:
  > _Verdict generated with K/3 reviewers; the `<missing>` lane is unavailable. Treat `<missing>` coverage (spec compliance / correctness / security-robustness) as incomplete._

## Phase 2.5 — Verification stage (main agent + verifier subagents)

Hallucinated blockers/majors are the most expensive failure mode — verify before aggregating.

1. **Evidence match (mechanical, all findings)**:
   - `out_of_diff: false`: the `evidence` string must appear verbatim as a `+`/`-` line in the raw diff (whitespace-trimmed comparison). No match → drop the finding and record it under Rejected findings as `evidence not in diff`.
   - If the evidence matches but the cited `line` is wrong, **remap** the line to the actual diff line containing that evidence (same file, same side) instead of dropping. Reviewers routinely cite the enclosing statement; content match beats exact line match.
   - `out_of_diff: true` (exposure findings): read the cited file at `HEAD_SHA` and confirm the `evidence` line exists at (or within ±5 lines of) the cited line, and that the summary names a real in-diff exposure point. Fail either check → drop as hallucination.
   - `out_of_diff: true`, lane `intent` (missing-implementation findings): confirm the `evidence` requirement text appears verbatim in the cited source (`contracts.md`, plan, ticket body, or PR description from `INTENT_SOURCES`). Paraphrased requirements → drop; the spec must say what the finding claims it says.
2. **Adversarial verify (blockers and majors only)**: for each surviving blocker/major, dispatch one verifier subagent (general-purpose; tools: Read, Glob, Grep, Bash) prompted to **refute** the finding:
   - It must read the full file (not just the diff hunk), grep for callers/usages, and where the claim is mechanically checkable (regex behavior, template-engine semantics, shell quoting, test assertions), verify with a small read-only one-liner.
   - For missing-implementation findings (lane `intent`), the refutation is **finding the implementation**: grep the checkout at `HEAD_SHA` for handlers, fields, or tests satisfying the quoted requirement — including under names the reviewer didn't guess. In stacked-PR workflows also check whether the requirement is explicitly assigned to a later phase in the plan; if so, downgrade to a note, not a defect.
   - It returns `{ "verdict": "confirmed | refuted | downgrade", "reason": "...", "suggested_severity": "..." }`.
   - `refuted` → move to Rejected findings with the refutation reason. `downgrade` → apply the suggested severity. `confirmed` → proceed.
   - Dispatch verifiers in parallel. Minors and nits skip this stage (cost control).
3. **Resolve open questions from the repo**: for each `open_questions` item across reviewers, decide whether it is answerable from the checkout (grep for an interface implementation, a config value, a caller). If yes, answer it now — inline or via one Explore subagent for the batch — and fold the answer into the affected finding's severity. Only genuinely external questions (deployment config, infra ACLs, product intent) survive as Open Questions in the body.

## Phase 3 — Main agent aggregation

1. **Collect** verified findings from Phase 2.5 (plus all minors/nits that passed the evidence match).
2. **Separate scopes**: split findings into three sets. **In-diff** findings participate in inline-comment ranking and verdict math. **Exposure** findings (`out_of_diff: true`, non-intent lanes) go to the `Out-of-diff observations` body section — no inline comments (GitHub rejects comments outside the diff), no verdict weight beyond the escalation rule. **Missing-implementation** findings (`out_of_diff: true`, lane `intent`) count toward verdict math and are listed in the normal `Blockers`/`Majors` sections marked `[missing implementation — no inline comment]`.
3. **Deduplicate**: group by `(path, line)` and merge into one finding. Keep the highest severity, take the most actionable phrasing, and union the fix recommendations. Then dedupe against **existing unresolved review comments** from the Phase 1 bundle: if a finding materially duplicates an existing comment (same path, same root cause), drop it from inline comments and list it in the umbrella body as `already flagged by <author> — still open` instead of re-reporting it as new.
4. **Resolve conflicts** (apply in order):
   - Security finding with a named OWASP class ≥ Intent finding quoting the violated requirement verbatim > Disagreeable finding with a concrete failure mode > any finding without quoted evidence of its claim.
   - If two reviewers agree on the same root cause, merge into one finding even if phrasing differs.
   - If a strength (any reviewer) contradicts a concrete defect from another lane, drop the strength and keep the defect.
   - If reviewers disagree and none has concrete evidence, downgrade to an Open Question.
   - A blocker/major with `confidence: low` that was not upgraded by Phase 2.5 verification is demoted to an Open Question — low-confidence findings never drive `request changes` on their own.
5. **Redact**: scrub `$HOME`, absolute filesystem paths outside the repo, internal hostnames, API keys/tokens, and any code excerpts not present as `+`/`-` lines in the parsed diff. Apply this pass before any output is assembled — nothing posts publicly that wasn't already public in the diff.
6. **Bind verdict to findings** (per `agents/_severity-rubric.md`). Verdict math counts **verified in-diff findings plus verified intent-lane missing-implementation findings**, with one escalation rule:
   - `blockers > 0` → `request changes`.
   - `blockers == 0` and `majors > 0` → `request changes` (default) or `needs discussion` if reviewers conflict.
   - `blockers == 0` and `majors == 0` → `approve`.
   - **Newly-exposed dependency risk**: a verified out-of-diff `security`-lane finding of major+ severity whose exposure point is in this diff escalates `approve` → `needs discussion`. It never forces `request changes` (the defect isn't in the author's diff), but an unqualified approve on a PR that opens a new path to a known vulnerability is wrong.
   - `SELF_REVIEW=1`: keep the verdict label in the body, but Phase 4 forces the GitHub review event to `--comment`.
7. **Rank** surviving findings by severity, then by blast radius.
8. **Produce final body** with a stable footer signature so Phase 4 can detect prior runs:

   ```markdown
   ## 3-Sided Code Review — Verdict: <approve | request changes | needs discussion>

   <one-sentence justification>

   ### Blockers
   - `file:line` — problem. Fix: ...

   ### Majors
   - `file:line` — problem. Fix: ...

   ### Minors / Nits
   - ...

   ### Out-of-diff observations
   _Verified findings in code this PR newly exposes — excluded from verdict math, no inline comments._
   - `file:line` — problem. Exposed by: `<in-diff file:line>`. Fix: ...

   ### Strengths
   - ...

   ### Open questions
   - ...

   ### Rejected findings
   _Reviewer claims dropped in verification — recorded for transparency and prompt tuning._
   - `file:line` — claim. Dropped: <refutation reason>.

   <!-- review-pr-3-sided:v1 -->
   _Generated by `/review-pr-3-sided` (intent + disagreeable + security reviewers)._
   ```

   Omit any section that is empty (`_None._` is fine for Blockers/Majors since their absence is the verdict's justification; drop empty optional sections entirely).

## Phase 4 — Post review to GitHub

After the aggregated verdict is finalized, publish it to the PR.

### 4.1 — Compute event

Map verdict to `gh` event:

- `approve` → `--approve`
- `request changes` → `--request-changes`
- `needs discussion` → `--comment`

If `SELF_REVIEW=1`, force `--comment` and prepend the body with:

> _Posted as `COMMENT` due to self-review constraint (GitHub blocks self-approve/request-changes); intended verdict is `<verdict>`._

### 4.2 — Idempotency check

Query existing reviews:

```bash
PRIOR_REVIEW=$(gh api "/repos/<owner>/<repo>/pulls/<pr_number>/reviews" \
  --jq --arg me "$ME" '[.[] | select(.user.login==$me) | {id, html_url, body}] | map(select(.body | contains("review-pr-3-sided:v1"))) | last // empty')
```

If `$PRIOR_REVIEW` is non-empty, a prior `<!-- review-pr-3-sided:v1 -->` review by the current user exists. **This is the normal re-invocation case: re-review the PR at the current HEAD (paying particular attention to what changed since the prior review) and post a NEW delta review — do not abort, and do not silently re-post the same findings.** Print the prior review URL (`echo "$PRIOR_REVIEW" | jq -r .html_url`) for reference, then proceed with the delta logic below. The `--follow-up` flag is now redundant for this path (kept only for backward compatibility / explicit callers like the run-plan workflow); re-invocation follows the delta contract whether or not it is passed. This does not relax the Phase 2 partial-failure contract.

To focus the re-review on new changes, diff the current HEAD against the SHA the prior review was posted at when it is recoverable — the prior review body's footer or the `commit_id` of the prior review (`gh api "/repos/<owner>/<repo>/pulls/<pr_number>/reviews/<prior_id>" -q .commit_id`). Prioritize findings in code changed since that SHA; still run all three lanes across the full diff so regressions outside the new hunks are not missed.

**A re-invocation posts a delta, not a repeat.** Parse the prior review body and classify each current finding against it:

- **New** (not in the prior review): post normally, inline where eligible.
- **Resolved** (in the prior review, no longer found at the new HEAD): list under a `### Resolved since last review` section — confirming fixes is half the value of a re-review.
- **Still open** (in both): one line under `### Still open from last review`, no new inline comment.

The delta review's verdict is computed from new + still-open findings only. If everything from the prior review is resolved and nothing new was found, the follow-up is an `--approve` (or `--comment` under `SELF_REVIEW`) saying so.

### 4.3 — Write body to a file (no heredocs with model output)

Model-generated text may legitimately contain ` ``` `, `EOF`, or backticks. Heredocs and double-quoted strings are unsafe. Write the body to a temp file and pass `--body-file`:

```bash
BODY_FILE=$(mktemp -t review-pr-3-sided.XXXXXX.md)
printf '%s' "$AGGREGATED_BODY" > "$BODY_FILE"
trap 'rm -f "$BODY_FILE"' EXIT
```

`$AGGREGATED_BODY` MUST be the Phase 3 redacted output and nothing else. Never construct the body via heredoc with subagent output interpolated.

### 4.4 — Submit verdict + inline comments atomically

Use the single-call Reviews API so all inline comments and the umbrella body land in one review. Cap inline comments at 25 (Blockers and Majors only; Minors/Nits stay in the umbrella body). If Blockers + Majors exceed 25, post the first 25 inline (highest severity first, then by blast radius) and leave the rest in their original `Blockers` or `Majors` section of the umbrella body, each appended with `[NOT POSTED INLINE DUE TO 25-CAP]`. Never downgrade dropped findings into `Minors / Nits`.

```bash
# Build comments[] from the validated findings (path/line/side already in CHANGED_LINES).
# Each comment uses the Phase 1 HEAD_SHA, not a freshly resolved SHA.
gh api -X POST "/repos/<owner>/<repo>/pulls/<pr_number>/reviews" \
  -f commit_id="$HEAD_SHA" \
  -f event="$EVENT" \
  --field body=@"$BODY_FILE" \
  -f 'comments[][path]=path/to/file.ts' \
  -f 'comments[][line]=42' \
  -f 'comments[][side]=RIGHT' \
  -f 'comments[][body]=blocker: …. Fix: …'
```

If a `gh` call returns 5xx, retry up to 3 times with exponential backoff (1s, 2s, 4s). If 429, sleep for the `Retry-After` header value (cap 60s) and retry once. Wrap every `gh` call in `timeout 30s`.

### 4.5 — Failure handling

- If `gh auth status` fails or the repo is inaccessible: write `$AGGREGATED_BODY` to `./.review-pr-3-sided.<pr_number>.md`, print the path and the underlying error, exit non-zero.
- If the umbrella review POST succeeds but inline comments were truncated by the 25-cap: the dropped findings already live in their original `Blockers`/`Majors` section of the umbrella body marked `[NOT POSTED INLINE DUE TO 25-CAP]` (per 4.4). Also list them under "Open questions" so they aren't lost.
- If the POST partially succeeds (e.g., inline comments accepted but event rejected): record the review ID, print recovery hints (`--inline-only` to retry without re-posting the body), exit non-zero.
- Never swallow errors silently. Every failure path prints the failing command (with secrets redacted), the HTTP status, and the persisted body path.

### 4.6 — Dry-run

If the token list contains the standalone token `--dry-run`:

- Print the assembled `$AGGREGATED_BODY` to stdout.
- Print the exact `gh api` command(s) that would run, with `<BODY_FILE>` as a placeholder.
- Do not call any mutating `gh` command. `gh pr view` and `gh pr diff` are still allowed.

### 4.7 — Confirmation

After a successful post, print the review URL from the API response so the user can open it directly.

Then tear down the review worktree from Phase 1: `git -C <repo_root> worktree remove --force "$CHECKOUT_ROOT"`. Do this on every exit path (including the failure paths in 4.5 and the dry-run in 4.6), so a throwaway checkout is never left behind. Skip it only when the Contents-API fallback was used (no worktree was created).

Finally, **restore the caller's branch**: `git -C <repo_root> checkout "$ORIGINAL_REF"` (the ref recorded in Phase 1 step 0), so the user ends on the branch they started from. Run this on every exit path — success, the failure paths in 4.5, and the dry-run in 4.6. Skip only if `git -C <repo_root> symbolic-ref --quiet --short HEAD` already reports `ORIGINAL_REF` (nothing moved, e.g. the default-worktree path).

### 4.8 — Precision log

Append one line per run to `~/.claude/review-pr-3-sided.stats.jsonl` (create if missing):

```json
{"date":"<ISO date>","repo":"<owner>/<repo>","pr":<n>,"verdict":"...","per_lane":{"intent":{"raw":N,"accepted":N,"rejected":N},"disagreeable":{...},"security":{...}},"rejected_reasons":["..."]}
```

This is how reviewer prompts get tuned: a lane with a persistently high rejected/raw ratio needs its agent prompt tightened, with the recurring `rejected_reasons` as the evidence.

## Constraints

- Every in-diff citation must match `CHANGED_LINES` after evidence-based remapping; every out-of-diff citation must be verified against the checkout at `HEAD_SHA`. No unverified citations post anywhere.
- No generic advice ("add more tests") — every recommendation names the specific test or fix.
- If a subagent has nothing to say in its lane, it returns no findings rather than padding.
- Per-finding budget ≤ 2 sentences; umbrella body soft target ≤ 600 words (Resolved/Rejected sections excluded from the budget).
- Blockers and majors never post without surviving Phase 2.5 adversarial verification.
- Never post to GitHub before Phase 3 aggregation completes — raw subagent output must not leak into PR comments.
- Never construct GitHub bodies via heredocs or double-quoted strings containing model-generated text. `--body-file` only.
- Never interpolate raw `$ARGUMENTS` into a shell command. Only validated, regex-matched variables.
