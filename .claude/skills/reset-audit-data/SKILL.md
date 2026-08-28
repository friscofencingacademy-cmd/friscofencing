---
name: reset-audit-data
description: Clears everything /audit-live-registration creates on staging — trial bookings, registrations, and roster entries for the fixed audit test accounts. Never touches real staging data.
disable-model-invocation: true
---

Resets the staging data `/audit-live-registration` creates, so it can be re-run cleanly. Targets
**only** the 7 fixed audit student accounts seeded by `backend/scripts/audit-seed.js`
(`audit-parent-1`'s child, `audit-sibling-parent`'s 2 children, `audit-decline-parent`'s child,
`audit-bridge-parent`'s 2 children, `audit-retry-parent`'s child) — never anything else on
staging, so it can never touch real manual-QA data. See `docs/plans/audit-system-plan.md` (D5)
for the original design and `docs/plans/audit-skills-refresh-plan.md` (D1) for why the student-
delete step below was removed.

## Run it

```bash
cd backend
npm run audit:reset
```

Requires `AUDIT_MONGO_URI` set in `backend/.env`, pointed at the **staging** cluster —
`backend/scripts/audit-reset.js` hard-fails otherwise (the URI must contain
`friscofencing-staging`).

## What it clears

Per fixed audit student:
- Their `TrialClass` document (a stale one blocks S1 via its unique-per-student index)
- Their `Registration` and `Subscription` documents
- Their entry in every `GroupClassSchedule.students` and `GroupClassSession.students` roster
  array they were added to
- Their `Visit` documents

**The student documents themselves are NOT deleted.** They used to be — found necessary on the
first real run, or so it seemed at the time: the old reasoning was that `registration.service.js`'s
Stripe idempotency key was `initial-registration-${studentId}-${scheduleId}`, cached by Stripe for
24h independent of our own MongoDB, so reusing the same studentId+scheduleId pair after a reset
would collide even after a full DB reset. That key format no longer exists — PR 2
(`docs/decisions/008-registration-create-pending-first.md`) replaced it with `payment_${row._id}`,
generated fresh from a brand-new `SubscriptionCycleRegistration` row created every time `create()`
runs. Since this script already deletes the `Registration`/`Subscription` docs above, the next
registration attempt creates a fresh ledger row with a fresh `_id` — there is no possible collision
with an old Stripe key tied to a deleted document. **The student accounts now persist across
resets — `npm run audit:seed` does not need to run again after a reset.**

Per fixed audit parent (`audit-parent-1`, `audit-sibling-parent`, `audit-decline-parent`,
`audit-bridge-parent`, `audit-retry-parent`):
- Their `PaymentMethod` document, and the corresponding Stripe `PaymentMethod` detached. Found
  necessary on the first real run: S4/S6's decline scenarios need a guaranteed-unsaved card every
  time, and the other scenarios re-saving a fresh card each run (rather than silently reusing a
  stale one) is itself a cheap, fine thing to re-exercise.

## Notes

- **Never runs automatically** — not invoked by `/audit-live-registration` itself, the same
  separation CKQ's own `/sync-preprod` keeps from its live audits. Run this deliberately, before
  every audit re-run.
- **Idempotent-safe** — if the audit accounts don't exist yet (first run, or already clean), this
  reports "nothing to do" rather than erroring.
- **The parent accounts, students, coach, classes, schedules, and prices are untouched and stay
  permanent** — only each student's activity (trial, registration, subscription, roster entries,
  visits) and the parents' payment methods are cleared (see above, and why). Running
  `npm run audit:seed` afterward is optional (idempotent, safe either way) but no longer required
  for the accounts to exist.
