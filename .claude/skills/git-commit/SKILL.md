---
name: git-commit
description: >-
  Generate a concise commit message from the current diff and commit changes.
  Handles multi-repo workspaces and git worktrees. Use when the user asks to
  commit, write a commit message, save changes, or says "commit".
---

# Git Commit

Analyze staged/unstaged changes across one or more repos in the workspace,
draft a clear commit message, and commit — all in one step.

## Workflow

### Step 1 — Locate repos with changes

The workspace may contain multiple independent git repos and worktrees.
Determine which repo(s) the user is working in:

1. **Focused file** — if the user has a file open, use the directory of that
   file to find its git root (`git rev-parse --show-toplevel`).
2. **Explicit path** — if the user names a repo or worktree, use that.
3. **Scan** — if ambiguous, scan known repo roots and worktrees for dirty
   working trees. Run in parallel:

```bash
# Check each potential repo root
git -C <repo_path> status --porcelain
```

Common roots (relative to workspace):

| Path pattern | Repo |
|---|---|
| `rohan_api-parent/rohan_api*` | NestJS API (includes worktrees) |
| `rohan_ui-parent/rohan_ui*` | Angular UI (includes worktrees) |
| `rohan-python-api` | Python API |
| `ONERING` | ARC Agent Writer |

Worktrees live as sibling directories (e.g. `rohan_api-parent/feature/`,
`rohan_api-parent/rohan_api-PRCR-XXXX/`). Each is its own git root.

### Step 2 — Gather context (run in parallel)

For **each** repo with changes, run these simultaneously:

```bash
git -C <repo> status --short
git -C <repo> diff            # unstaged
git -C <repo> diff --cached   # staged
git -C <repo> log --oneline -5  # recent messages for style matching
git -C <repo> branch --show-current
```

### Step 3 — Stage files

- If nothing is staged but there are unstaged changes, stage everything
  relevant (`git add -A`).
- If some files are already staged, respect the user's staging — only add
  unstaged files if the user explicitly asks.
- Never stage files that look like secrets (`.env`, credentials, keys).

### Step 4 — Draft the commit message

Write a **concise** message following the conventions observed in Step 2.

#### Convention guidelines

Match the style of recent commits in the target repo. General patterns seen:

- **Subject line**: `TICKET [Module] Short imperative description`
  - Include the ticket number if the branch name contains one
    (e.g. branch `tim/PRCR-1260` → prefix `PRCR-1260`).
  - Include a `[Module]` tag if recent commits use them and the change is
    scoped to one module.
  - Keep the subject ≤ 72 chars.
- **Body** (optional): Only add a body if the diff is large or the "why"
  isn't obvious from the subject. Wrap at 72 chars.

#### Drafting rules

- Focus on **why**, not **what** — the diff already shows what changed.
- Use the imperative mood ("add", "fix", "refactor", not "added", "fixes").
- One commit per logical change. If the diff has unrelated changes, ask the
  user whether to split into multiple commits.
- If uncertain about the message, present it and ask before committing.

### Step 5 — Commit

```bash
git -C <repo> commit -m "$(cat <<'EOF'
<message>
EOF
)"
```

After committing, run `git -C <repo> status` to confirm success.

### Step 6 — Multi-repo

If multiple repos have changes, handle each repo **sequentially** — show the
message for each, commit, then move to the next. Clearly indicate which
repo you're committing in.

## Important rules

- **Never push** unless the user explicitly asks.
- **Never amend** unless the user explicitly asks and the commit is unpushed.
- **Never force-push**.
- **Never update git config**.
- **Never skip hooks** (no `--no-verify`).
- If a commit fails (e.g. pre-commit hook rejects), fix the issue and create
  a **new** commit — do not amend.
- Always pass the commit message via HEREDOC to preserve formatting.
