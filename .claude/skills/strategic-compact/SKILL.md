---
name: strategic-compact
description: |
  Context window management for long coding sessions.
  Triggers on "compact", "context window", "running out of context", "long session".
---

# Strategic Compaction

## When to Compact

Compact AFTER these phases (context is stale, next phase needs fresh space):
- **After research/exploration** — you've read many files, now you need to implement
- **After completing a milestone** — phase is done, commit is made, move to next phase
- **After debugging** — root cause found, fix applied, debugging context no longer needed
- **After a failed approach** — you tried something, it didn't work, pivot to a new strategy

## When NOT to Compact

Never compact in the middle of:
- Active implementation (you'll lose variable names, file paths, partial state)
- A debugging session (you'll lose the chain of evidence)
- Multi-file refactoring (you'll lose track of which files are done)

## Signs You Need Compaction
- Tool calls returning truncated results
- You're re-reading files you already read earlier in the session
- You've lost track of the current plan state or what step you're on
- Repeating the same Grep/Glob searches

## How to Compact Effectively

Before compacting, mentally organize:

1. **Key findings**: what did you learn that matters for the next step?
2. **File map**: which files need to be read again, which are done?
3. **Current plan state**: what step are you on, what's next?
4. **Decisions made**: what approaches were chosen and why?
5. **Open questions**: what still needs investigation?

## Multi-Repo Awareness

Sessions in this project often span 3+ repos:
- `rohan_api-parent/rohan_api/` (NestJS)
- `rohan_ui-parent/rohan_ui/` (Angular)
- `rohan-python-api/` (FastAPI)
- `ONERING/` (ARC Agent Writer)

Context burns fast when cross-referencing entities, DTOs, and API contracts across repos. Compact between repos when switching focus.

## Compaction Anti-Patterns
- Compacting too early (before you've gathered enough context to act)
- Compacting too late (after context is already degraded)
- Compacting without summarizing (losing critical state)
- Never compacting (running into the wall at the end of the window)
