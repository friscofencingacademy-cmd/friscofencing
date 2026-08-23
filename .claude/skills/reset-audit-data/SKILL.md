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

## What it clears, per fixed audit student

- Their `TrialClass` document (a stale one blocks S1 via its unique-per-student index)
- Their `Registration` and `Subscription` documents
- Their entry in every `GroupClassSchedule.students` and `GroupClassSession.students` roster
  array they were added to

## Notes

- **Never runs automatically** — not invoked by `/audit-live-registration` itself, the same
  separation CKQ's own `/sync-preprod` keeps from its live audits. Run this deliberately, before
  every audit re-run.
- **Idempotent-safe** — if the audit accounts don't exist yet (first run, or already clean), this
  reports "nothing to do" rather than erroring.
- **Doesn't touch the seeded accounts/classes themselves** — only what a *run* creates. The
  audit-only Levels/Locations/GroupClasses/Schedules/Prices from `audit-seed.js` are meant to be
  permanent fixtures; re-run `npm run audit:seed` (idempotent) if you ever need to recreate them.
