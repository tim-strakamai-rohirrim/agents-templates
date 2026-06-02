---
name: coding-standards
description: |
  Universal coding standards for the team across TypeScript and Python.
  Triggers on "coding standard", "convention", "style guide", "best practice", "naming".
allowed-tools:
  - Read
  - Glob
  - Grep
---

# Coding Standards

## Immutability
- Default to `const` in TypeScript; use `let` only when reassignment is required
- Use `readonly` on class properties that are set once
- Prefer `ReadonlyArray<T>` or `readonly T[]` for arrays that should not be mutated
- In Python, prefer tuples over lists for fixed collections; use `@dataclass(frozen=True)` where appropriate

## TypeScript Types
- Use `Number()` for strict full-string numeric conversion (returns `NaN` for non-numeric tails like `Number('123abc')` → `NaN`). Use `parseInt(str, 10)` only when you intentionally want prefix integer parsing (`parseInt('123abc', 10)` → `123`). Always specify radix 10 with `parseInt`
- Never use `any` — use `unknown` if the type is truly unknown, then narrow
- Use discriminated unions over type assertions
- Prefer interfaces for object shapes, type aliases for unions/intersections

## Naming Conventions
| Element | Convention | Example |
|---------|-----------|---------|
| Types, Classes, Components | PascalCase | `ProposalService`, `RunStatus` |
| Functions, Variables | camelCase | `getProposal`, `isActive` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| Files | kebab-case | `proposal-service.ts`, `run-status.enum.ts` |
| Python modules | snake_case | `proposal_service.py`, `run_models.py` |
| Database tables | snake_case, plural | `proposals`, `compliance_matrices` |
| Database columns | snake_case | `created_at`, `organization_id` |

## File Organization
- One primary export per file (one class, one component, one service)
- Co-locate unit tests: `feature.service.ts` next to `feature.service.spec.ts`
- Group by feature, not by type (controllers/ models/ vs proposal/ run/)

## Error Handling
- Never swallow errors silently — at minimum, log with context
- Use typed exceptions: `NotFoundException`, `ConflictException` (NestJS); `HTTPException` with specific status codes (FastAPI)
- Include contextual information: what entity, what operation, what ID
- In Python, prefer specific exception types over bare `except Exception`

## Comments
- No narrating comments ("// Get the user", "// Return the result")
- Explain WHY, not WHAT — the code shows what, comments show intent
- Document non-obvious tradeoffs, workarounds, and business rules
- Use JSDoc/docstrings for public API methods

## Git Practices
- Imperative mood in commit messages: "Add feature" not "Added feature"
- Reference ticket numbers: `PRCR-1234: Add proposal export endpoint`
- Small, focused PRs — one logical change per PR
- Keep commits atomic: each commit should build and pass tests

## Code Review Standards
- Every PR needs at least one review
- Reviewer checks: correctness, test coverage, naming, error handling, security
- Author responds to all comments before merging
