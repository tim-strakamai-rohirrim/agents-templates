---
name: "Close Snyk PRs"
description: "Consolidate all open [Snyk] dependency-bump PRs for a given repo into one branch, open a single PR, and close the superseded ones."
category: Maintenance
tags: [snyk, dependencies, pr, github, npm]
---

Consolidate open Snyk dependency-bump PRs for repo: `$ARGUMENTS`

`$ARGUMENTS` is the bare repo name under the `rohancapture` org, optionally followed by `--dry-run` (e.g. `rohan_ui`, `rohan_api --dry-run`). No slashes, no URLs.

---

## Phase 0 — Validate input

1. Trim `$ARGUMENTS`. Split on whitespace. Reject if empty.
2. Tokens after the repo name: only `--dry-run` is accepted; anything else is a hard error.
3. Match repo token against `^[A-Za-z0-9._-]{1,100}$`. Reject anything else — never interpolate raw `$ARGUMENTS` into shell commands.
4. **Additional path-safety checks (after regex):**
   - Reject if repo equals `.` or `-` or `..`.
   - Reject if repo contains the substring `..`.
   - Reject if repo starts with `-` (would be parsed as a flag by `gh`).
5. Set `OWNER=rohancapture`, `REPO=<validated arg>`, `DRY_RUN=<true|false>`.
6. Confirm repo accessible: `gh repo view "$OWNER/$REPO" --json nameWithOwner -q .nameWithOwner`. Abort on error.
7. Confirm `package.json` exists at repo root (this command only handles npm-based repos — `rohan_ui`, `rohan_api`). Abort otherwise.

---

## Phase 1 — Locate the local checkout

The user's workspace root is `/Users/catherinecheng/Desktop/workspace`. Expected path: `<workspace>/<REPO>`.

1. If `<workspace>/<REPO>` is not a git repo, abort and ask the user where the checkout lives.
2. `cd` into it for the rest of the run. Use absolute paths in tool calls; do not chain `cd` with git.
3. **Capture the user's starting branch:** `ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)`. Every abort path in Phases 2–7 and the success path in Phase 8 must `git checkout "$ORIGINAL_BRANCH"` before exiting.
4. Refuse to proceed if working tree dirty (`git status --porcelain` non-empty). Tell the user to stash/commit first.

---

## Phase 2 — Sync main, create consolidation branch

1. `git fetch origin --prune`
2. `git checkout main`
3. `git pull --ff-only origin main` — abort if not fast-forward.
4. Build branch name with UTC timestamp to second precision: `chore/snyk-consolidate-$(date -u +%Y-%m-%d-%H%M%S)` (e.g. `chore/snyk-consolidate-2026-05-28-193045`).
5. Verify the branch is unused both locally AND remotely:
   - `git show-ref --verify --quiet "refs/heads/$BRANCH"` → must return non-zero.
   - `git ls-remote --exit-code --heads origin "$BRANCH"` → must return non-zero (no such ref).
   - If either exists, append `-2`, `-3`, etc. and re-check both.
6. `git checkout -b "$BRANCH"`

---

## Phase 3 — Enumerate Snyk PRs

1. `gh pr list --repo "$OWNER/$REPO" --state open --limit 200 --json number,title,headRefName,headRefOid,author,url`
2. Filter to PRs where:
   - title starts with `[Snyk]` (case-insensitive), AND
   - **author login is an exact match** for one of: `snyk-bot`, `snyk[bot]`, `snyk-io`. No substring matching — `notsnyk`, `evilsnyk`, etc. must be rejected.
3. If zero matches, report "No open Snyk PRs", restore `ORIGINAL_BRANCH`, delete the unused branch, exit cleanly.
4. Print the table of candidates **including the raw `author.login`** for each row so the user can spot impostors before confirming.

---

## Phase 4 — Decide which bumps to take

Maintain an in-memory map `QUEUED = {package: {version, sourcePR}}` that tracks the highest version queued for each package across the loop. This is the live baseline for dedup and conflict resolution — NOT the unmodified `package.json` on disk.

For each candidate PR (in PR-number order):

1. **List changed files first** with a retry loop:
   - `gh pr diff <number> --repo "$OWNER/$REPO" --name-only`
   - Wrap each `gh pr diff` call in a 3-try exponential backoff (1s, 2s, 4s). On HTTP 429, honor the `Retry-After` header instead.
   - On 3 consecutive failures (any error, including 429), bucket as **skip-manual** with reason `gh pr diff failed: <error>` — do NOT treat an empty diff as "no changes".
2. If changed files are a subset of `{package.json, package-lock.json}` but `package.json` is NOT changed → route to **take-lockfile-only** bucket (transitive CVE pin). Record the PR; Phase 5 will cherry-pick its lockfile delta.
3. If changed files include anything outside `{package.json, package-lock.json}` → **skip-manual**.
4. Otherwise, fetch the manifest diff (same retry rules): `gh pr diff <number> --repo "$OWNER/$REPO" -- package.json`.
5. **Collect ALL `(package, oldVersion, newVersion)` tuples** from the diff — a single PR may bump multiple packages. If zero parseable tuples come back, route to **skip-manual** with reason `unparseable manifest diff`.
6. For each tuple `(pkg, old, new)`:
   - Use semver comparison (not string compare). Strip range prefixes (`^`, `~`, `>=`) before comparing.
   - Read current version from `<workspace>/<REPO>/package.json` on the new branch.
   - Compare `new` against `max(currentVersion, QUEUED[pkg]?.version)`:
     - If `new <=` baseline → mark this tuple as stale (PR-level bucket below).
     - Else → record `QUEUED[pkg] = {version: new, sourcePR: <number>}` and mark this tuple as taken. If `QUEUED[pkg]` previously pointed at a different PR, that earlier PR becomes **skip-conflict** (loser); the new PR is the current winner.
7. **PR-level bucket** (after evaluating all its tuples):
   - **take**: at least one tuple was taken and not later displaced.
   - **skip-stale**: every tuple was stale vs current/queued.
   - **skip-conflict**: every taken tuple was later displaced by a higher version from a different PR.
   - **take-lockfile-only**: routed in step 2.
   - **skip-manual**: routed in step 1, 3, or 5.

Print the bucketed plan, including the raw `author.login` per row and the `QUEUED` map. **If `DRY_RUN=true`, restore `ORIGINAL_BRANCH`, delete the unused branch, and exit here — print a structured report, take no further action.**

Otherwise pause for explicit user confirmation before mutating files. **First confirmation gate.**

---

## Phase 5 — Apply version bumps

For each PR in the **take** bucket (and each tuple inside it that's still the winner in `QUEUED`):

1. Update `package.json` directly with the Edit tool — set the dep's version to the PR's `newVersion`. Preserve the existing range prefix (`^`, `~`) where one exists.
2. Do NOT cherry-pick Snyk commits — Snyk PRs often include lockfile churn that conflicts across PRs. Editing `package.json` and regenerating the lockfile is cleaner.

For each PR in the **take-lockfile-only** bucket:

3. Cherry-pick only its `package-lock.json` delta:
   - `git fetch origin "pull/<number>/head:_snyk_<number>"`
   - `git checkout _snyk_<number> -- package-lock.json` (manifest unchanged)
   - Record the PR number in the lockfile-source list.

After all manifest edits and lockfile picks are applied:

4. **Run `npm install --ignore-scripts`** to regenerate `package-lock.json` from the new manifest. `--ignore-scripts` is mandatory — Snyk PR contents are untrusted input; running preinstall/postinstall scripts of attacker-controlled versions is an RCE primitive.
5. **Verify integrity of each taken version:** for every `(pkg, new)` in the winners list, run `npm view <pkg>@<new> dist.integrity` and confirm the value matches the `integrity` field in the regenerated `package-lock.json`. Mismatch → abort, restore `ORIGINAL_BRANCH`, leave the consolidation branch in place for inspection.
6. **Compare against Snyk's lockfile pins:** for each source PR, diff the regenerated `package-lock.json` against the Snyk PR's `package-lock.json` (`gh pr diff <number> --repo "$OWNER/$REPO" -- package-lock.json`). Surface any transitive pin present in Snyk's lockfile but missing from ours — print the package, the Snyk-pinned version, and the CVE if visible in the PR title. Do not auto-abort; warn loudly so the engineer can decide.
7. `git add package.json package-lock.json`
8. Write the commit body to a tmpfile and commit via `--file`:
   - `BODY_FILE=$(mktemp)`
   - For each taken tuple, append `printf '%s\n' "- <pkg>: <old> -> <new> (from #<sourcePR>)" >> "$BODY_FILE"` (printf to avoid shell evaluation of package names — backtick or `$( )` in a name would otherwise execute).
   - `git commit -m "chore(deps): consolidate Snyk version bumps" --file "$BODY_FILE"`
   - `rm "$BODY_FILE"`

---

## Phase 6 — Push and open consolidation PR

1. `git push -u origin "$BRANCH"`
2. PR title: `chore(deps): consolidate Snyk dependency bumps`
3. **Build the PR body in a tmpfile with `printf '%s\n'`, then pass via `--body-file`** — never `--body "$(cat <<EOF ... EOF)"`. PR titles and package names from upstream are untrusted; a line containing `EOF` (or backticks, `$( )`) would terminate the heredoc or be evaluated, with the GH token in env.
   ```
   BODY_FILE=$(mktemp)
   printf '%s\n' "## Summary" >> "$BODY_FILE"
   printf '%s\n' "Rolls up <N> open Snyk dependency-bump PRs into a single update." >> "$BODY_FILE"
   printf '%s\n' "" >> "$BODY_FILE"
   printf '%s\n' "## Bumps included" >> "$BODY_FILE"
   # one printf per row, with the row pre-built as a Python/JS string, not via shell interpolation
   ...
   ```
   Body sections to include:
   - **Summary** — count of source PRs consolidated.
   - **Bumps included** — `<pkg>: <old> → <new> (supersedes #<num>)` per winner.
   - **Lockfile-only pins included** — source PR numbers from the `take-lockfile-only` bucket.
   - **Superseded PRs (will be closed)** — `#<num> — <title>` for **take** + **skip-conflict** + **take-lockfile-only**.
   - **Closed as stale (already at/above target)** — `#<num> — <title>` for **skip-stale**. Distinct section, distinct close reason in Phase 7.
   - **Skipped (needs manual review)** — `#<num> — <reason>` for **skip-manual**.
   - Trailing `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
4. `gh pr create --repo "$OWNER/$REPO" --base main --head "$BRANCH" --title "..." --body-file "$BODY_FILE"`
5. `rm "$BODY_FILE"`
6. Capture the new PR URL and number as `NEW_PR_NUMBER` / `NEW_PR_URL`.

---

## Phase 6.5 — Second confirmation gate

Before any `gh pr close`, print:
- `NEW_PR_URL`
- Exact PR-number list to be closed as **Superseded** (take + skip-conflict + take-lockfile-only).
- Exact PR-number list to be closed as **Stale** (skip-stale).
- PR-number list left untouched (skip-manual).

Pause for explicit user confirmation. The Phase 4 gate authorized the bumps; this gate authorizes the bulk close now that the consolidation PR exists and is reviewable.

---

## Phase 7 — Close superseded PRs

Initialize a recovery manifest:
- `MANIFEST=$(mktemp -t snyk-consolidate-XXXXXX.json)`
- Write initial JSON: `{"consolidation_pr": "<NEW_PR_URL>", "branch": "<BRANCH>", "ops": []}`
- Print the manifest path to the user immediately so they can find it if the run aborts.

For each PR to be closed, perform the ops in this order and append a record to `MANIFEST.ops` **atomically after each op** (write to a tmp file, `mv` over the manifest). On any error, stop the loop and print the manifest path.

**For PRs in take / skip-conflict / take-lockfile-only buckets:**

1. **Verify the winner actually landed** in the committed `package.json` before closing:
   - For each tuple this PR contributed, read `<workspace>/<REPO>/package.json` and confirm the version on disk matches `QUEUED[pkg].version`.
   - If mismatch → skip the close, append `{pr: <num>, status: "skipped-not-in-consolidation", reason: "..."}` to the manifest, continue.
2. Comment: `gh pr comment <number> --repo "$OWNER/$REPO" --body-file <tmpfile>` where the body is `Superseded by <NEW_PR_URL> (consolidated Snyk bumps).` written via `printf '%s\n'` to a tmpfile.
3. Close: `gh pr close <number> --repo "$OWNER/$REPO"` (do NOT pass `--delete-branch` — Snyk owns the branch and will recreate; let it manage cleanup).
4. Append `{pr: <num>, status: "closed-superseded", commented_at: "...", closed_at: "..."}`.

**For PRs in skip-stale bucket:**

5. Comment with a **distinct** message — do NOT say "Superseded by #X" because the bump is NOT in #X:
   - Body: `Closing as stale: target version is already at or above <oldVersion-from-this-PR> on main. Consolidation PR for review: <NEW_PR_URL>.`
6. Close (same `gh pr close`, no branch delete).
7. Append `{pr: <num>, status: "closed-stale", ...}`.

**Do NOT close PRs in the skip-manual bucket.** Report them so the engineer handles by hand. Append `{pr: <num>, status: "left-open-manual", reason: "..."}`.

---

## Phase 8 — Final report and restore

1. Restore the user's original branch: `git checkout "$ORIGINAL_BRANCH"`.
2. Print:
   - Consolidation PR URL.
   - Count closed as superseded.
   - Count closed as stale.
   - Count left open (manual / not-in-consolidation).
   - Recovery manifest path.
   - Any errors encountered (non-fatal ones that were logged but didn't abort).

---

## Guardrails

- Never `git push --force`.
- Never use `--no-verify` on commits.
- Never use `npm install` without `--ignore-scripts` on untrusted PR contents.
- Never close a PR you didn't first comment on with a link to its replacement (or, for skip-stale, with a distinct stale reason).
- Never build `gh` / `git commit` message bodies with `$(cat <<EOF…EOF)` or other shell-evaluated forms when the content includes upstream-controlled strings (package names, PR titles, author logins). Use `printf '%s\n'` to a tmpfile and `--body-file` / `--file`.
- On any abort in Phases 2–7: restore `ORIGINAL_BRANCH`, print the recovery manifest path if Phase 7 had started, and **do not auto-rollback** GitHub state — the engineer needs to see what landed.
- This command mutates GitHub state. There are two mandatory confirmation gates: Phase 4 (before file edits) and Phase 6.5 (before bulk close, after the consolidation PR is reviewable).
- `--dry-run` halts after Phase 4's plan table; supports validating discovery and bucketing without risk.
