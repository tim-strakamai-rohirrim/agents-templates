Write a handoff message in this format:

### Handoff: Backend / DB → Frontend / Tester

Handoff from **Backend/DB agent**

`Goal:` Implemented [describe backend/DB feature/bugfix] per `[BACKEND_DB]` items X–Y in `PLAN.md`.

`Changes:`

- `src/modules/.../controller.ts`: [short description]
- `src/modules/.../service.ts`: [short description]
- `src/modules/.../dto/...dto.ts`: [shape changes]
- `migrations/2026xxxx_add_feature.sql` (or TS): [schema change]
- `test/...spec.ts`: [tests added/updated]
- `contracts.md`: [documented new/changed endpoints]

`Open questions:`

- Q1:
- Q2:

`Next owner:` [FRONTEND] or [TEST_REVIEW]
