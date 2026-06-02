---
name: search-first
description: |
  Research-before-coding discipline to avoid reinventing existing patterns.
  Triggers on "search first", "check existing", "before implementing", "find similar".
---

# Search First

Before writing any code, answer these questions:

## 1. Does This Already Exist?

Search for existing implementations before building new ones:
```text
Grep: function/class name variations (getProposal, fetchProposal, loadProposal)
Glob: similar file patterns (*.service.ts, *.repository.ts)
```

Common duplications to avoid:
- Utility functions that already exist in shared modules
- API endpoints that overlap with existing ones
- Components that are slight variations of existing components
- Error handling patterns that the project already standardizes

## 2. What Pattern Does This Codebase Use?

Read 2-3 existing implementations of the same type before writing yours:

| Building | Search for |
|----------|-----------|
| NestJS controller | `*.controller.ts` in the same module area |
| NestJS service | `*.service.ts` — check DI patterns, error handling |
| Angular component | Similar components in the same feature module |
| Angular service | `*.service.ts` in `@shared-services/` and feature modules |
| FastAPI router | `app/routers/*.py` — check dependency patterns |
| Alembic migration | Recent files in `alembic/versions/` |
| Unit test | `*.spec.ts` or `test_*.py` in the same directory |

## 3. Pre-Implementation Checklist

Before writing the first line:
- [ ] Searched for existing implementations of similar functionality
- [ ] Read the module's existing code to understand local patterns
- [ ] Checked shared utilities (`@shared-services/`, `app/services/`, `src/utils/`)
- [ ] Identified the closest existing pattern to follow
- [ ] Confirmed no naming conflicts with existing exports

## 4. Cross-Repo Awareness

Changes often span multiple repos. Before implementing:
- If adding an API endpoint: check if the frontend already expects this shape
- If changing a DTO: search for the type name in both rohan_api and rohan_ui
- If modifying a Python service: check if rohan_api's `rfp-python-server` client needs updates

## Why This Matters

The most common source of bugs and tech debt in multi-dev projects:
- Duplicate implementations that diverge over time
- Inconsistent patterns across modules written by different people
- Breaking changes because nobody checked who depends on the code
- Wasted effort rebuilding what already exists in a shared module
