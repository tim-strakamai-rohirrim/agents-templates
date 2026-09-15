---
name: capture-ui-evidence
description: >-
  Capture visual evidence for a PR with frontend work and attach it to the PR —
  a screenshot of every relevant state (empty, loading, error, populated) and a
  GIF of the key interaction end to end, taken from the branch's final state, so
  the change can be reviewed by observation instead of by reading the diff. Use
  when the user says "capture evidence", "screenshot the PR", "attach a GIF",
  "show me the UI change", after a draft PR with UI changes opens, and again
  after any UI-touching commit lands on a PR that already has evidence.
---

# Capture UI Evidence

A reviewer should be able to see what changed without reading the diff. For any
PR that touches the frontend, capture the affected screens from **the branch's
final state** and attach them to the PR.

Best-effort by design: this never blocks a PR. If the branch can't be served or
the screens can't be reached, skip with a one-line reason and move on.

## Inputs

- **PR number / URL** (required) — evidence is attached to this PR.
- **Repo path and branch** — where the code lives (may be a worktree).
- **Base branch** — for the diff and for before/after.

## Step 1 — Does this PR have frontend work?

```bash
git -C {repo_path} diff --name-only {base_branch}...{branch}
```

Frontend work = any changed `*.html`, `*.scss`, `*.css`, `*.component.ts`, or
anything under a `src/app/` tree. **No frontend files → stop here**, report
`skipped: no frontend changes`, attach nothing.

## Step 2 — Serve the branch's final state

Evidence must come from the PR head, so first establish which SHA that is:

```bash
git -C {repo_path} rev-parse {branch}
```

**Never `git checkout` in a repo's primary checkout** — concurrent agents are
working in it, and switching branches destroys their work. The branch is
already checked out in its phase worktree; serve that.

### 2a. Reuse a server that's already right

```bash
curl -sf -o /dev/null http://localhost:4200 && git -C {tree_behind_4200} rev-parse HEAD
```

If something is serving a tree already at the head SHA (common on single-phase
runs where the primary checkout *is* on the branch), use it and skip to Step 3.
A server on a tree at a **different** SHA is not usable — do not capture stale
pixels from it, serve the worktree alongside it instead.

### 2b. Serve the worktree on its own port

```bash
git -C {repo_path} worktree list --porcelain          # find the worktree holding {branch}
# none? create one (a branch can only be checked out in one worktree at a time):
git -C {repo_path} worktree add ../{repo-name}-{TICKET}-evidence-phase-{N} {branch}

# node_modules is gitignored, so a fresh worktree has none — symlink the
# primary's rather than paying for a full install:
ln -s ../{repo-name}/node_modules {worktree}/node_modules

# pick the first free port from 4200+N upwards, then serve in the background:
npx ng serve --port {port}
```

Wait for the server to answer (`curl -sf http://localhost:{port}`), up to ~3
minutes for a cold build. If the build fails on a missing or mismatched
dependency, run `npm ci` in the worktree once and retry; if it still fails,
skip with `skipped: worktree build failed — {first error line}`.

### 2c. Hand the session over to the new origin

OIDC sessions are stored **per origin**, so `localhost:{port}` boots logged out,
and the auth provider won't accept a redirect back to a port it doesn't know —
so don't try to log in there. Move the session the user already has instead:

1. On `http://localhost:4200`, read `localStorage` and `sessionStorage` with
   `javascript_tool` (auth/OIDC entries only).
2. Navigate to `http://localhost:{port}`, write those entries back, reload.

Rules for this hand-off: it happens **only** between two localhost origins of
this same app, in the user's own browser; the values are never echoed into a
report, a PR comment, a log line, or any other field. Never type credentials to
create a session — if `:4200` has no session either, skip with `skipped: not
authenticated`. A token that expires mid-capture cannot silently renew on this
origin; re-run the hand-off and continue.

### 2d. Tear down

Stop any dev server this skill started. Leave the worktree in place (later
re-captures reuse it); mention its path in the report.

## Step 3 — Pick the screens and states

From the diff, list every screen (route) the changed components render on. For
each, capture only the states that screen can actually be in:

| State     | How to force it                                            |
| --------- | ---------------------------------------------------------- |
| empty     | stub the screen's request with an empty payload            |
| loading   | stub it with a never-resolving / delayed response          |
| error     | stub it with a 500                                         |
| populated | the real local data (or a stubbed representative payload)  |

Force states in the browser rather than in the backend — patch the transports
once on the app shell, then navigate **in-app** (client-side routing keeps the
patch alive; a full page load discards it):

```js
// javascript_tool — installs a matcher-based stub, then route in-app
window.__stub = { match: /\/api\/pathways/, mode: 'error' }; // 'empty' | 'loading' | 'error'
const of = window.fetch;
window.fetch = (u, o) => {
  if (!window.__stub.match.test(String(u))) return of(u, o);
  const m = window.__stub.mode;
  if (m === 'loading') return new Promise(() => {});
  if (m === 'error') return Promise.resolve(new Response('{"message":"boom"}', { status: 500 }));
  return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
};
```

Angular's `HttpClient` may be on `XMLHttpRequest` instead of `fetch` — if the
stub has no visible effect, patch `XMLHttpRequest.prototype.open/send` the same
way, or throttle/offline the tab to get `loading` and `error`.

## Step 4 — Capture

Load the tools in one call:

```
ToolSearch: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__gif_creator,mcp__claude-in-chrome__upload_image
```

**Screenshots** — one per state, via `computer{action:"screenshot"}`. Each
returns an `imageId`; keep them, they are what gets uploaded. Resize to the
desktop preset first so all shots share a frame.

**GIF of the key interaction** — the one flow this PR exists to enable, end to
end (open → act → result), not a tour of the app:

1. `gif_creator{action:"start_recording"}`, then screenshot immediately (first frame).
2. Drive the flow with `computer` clicks/typing — real interactions, so the
   click overlays land where a reviewer expects.
3. Screenshot immediately, then `gif_creator{action:"stop_recording"}` (last frame).

**Before/after** — only where behavior *changed* (not for net-new screens).
Get the "before" from whatever is cheapest: an already-serving base tree, a
staging deployment, or — if the change is worth it — the base ref served in its
own worktree on another port via Step 2b (that's a second cold build, so don't
pay it for cosmetic diffs). If none is available, record one line:
`before/after: not captured — base build not served`.

## Step 5 — Attach to the PR

Attach by uploading into a PR comment through the logged-in browser — a private
repo cannot inline-render images linked from repo files, and `gh` has no
attachment API.

1. Navigate to `{pr_url}` and scroll to the comment box.
2. `gif_creator{action:"export", coordinate:[x,y]}` on the comment box to drop
   the GIF in; `upload_image{imageId, coordinate:[x,y]}` for each screenshot.
   Wait for each upload to resolve into a `![...](...)` attachment URL before
   the next.
3. Write the body around the uploaded attachments:

```markdown
## Visual evidence — @{head_sha}

| State | What to look at |
| ----- | --------------- |
| Populated | {one line} |
| Empty | {one line} |
| Loading | {one line} |
| Error | {one line} |

{screenshot attachments, labelled}

**Key interaction** — {one line: what the GIF shows end to end}

{GIF attachment}

{before/after pair, or the one-line reason it was skipped}
```

4. Post the comment.

If the upload path is unavailable (no browser, not logged in), post the same
comment as **text only** with the local capture paths listed, so the user can
drag the files in — never claim evidence is attached when it is not.

## Step 6 — Re-capture when the code moves

Evidence must match the branch's final state. After **any** commit lands on the
PR that touches frontend files — bot-cycle fixes, 3-sided fixes, manual pushes
— re-run this skill and **edit the existing evidence comment in place** with the
new captures and the new SHA in the heading. One evidence comment per PR,
always current; GitHub keeps the edit history.

## Step 7 — Report

- `captured` or `skipped` plus the one-line reason.
- Screens and states captured; whether a GIF and before/after are included.
- The head SHA the evidence reflects, and the evidence comment URL.
- How it was served: reused `:4200`, or worktree + port (and whether the
  worktree and its server are still up).

## Rules

- Evidence comes from the branch's final state, never from a stale tree.
- **Never `git checkout` in a repo's primary checkout** — other agents work
  there. Serve the branch's worktree instead.
- The harness is the UI dev server plus browser-side stubs. Don't bring up the
  backend stack, databases, or migrations to make a state reachable — stub it.
- Never type credentials to create a session. The only session move allowed is
  copying an existing one between two localhost origins of this app, in the
  user's own browser, with the values never written into any report, comment,
  or log.
- Never flip the PR out of draft, never push code from this skill.
- Stop every server this skill started, even on the skip paths.
- Say what you skipped and why, every time. Silence reads as "verified".
