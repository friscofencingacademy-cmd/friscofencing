---
name: reset-audit-data
description: Clears everything /audit-live-registration creates on staging — trial bookings, registrations, and roster entries for the fixed audit test accounts. Never touches real staging data.
disable-model-invocation: true
---

Resets the staging data `/audit-live-registration` creates, so it can be re-run cleanly. Targets
**only** the 4 fixed audit student accounts seeded by `backend/scripts/audit-seed.js`
(`audit-parent-1`, `audit-sibling-parent`'s 2 children, `audit-decline-parent`) — never anything
else on staging, so it can never touch real manual-QA data. See `docs/plans/audit-system-plan.md`
(D5) for the full design.

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
- **The student document itself.** Found necessary on the first real run, not designed in up
  front: `registration.service.js`'s Stripe idempotency key is `initial-registration-
  ${studentId}-${scheduleId}` — correct and deliberate for real users (an anti-double-charge
  safeguard, ADR 001), but Stripe caches that key for 24h independent of our own MongoDB, so
  clearing the `Registration` doc alone doesn't free it — a second attempt with the same pair
  collides with "Keys for idempotent requests can only be used with the same parameters they
  were first used with." Deleting the student and letting `audit-seed.js` recreate it (fresh
  `_id`) is what actually makes the audit re-runnable. **Run `npm run audit:seed` again after
  this, before the next audit run** — the accounts won't exist until you do.

Per fixed audit parent (`audit-parent-1`, `audit-sibling-parent`, `audit-decline-parent`):
- Their `PaymentMethod` document, and the corresponding Stripe `PaymentMethod` detached. Found
  necessary on the first real run: S4's decline scenario needs a guaranteed-unsaved card every
  time, and S2/S3 re-saving a fresh card each run (rather than silently reusing a stale one) is
  itself a cheap, fine thing to re-exercise.

## Notes

- **Never runs automatically** — not invoked by `/audit-live-registration` itself, the same
  separation CKQ's own `/sync-preprod` keeps from its live audits. Run this deliberately, before
  every audit re-run.
- **Idempotent-safe** — if the audit accounts don't exist yet (first run, or already clean), this
  reports "nothing to do" rather than erroring.
- **The parent accounts, coach, classes, schedules, and prices are untouched and stay permanent**
  — only the 4 student documents and the parents' payment methods are cleared (see above, and
  why). Run `npm run audit:seed` immediately after this — it's idempotent, so it's safe to just
  always run seed-then-audit as one habit rather than tracking whether a reset happened first.
