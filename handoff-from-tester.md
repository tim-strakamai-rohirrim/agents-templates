Write a handoff message in this format:

### Handoff: Testing / Reviewer → Planner / Implementers

Handoff from **Testing/Reviewer agent**

`Scope reviewed:` [plan items + key files]

`Test updates:`

- `src/.../*.spec.ts`: [coverage summary]
- `e2e/tests/*.spec.ts`: [flows covered]
- `test/...spec.ts` (backend): [paths and edge cases covered]

`Issues:`

- [Severity: High/Medium/Low] – [file] – [brief description]
- …

`Next owner:` [PLANNER] to define next steps, or [FRONTEND] / [BACKEND_DB] for fixes.
