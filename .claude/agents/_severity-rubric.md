---
name: severity-rubric
description: Shared severity rubric for the 3-sided PR review subagents. Referenced by pr-intent-reviewer, pr-disagreeable-reviewer, and pr-security-reviewer so the aggregator can deduplicate and rank findings consistently.
---

# Severity Rubric (shared)

All three reviewers MUST use these definitions. Mismatched severities break aggregation and produce contradictory verdicts.

## blocker

Merging as-is causes one of:

- Data loss, data corruption, or auth bypass in production.
- Security vulnerability with a known exploit path (OWASP class with a concrete trigger present in the diff).
- The change cannot run (compile error, runtime crash on the documented happy path).
- The change deletes or breaks a public contract that other code in the repo depends on, with no migration.

**Anchored example:** A new rohan_api controller route without the `PermissionsGuard` decorator chain — any authenticated user from any org can hit it, an auth bypass in a multi-tenant system.

## major

Must fix before merge for a healthy production system, but does not by itself break the build:

- Race condition, missing await/lock, ordering hazard with a realistic trigger.
- Silent failure: empty catch, swallowed error, ignored return that hides a real failure mode.
- Missing retry/timeout/backoff on an external call where transient failures are expected.
- Missing input validation at a trust boundary (HTTP request, message queue payload, CLI arg used in shell).
- Public API/contract change without a corresponding test or consumer update.
- Requirement stated in the ticket/plan/contracts but absent from the diff and the checkout (verified missing-implementation), or response/DTO shape drifting from the documented contract.
- Idempotency violation in a retryable handler (Service Bus, webhook).

**Anchored example:** An Azure Service Bus ARC-run handler that inserts a run row without an idempotency check — a redelivered message creates a duplicate run. Or: a rohan_api → rohan-python-api HTTP call with no timeout, hanging the request thread when the Python service stalls.

## minor

Should fix but does not block merge:

- Naming or comment that lies (function name does not match behavior).
- Dead code, unreachable branch, dead config flag.
- Style/format deviation from existing convention.
- Test asserts truthy where a concrete value is available.
- Markdown lint violation (MD058 etc.) when other content is otherwise correct.

**Anchored example:** A service method named `getOrCreateUser` that only gets and never creates — the name lies, callers will mis-rely on it, but nothing is broken today. Or: an Angular component left subscribed to a completed-on-destroy stream — dead pattern, no observable leak in practice.

## nit

Personal taste, cosmetic, or pedantic:

- Alphabetical ordering of imports/keys.
- Trailing whitespace.
- One-line wording polish that does not change meaning.

**Anchored example:** Import ordering in a NestJS module file, or `readonly` on a field Prettier/ESLint doesn't flag — same behavior either way.

## Aggregator binding

The main agent (`commands/review-pr-3-sided.md`) MUST apply these rules. Verdict math counts verified in-diff findings plus verified intent-lane missing-implementation findings:

- `blockers > 0` → verdict `request changes`.
- `blockers == 0` and `majors > 0` → verdict `request changes` or `needs discussion`.
- `blockers == 0` and `majors == 0` → verdict `approve` (or `needs discussion` only with an explicit reason).
- A verified out-of-diff `security` finding of major+ severity whose exposure point is in this diff escalates `approve` → `needs discussion` (never `request changes` — the defect predates the diff).
- A blocker/major with `confidence: low` that did not survive the verification stage is demoted to an open question and excluded from verdict math.
- Self-review case (author == reviewer): downgrade event to `--comment` regardless of verdict, and annotate the body.
