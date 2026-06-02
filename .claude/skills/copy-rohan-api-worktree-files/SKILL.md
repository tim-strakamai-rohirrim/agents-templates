---
name: copy-rohan-api-worktree-files
description: Copy rohan_api `.env`, `.env.test`, and `scripts/add_user_local.sql` from the primary worktree into a feature worktree. These files are gitignored and absent from fresh worktrees. Use when the user says "copy env to worktree", "sync worktree env files", "missing .env in worktree", manually creates a rohan_api worktree, or asks to re-sync env files after primary changes.
---

# Copy rohan_api env files to a worktree

## Files

| Primary source | Worktree destination |
|---|---|
| `rohan_api-parent/rohan_api/.env` | `<worktree>/.env` |
| `rohan_api-parent/rohan_api/.env.test` | `<worktree>/.env.test` |
| `rohan_api-parent/rohan_api/scripts/add_user_local.sql` | `<worktree>/scripts/add_user_local.sql` |

All three are gitignored, so a fresh worktree does not contain them.

## Auto setup (preferred)

When Cursor creates a worktree it runs `rohan_api-parent/rohan_api/.cursor/worktrees.json`, which copies these three files from the primary before `npm ci`. No manual action needed for Cursor-created worktrees.

If the user uses plain `git worktree add` from a shell (no Cursor), the auto-setup does not run and the files must be copied manually.

## Manual copy

Use when:
- The worktree was created outside Cursor (plain `git worktree add`).
- A file changed in the primary and the worktree copy is stale.
- Auto setup failed and the files are missing.

### Step 1: Find the primary worktree

From inside any rohan_api worktree:

```bash
PRIMARY=$(git worktree list --porcelain | awk '/^worktree/{print $2; exit}')
echo "$PRIMARY"
```

The primary is the first worktree git lists — usually `…/rohan_api-parent/rohan_api`.

### Step 2: Copy from primary into the target worktree

Run from the **target worktree root** (the new feature worktree, not the primary):

```bash
PRIMARY=$(git worktree list --porcelain | awk '/^worktree/{print $2; exit}')

# Remove any pre-existing file/symlink before copying so we never write
# through a symlink back into the primary.
rm -f .env .env.test scripts/add_user_local.sql

mkdir -p scripts
cp "$PRIMARY/.env" .env
cp "$PRIMARY/.env.test" .env.test
cp "$PRIMARY/scripts/add_user_local.sql" scripts/add_user_local.sql
```

### Step 3: Verify

```bash
ls -la .env .env.test scripts/add_user_local.sql
```

All three should be regular files (no `->` arrow) with non-zero size.

## Notes

- Files are **copied**, not symlinked, so each worktree can diverge — useful for per-feature `.env` overrides like different `PORT` values.
- Re-running the copy overwrites the worktree's version. Back up local edits in the worktree before re-syncing.
- This skill covers `rohan_api` only. `rohan_ui`, `rohan-python-api`, and `ONERING` have their own `.cursor/worktrees.json` setup.
- If `scripts/add_user_local.sql` is missing in the primary too, fill it from `scripts/add_user_local.sql.template` first.
