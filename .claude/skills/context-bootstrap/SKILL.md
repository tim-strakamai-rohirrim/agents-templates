---
name: context-bootstrap
description: |
  Load all context for the current feature: spec files, backend module,
  frontend module overview. Use at the start of any session.
  Triggers on "bootstrap", "load context", "read spec", "start session".
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Context Bootstrap

Load all relevant context for a feature before starting work.

## Read Order

### 1. Spec Files
Glob `specs/{feature}/` and read:
- `spec.md` — requirements and business rules
- `plan.md` — architecture and design decisions
- `data-model.md` — entity relationships and API contracts
- `tasks.md` — task status and acceptance criteria

### 2. Backend Module (read-only overview)
Glob `rohan_api/src/{feature}/` and scan:
- Entity files — field names, relations, enums
- Controller — endpoint paths and methods
- DTOs — request/response shapes

### 3. Frontend Module
Glob `rohan_ui/src/app/pages/{feature}/` and scan:
- Routing module — routes and lazy loading
- Types — TypeScript interfaces
- Services — API service methods, state service
- Components — main component tree

### 4. Shared Dependencies
Check if the feature uses:
- `@shared-services/` — which shared services
- `@shared-components/` — which shared components
- `@shared-types/` — which shared types

## Output

Summarize what you found:
1. Feature status (what's built vs what's planned)
2. Key files and their roles
3. API endpoints available
4. Open tasks or known gaps
