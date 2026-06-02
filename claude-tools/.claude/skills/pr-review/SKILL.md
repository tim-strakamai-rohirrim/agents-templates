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
```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments
gh api repos/{owner}/{repo}/pulls/{number}/reviews
```

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
  - The pattern is correct per Angular 19+ best practices (verify with context7)
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

### 5. Output Summary

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
