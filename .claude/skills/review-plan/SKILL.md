---
name: review-plan
description: >-
  Review a {TICKET}-PLAN.md and {TICKET}-contracts.md produced by the
  planner-architect skill, before any code is written. Runs mechanical
  validation (phase-meta, DAG, base_branch stacking, file paths, verification
  commands, contract refs) then a judgment pass (requirements coverage, phase
  independence, contract fidelity, reuse/YAGNI, verification adequacy,
  migration safety). Use when the user says "review the plan", "check the
  plan", "critique the plan", "is this plan ready", "review PLAN.md", or after
  planner-architect finishes and before run-plan starts.
---

# Review Plan

Catch plan defects while they cost one edit instead of a rebuilt PR stack. Two
passes: **mechanical** (a script — objective, no judgment) then **judgment**
(six lenses, every finding cited).

Inputs: the ticket ID (infer from `*-PLAN.md` at the workspace root if only one
exists). Read both `{TICKET}-PLAN.md` and `{TICKET}-contracts.md` in full
before the judgment pass.

## Pass 1 — mechanical (run it, don't eyeball it)

```bash
uv run --with pyyaml --quiet python .claude/skills/review-plan/check-plan.py <TICKET>-PLAN.md .
```

Covers: phase-meta YAML parses and has the required fields; phase numbers
unique and contiguous; `depends_on` resolves, no forward refs or cycles;
`base_branch` stacks only on a **same-repo** dependency (a `phase-N` base
pointing at another repo's branch is the classic one); every `files` path
exists in that repo or its directory does; `verification` names a real
npm script; every `contracts` ref resolves to a real section heading and
matches the contract→phase table both ways; required plan sections and a
per-phase context summary exist; Samwise 25-substantive-file ceiling.

Report its output as-is. Don't re-derive by hand what it already checked, and
don't start the judgment pass by re-reading files it validated.

## Pass 2 — judgment lenses

Work through all six. **Every finding cites `{TICKET}-PLAN.md:LINE` plus a real
repo path or contract section — verify by reading the repo, not from memory. No
citation, no finding.**

1. **Requirements coverage, both directions.** Every acceptance criterion in
   the Jira ticket section maps to at least one phase step; every phase traces
   back to a criterion. Unmapped criterion = missing work. Unmapped phase =
   scope creep.
2. **Phase independence.** Each phase must leave its repo building and green
   on its own. Hunt for a phase consuming a column, entity, DTO, endpoint, or
   type introduced by a phase it does not `depends_on` — including across
   repos (a `[FRONTEND]` phase calling an endpoint must depend on the phase
   that adds it). Also flag steps that reference another phase's unlanded work.
3. **Contract fidelity.** Spot-check the phases that implement contracts:
   do the step descriptions match the declared shapes? Do the frontend types
   match the backend DTO field-for-field (names, casing, optionality,
   nullability)? Does every new endpoint declare auth plus its
   `PermissionsGuard` permission (and `FeatureGuard` flag if gated), error
   responses with literal messages, and pagination if it returns a list?
4. **Reuse and YAGNI.** Grep the repo for an existing service, helper,
   component, or pipe that already does what a step describes — cite it and
   say which step should call it instead. Flag new abstractions with one
   implementation, new dependencies for what a few lines do, config for a
   value that never changes, and phases that exist only for symmetry. This
   lens deletes the most work per finding; spend real effort here.
5. **Verification adequacy.** Would each phase's `verification` actually fail
   if that phase's logic were wrong? `npm run lint` alone on a logic or
   migration phase is a finding — name the spec file or command it needs.
6. **Migration and rollback safety.** DDL ordered add-nullable → backfill →
   constrain; destructive drops in a later phase than the code that stops
   using the column; the right tool for the repo (Alembic for
   rohan_python_api, TypeORM for rohan_api); FK `ON DELETE` behavior stated
   deliberately per column.

Then check **Open questions**: any question whose answer would change phase
structure or a contract is a BLOCKER on starting — name the phases it gates.
Questions that already carry a proposed default are fine; don't re-litigate them.

## Output

```
Verdict: READY | READY WITH NITS | REVISE
<one sentence on the plan's overall shape>

BLOCKER  PLAN.md:412  Phase 6 base_branch phase-4 is a rohan_api branch (phase 6 is rohan_ui)
MAJOR    PLAN.md:120  AC "user can delete a source" maps to no phase step
MAJOR    contracts.md 3.2  ApSourceDto.lastFetchedAt optional in FE type, non-null in the entity
MINOR    PLAN.md:88   plan says "connection", contracts say "source" for the same thing

Start with: phase 1 (clean), phase 3 blocked on open question 2.
```

Severity:

- **BLOCKER** — run-plan/implement-phase will fail, or the phase is wrong or
  unimplementable as written.
- **MAJOR** — rework likely: missing requirement, contract mismatch, unowned
  contract section, unsafe migration, reinvented helper.
- **MINOR** — nits, terminology drift, cosmetics.

`REVISE` if there is any blocker or major. Findings ordered by severity; no
essay per finding — one line each, the fix implied by the citation.

## Fix mode

If the user says `--fix` (or "fix them"), edit **only** `*-PLAN.md` and
`*-contracts.md` — never application code — then re-run pass 1 and report the
new counts. Leave anything needing a product decision as a finding.

## Don't flag

- Files a phase creates (they're supposed to be missing).
- Phase size when the plan already carries the intentional Samwise escalation note.
- Missing docs, changelogs, or README updates.
- An architecture the user already chose — at most one `Consider:` line, then drop it.
- Anything you didn't verify against the repo.
