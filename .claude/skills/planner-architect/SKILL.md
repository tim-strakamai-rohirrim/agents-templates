---
name: planner-architect
description: >-
  Create or update a PLAN.md and contracts.md for a ticket. Produces phased
  implementation plans with structured metadata for coding agents, API contracts,
  DTOs, DB schema, and frontend types. Use when the user says "plan", "architect",
  "create a plan", "update the plan", or starts a new ticket.
---

# Planner / Architect

Produce (or update) two documents for a ticket:

| File | Purpose |
|------|---------|
| `<TICKET>-PLAN.md` | Phased implementation plan with steps, files, dependencies |
| `<TICKET>-contracts.md` | API contracts, DTOs, DB schema, frontend types |

Both files live at the workspace root. `<TICKET>` is the Jira ticket ID the user provides (e.g. `PRCR-1260-v2`, `ROH-42`).

## Step 1 — Gather context

1. Ask the user for the **ticket ID** and a description of the change.
2. Read relevant source files to understand the current state — entities, services, controllers, components, types.
3. Ask clarifying questions. Do not guess requirements — add unknowns to "Open questions".

## Step 2 — Write the plan

Create or update `<TICKET>-PLAN.md` with this structure:

### Required sections

1. **Problem statement** — what and why.
2. **Key architectural observations** — how the system works today in the areas being changed.
3. **Assumptions** — things you're treating as true.
4. **Open questions** — anything uncertain, with a proposed default answer.
5. **Implementation phases** — see Phase format below.
6. **Phase order and parallelism** — file-touch matrix, parallelism options, recommended sequential order with rationale.
7. **Phase context summaries** — one compact paragraph per phase (under 150 words) summarizing what it produces, what it depends on from prior phases, and any gotchas. Coding agents read these instead of the full plan.
8. **Jira ticket** — single ticket covering the entire change: title, description, and acceptance criteria (one checklist item per phase).

### Phase format

Each phase starts with a YAML metadata block, followed by a goal and step checklist:

~~~markdown
### Phase N — Short title [TAG]

```phase-meta
phase: 1
title: Store converted HTML key
tags: [BACKEND_DB]
repo: rohan_api
base_branch: base
depends_on: []
files:
  - src/compliance/entities/compliance-document.entity.ts
  - src/compliance/listeners/compliance.listener.ts
contracts:
  - "4.1 converted_html_key column"
  - "7.2 AutoTagCompleteEvent"
verification:
  - npm run lint
  - npm run test -- src/compliance/compliance.listener.spec.ts
```

**Goal**: One sentence.

**Steps**:

- [ ] **1.1** Description of step.
  - Detail or rationale.
  - File: `path/to/file.ts`
- [ ] **1.2** Next step...
~~~

#### Tag values

| Tag | Meaning |
|-----|---------|
| `[BACKEND_DB]` | NestJS API or database changes |
| `[FRONTEND]` | Angular UI changes |
| `[PYTHON]` | Python API / ONERING changes |
| `[TEST_REVIEW]` | E2E tests, integration tests, or review-only |

#### Phase metadata fields

| Field | Description |
|-------|-------------|
| `phase` | Integer phase number |
| `title` | Short descriptive title |
| `tags` | Array of owner tags |
| `repo` | Which repo: `rohan_api`, `rohan_ui`, `rohan_python_api`, `onering` |
| `base_branch` | `base` for Phase 1, or `phase-N` for stacked branches |
| `depends_on` | Array of phase numbers that must be complete first |
| `files` | All files this phase touches (relative to repo root) |
| `contracts` | Sections in the contracts doc this phase implements |
| `verification` | Shell commands to run after implementation (lint, specific tests) |

### Style rules for the plan

- Prefer conservative, incremental changes.
- Each phase must be independently implementable and reviewable.
- No phase should require partial work from another incomplete phase.
- Use consistent terminology across plan and contracts.
- Reference exact file paths relative to the repo root.

### PR size budget (Samwise ceiling)

Each phase becomes one PR, and Samwise **escalates** any PR over **800
substantive lines** or **25 substantive files** (`> ceiling → needs human
review`). "Substantive" excludes docs, tests, snapshots, images, and
`*.lock` files — those don't count toward the size math. Aim each phase
**under** that ceiling so PRs stay auto-reviewable.

Practically:

- Estimate each phase's substantive line/file footprint from its `files` list
  and step detail. If it's near or over the ceiling, look for a clean seam to
  split on (e.g. entity+migration in one phase, service+controller in the
  next; or one component per phase).
- Prefer splits that follow a natural boundary — a layer, a feature slice, a
  single component — so each PR still reads as a complete, self-contained unit.

**Completeness and clarity win over the number.** Do not carve a coherent
change into confusing fragments, split a file mid-logic, or ship a PR that
can't stand on its own just to get under 800/25. If the smallest reviewable
unit genuinely exceeds the ceiling, keep it whole and add a one-line
`> Note: exceeds Samwise size ceiling (~N lines / M files); no clean split
without splitting <thing> mid-change — expect ESCALATE.` under the phase
goal, so the human reviewer knows the escalation is intentional, not an
oversight.

## Step 3 — Write the contracts

Create or update `<TICKET>-contracts.md` with this structure:

### Required sections

1. **Contract → Phase mapping table** at the top:

   ```markdown
   | Contract Section | Phase(s) | Notes |
   |------------------|----------|-------|
   | 1.1 GET content endpoint | 2 | Service + controller |
   | 4.1 converted_html_key column | 1 | DB + entity |
   ```

2. **New endpoints** — method, path, auth, params, request/response shapes with exact JSON examples, field descriptions.
3. **Modified endpoints** — what changed and the new shape.
4. **New/modified DTOs (backend)** — exact TypeScript classes with decorators.
5. **Database schema changes** — SQL DDL and TypeORM entity additions.
6. **Frontend types** — exact TypeScript interfaces.
7. **Error responses** — status codes, conditions, messages per endpoint.
8. **Event payloads (internal)** — if cross-service events are involved.

### Style rules for contracts

- Use exact TypeScript and SQL — not pseudocode.
- Include `@ApiProperty()` and validation decorators on DTOs.
- Include `@Column()` decorators on entities.
- Error messages must be literal strings (agents will match against them).
- If a type already exists and is unchanged, include it "for reference" with a note.

## Step 4 — Branching convention

Document this in the plan for reference. Phases produce stacked branches:

```
{user}/{ticket}/phase-{N}
```

- Phase 1 branches off the starting branch (e.g. `feature/`, `develop`, `main`).
- Each subsequent phase branches off the previous phase's branch.
- The plan does not create branches — it only references them in `base_branch`.

## Step 5 — Review with user

Present the plan and contracts. Wait for confirmation before finalizing. Iterate based on feedback.

## Important constraints

- Do **not** modify application code in this role — only edit `*-PLAN.md` and `*-contracts.md`.
- Do not fabricate requirements. If unsure, add to "Open questions".
- Keep phases small enough for a single PR each — aim under the Samwise
  ceiling (800 substantive lines / 25 substantive files; see PR size budget),
  but never at the cost of a phase that reads as incomplete or confusing.
- Every file path in the plan must be a real path in the repo (verify by reading).

## Tech stack reference

| Layer | Stack |
|-------|-------|
| Frontend | Angular 20+ (signals, zoneless, resource()), SCSS, Karma/Jasmine, Playwright E2E |
| Backend | NestJS, TypeScript, TypeORM, Jest |
| Python | FastAPI, SQLAlchemy, Alembic |
| Database | PostgreSQL + pgvector |
| Storage | MinIO (S3-compatible) |
| Auth | JWT via Auth0/Okta |
| Messaging | Azure Service Bus |
