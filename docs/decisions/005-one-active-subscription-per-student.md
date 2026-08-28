# ADR 005: One active group-class subscription per student

**Status:** Proposed — 2026-08-28 (owner-decided in conversation; implementation lands with the sibling-discount hardening plan)

## Context

Guard A today (`subscription.model.js`) is a partial unique index on `{studentId, scheduleId}` scoped to `status: 'active'` — it blocks double-registering the *same* schedule, but a student can legitimately hold two active subscriptions at two different schedules/levels. That loophole is what made the sibling-discount calculation ambiguous (`Subscription.findOne` picking an arbitrary one of a sibling's subscriptions — finding F1 of the 2026-08-28 sibling-discount analysis).

## Decision

**A student may hold at most ONE active group-class subscription, enforced at the DB level.** Owner's words: "Each student can only have 1 group class subscription — they should not have more than one. We should block that."

1. Guard A's unique partial index changes from `{studentId, scheduleId}` to `{studentId}` (still scoped to `status: 'active'`). Cancelled docs stay excluded — re-registration after a past cancellation still works.
2. The application-level pre-check in `registration.service.js`'s `create()` broadens from same-schedule to any-active-subscription, returning a clear 409 in front of the DB backstop.
3. Migration pre-flight: index creation fails if any student already has 2+ active subscriptions, so a read-only diagnostic (same pattern as `find-orphaned-references.js`) must run against staging and production data before the index swap.

Scope: group-class subscriptions only. Private-class enrollments (per-session billing) are a different ledger shape and are unaffected.

## Consequences

- The sibling-discount calculation becomes unambiguous: one student ⇒ one active subscription ⇒ one fee. "Per student" and "per subscription" stop being different questions (kills findings F1/F2 structurally — see ADR 006).
- **Accepted trade-off:** a subscription pending cancellation (`cancelAtPeriodEnd: true`) is still `status: 'active'` until its period ends, so a parent who cancels a child's Beginner subscription cannot register that child for Intermediate until the current period actually ends. Allowing an overlap would require two active docs, which the index itself forbids. Mid-period level moves can become an admin flow later if ever needed.

## Alternatives considered

- **Application-level check only (no index change)** — rejected; the same TOCTOU race Guard A was created to close (registration-ledger plan D2) would apply.
- **Allow overlap when the existing subscription is pending-cancel** — rejected; incompatible with a DB-level unique index, which is the whole point of the guard.
