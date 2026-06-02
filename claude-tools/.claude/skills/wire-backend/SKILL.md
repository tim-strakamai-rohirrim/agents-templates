---
name: wire-backend
description: |
  Analyze a backend PR/branch, compare API changes against frontend types/services/mocks,
  and update the frontend to match. Triggers on "wire backend", "sync api",
  "backend pr", "wire up api".
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
---

# Wire Backend API

Sync frontend types, services, and mocks with backend API changes.

## Process

### 1. Identify the Module
- User provides: a PR URL, branch name, or module name
- Backend: `rohan_api/src/{module}/`
- Frontend: `rohan_ui/src/app/pages/{module}/`

### 2. Analyze Backend
Read entities, DTOs, controller, service. If PR URL provided:
```bash
gh pr diff {number} --repo rohancapture/rohan_api
```
Extract: endpoints (method, path, request/response shape), entity fields, relations loaded.

### 3. Compare with Frontend
- Types: `rohan_ui/src/app/pages/{module}/types/`
- API service: `*-api.service.ts`
- Mock service: `*-api.service.mock.ts`
- State service: `*-state*.service.ts`

### 4. Report Mismatches

```markdown
## API Sync Report — {module}

### New Endpoints (not in frontend)
| Method | Path | Action Needed |

### Type Mismatches
| Field | Backend | Frontend | Action |

### Mock Data Gaps
| Endpoint | Status |
```

### 5. Apply Changes (after user approves)
1. Update TypeScript interfaces to match backend DTOs/entities
2. Add/update API service methods for new/changed endpoints
3. Update mock service to match real service signatures
4. Wire new endpoints to components if applicable
5. Remove types/fields that no longer exist in backend

### Rules
- Follow all rules from CLAUDE.md (no backend modifications, RequestService, mock strategy)
