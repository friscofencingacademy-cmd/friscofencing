# ADR 010: `Visit` is the universal attendance ledger

**Status:** Implemented — 2026-09-24 (PR 1 of `docs/plans/private-class-per-session-booking-plan.md`).

## Context

`Visit` was introduced by `docs/plans/premium-registration-and-attendance-plan.md` as the group-class attendance ledger, replacing `GroupClassSession.students[].isPresent`. That plan's decision 3 scoped it to group classes and trials only, and left private lessons on their own `PrivateClassSession.attendance` field. That was a PR boundary, not a design position.

Private lessons are being rebuilt as per-session bookings (`docs/plans/private-class-per-session-booking-plan.md`). Keeping attendance on the private session would leave the academy with two attendance records of different shapes, and every future consumer (reports, evaluations, coach timesheets) would have to read both.

CKQ's own `Visit` is already universal: it carries a `serviceId` and one session sub-reference per service (`groupClass.sessionId`, `privateClass.sessionId`), and its private-class session has no attendance field at all. It reads attendance from the Visit. Verified against `chesskqwebsite/backend/backend-2.0/src/models/visit.model.js` and `services/privateClassSession.service.js`.

## Decision

**`Visit` records every visit to the academy, for every service. It is the only place attendance lives.**

1. Every Visit carries `serviceId`, the same business dimension every `Registration` row carries ([ADR 004](./004-service-registry-and-unified-ledger.md)). `visit.service.js` resolves it from the Service `code` on every insert. Callers never pass one.
2. One session reference per service, as flat fields: the existing `groupClassSessionId` + `groupClassScheduleId`, and a new `privateClassSessionId`. No existing field was renamed, so no group consumer changed. A schema hook enforces exactly one session reference and a `classType` consistent with it (`private` only on, and always on, a private visit).
3. `visit.service.js` remains the only writer. Its group functions kept their signatures. Private-lesson functions use the same idioms: idempotent scheduled upsert, reactivate-on-rebook, attendance upsert, cancel.
4. Money never lives on a Visit. Attendance never moves money for any service (for private lessons this is ADR 011's pay-at-purchase model).

## Consequences

- One query answers "everything this student attended," across services (`{ studentId, serviceId }` index).
- Existing rows needed a one-time `serviceId` backfill (`scripts/backfill-visit-service.js`, dry-run by default, run before deploy). No field rename, no data reshaping.
- Every group read filters on `groupClassSessionId`, so a private visit can never appear in a group roster. This is covered by a test.
- A Visit write now fails closed (500) if the Service registry is not seeded, the same contract as every ledger write.
- `premium-registration-and-attendance-plan.md` decision 3 is superseded.

## Alternatives considered

- **Attendance as a field on each service's session.** Cheapest now, but two attendance shapes forever, and the owner's stated principle is that a visit is universal.
- **A polymorphic `sessionId` + `sessionModel` (`refPath`).** Cleaner-looking, but renames the group fields, which forces a data migration and edits in every group consumer, for no behavior gain.
