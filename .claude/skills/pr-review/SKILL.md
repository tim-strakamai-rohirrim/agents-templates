---
name: pr-review
description: |
  Read and resolve all comments on a GitHub PR.
  Triggers on "pr review", "review pr", "resolve comments", "pr comments".
allowed-tools:
  - Read
  - Edit
  - Glob
  - Grep
  - Bash
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
---

# PR Comment Resolution

Read and resolve all comments on a GitHub PR.

## Process

### 1. Fetch Comments

Fetch all three comment sources:

```bash
# Inline review comments (attached to file/line) — covers #discussion_r* URLs
gh api repos/{owner}/{repo}/pulls/{number}/comments

# PR-level issue comments (general discussion box) — covers #issuecomment-* URLs
gh api repos/{owner}/{repo}/issues/{number}/comments

# Review summaries (approve/request-changes bodies)
gh api repos/{owner}/{repo}/pulls/{number}/reviews
```

**Include in the working list:**
- Every inline review comment where `in_reply_to_id` is null (top of a thread)
- Every issue comment with a non-empty, non-bot body
- Every review with a non-empty body

**Exclude:**
- Bot comments (coderabbit, github-actions, etc.) unless they flag a real defect
- Replies (`in_reply_to_id` is set) — they're follow-ups to a thread already captured above

### 2. Categorize Each Comment

For every comment, determine:

| Category | Action |
|----------|--------|
| **Valid — code change needed** | Fix it now |
| **Valid — already addressed** | Note which commit/line fixes it |
| **Invalid — disagree** | Explain why with evidence (use context7 if pattern dispute) |
| **Nit — style only** | Fix if trivial, skip if subjective |
| **Question — needs answer** | Provide the answer |
| **Backend issue** | Flag as "not in frontend scope" |

### 3. Be Critical

- Don't blindly agree with every comment. Push back when:
  - The suggestion adds unnecessary complexity
  - The pattern is correct per Angular 20+ best practices (verify with context7)
  - The change is out of scope for this PR
  - The reviewer misread the code

- Do agree when:
  - There's a real bug or regression
  - The suggestion simplifies code
  - There's a type safety issue
  - Accessibility is impacted

### 4. Make Changes

For valid comments:
1. Read the relevant file
2. Make the fix
3. Run build to verify: `cd rohan_ui && npx ng build --configuration=development 2>&1 | head -50`

### 5. Reply to Every Thread (always)

After making changes, post a reply to **every** comment in the working list — no exceptions, even for pushed-back or out-of-scope items. The reply states the outcome and, for fixes, the commit SHA. Do this before the summary.

```bash
# Inline thread reply (use the top-of-thread comment id)
gh api repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies -f body="Done in {sha} — <what changed>."

# Review-level nitpicks or general items with no inline thread → one PR-level comment
gh api repos/{owner}/{repo}/issues/{number}/comments -f body="<summary of remaining items>"
```

Reply outcomes, one line each:
- **Fixed** → `Done in {sha} — <change>.`
- **Already addressed** → `Already handled in {sha}/{line}.`
- **Pushed back** → `Not changing — <evidence>.`
- **Intentional / deferred** → `Intentional: <why>.` / `Deferred until <trigger>.`
- **Out of scope** → `Out of scope here — belongs in <repo/owner>.`

Do **not** resolve threads (mark conversations resolved) unless the user asks — that's the reviewer's call.

### 6. Output Summary

```markdown
## PR #{number} Comment Resolution

### Fixed ({count})
| # | Comment | File | Change |
|---|---------|------|--------|

### Already Done ({count})
| # | Comment | Evidence |
|---|---------|----------|

### Pushed Back ({count})
| # | Comment | Reason |
|---|---------|--------|

### Out of Scope ({count})
| # | Comment | Owner |
|---|---------|-------|
```
