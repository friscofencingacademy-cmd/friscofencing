# Private Classes — Per-Session Booking Plan

**Status:** ALL 3 PRs MERGED TO `develop` 2026-09-24 (owner-authorized autonomous build): PR 1 #96,
PR 2 #97, PR 3 #98. Backend 76 suites / 944 tests, frontend 57 / 448, E2E 31 passed, `tsc --noEmit`
clean, `next build` succeeds, CI green on every PR. **Staging rolled out 2026-09-24** (owner-approved):
backfill stamped 2,137 Visits; cutover freed 4 slots, deleted 2 test enrollments + 16 unmarked
generated sessions (0 charges — the money gate passed), replaced the slot index; ledger check clean;
both dry runs re-run afterward find nothing left. **Production: not yet run** — same §4 steps before
promoting `develop` to `main`. **§5 records every place the build diverged from this spec — read it
before relying on an endpoint or field name below.**
**Goal:** Replace the CKQ-style *recurring* private enrollment (a parent claims one weekly slot,
eight weeks of sessions are generated, each session is charged after attendance) with Frisco's
*per-session* model: a coach publishes bookable slots in bulk over a date range; a parent buys one
session or a discounted pack, and books one specific date at a time; money moves at purchase, never
at attendance; attendance becomes a `Visit`, the same universal attendance ledger group classes use.

Owner-settled decisions this plan implements (discussion 2026-09-24):

1. The collections stay. `PrivateClassSchedule`, `PrivateClassEnrollment`, `PrivateClassSession`
   keep their names; two of them change *meaning* (§0).
2. `Registration` remains the single money ledger. Nothing else ever stores a dollar amount.
3. `Visit` becomes the universal attendance truth for every visit to the academy, group or private
   (CKQ's own shape — verified, §0 D6). A private session carries **no** attendance fields.
4. One `PrivateClassEnrollment` per purchase — "10 sessions" is one document with counters.
5. A `PrivateClassSession` is created at payment, names the student, and is the atomic slot claim.
6. Group classes are untouched. The group session generator, picker, cutoff, and attendance gate
   from PRs #93/#94 are not in scope.

**CKQ reference (read-only, for orientation — verified against, not copied):**
- `C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\models\visit.model.js` — universal
  Visit: `serviceId` + `groupClass.sessionId` + `privateClass.sessionId`.
- `...\src\models\privateClassSession.model.js` — `student`/`parent`/`coach`/`enrollment` all
  required on the session; no attendance field (read from the Visit).
- `...\src\services\privateClassSession.service.js` — `findOrCreateSession` (lazy creation +
  scheduled Visit pre-creation), `updateAttendance` (Visit upsert).

**Builder pre-reads (mandatory, per CLAUDE.md):** `docs/features/private-class.md` (what is being
replaced), `docs/decisions/001-in-house-subscription-billing.md` + `004-service-registry-and-
unified-ledger.md` + `008-registration-create-pending-first.md` (billing discipline this plan
reuses verbatim), `docs/decisions/009-utc-date-storage-standard.md` (every date in this plan is one
of its two shapes), `docs/TESTING_STRATEGY.md` (every test; its E2E section — this plan touches the
coach nav label and adds a new spec), `docs/features/admin.md` (Pattern A, Private Classes page),
`docs/features/parent-portal.md` (flow kit, `ParentPortalContext` contract), `docs/modules/email.md`
(template registry + CC table + PDF attachment contract), `docs/design-system.md` (new wizard
steps, coach tabs), `DATABASE_SCHEMA_DOCUMENTATION.md` (five collections change).

---

## §0 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **`PrivateClassSchedule` is an availability rule, not a claimed slot.** It keeps `coachId`/`dayOfWeek`/`startTime`/`durationMinutes`/`isActive`; **loses** `studentId`/`enrollmentId`; **gains** `startDate`/`endDate` calendar-day sentinels (the coach's "open from X to Y"). | A schedule is no longer owned by one family — different families book different Mondays of the same rule. Without a date range a rule is bookable forever, which contradicts the owner's "startDate to endDate" requirement. |
| D2 | **Bulk publish is the primary create path.** `POST /private-class-schedules/bulk` takes a date range, days of week, a time window, and a slot length, and inserts one schedule per (day, start time). The single-slot `POST` stays for admin fix-ups. | "5–8 pm, 30-minute slots" = 6 rules per weekday, created in one request. No sessions are generated at publish (D3). |
| D3 | **`PrivateClassSession` is the booking.** Created at payment, **`status: pending → confirmed \| cancelled`**, names `studentId`/`parentId`/`enrollmentId`. The existing unique `(scheduleId, startDate)` index becomes **partial** on `status ∈ {pending, confirmed}` and is the atomic slot claim. No attendance fields. | Two parents racing the same date collide on the insert — one write is the whole reservation, so there is no read-then-write window. Partial index so a cancelled booking frees the date without deleting history. Attendance lives in `Visit` (D6/D7), matching CKQ's own session. |
| D4 | **`PrivateClassEnrollment` is one purchase.** Pins `agreedHourlyRate` (unchanged field — D7 of the original plan still holds: immutable, one purchase behind it), **gains** `sessionDurationMinutes`, `quantity`, `discountPercent`, `sessionsUsed`, `status: pending \| active`. `remaining = quantity − sessionsUsed`, always derived, never stored. **Loses** `endDate`, `cancelled` status. | Owner decision: "10 sessions is one document with sessionsPurchased." Created pending-first exactly like `Subscription` (ADR 008). One enrollment ↔ one ledger row ↔ one price is a clean invariant to audit (§2.10). |
| D5 | **`Registration` `per_session` rows gain `quantity`, `unitPrice`, `discountPercent`.** `sessionId` stays **required** (the booking that triggered the purchase); `enrollmentId` stays required. **The unique partial index on `sessionId` is unchanged** and is still the money dedup. | Every purchase in the owner's flow accompanies a booking, so anchoring the row to that session keeps the existing "one non-failed charge per session" guard valid. A double-submitted "buy 10 + book Oct 6" fails on the second session insert before Stripe is ever called. No new billing shape — same `per_session` key, same `Service` row, zero seed change. |
| D6 | **`Visit` becomes universal (CKQ's shape, flat fields).** Gains `serviceId` (required, ref `Service`) and `privateClassSessionId`; `groupClassSessionId`/`groupClassScheduleId` become required *only when* `privateClassSessionId` is null (exactly one of the two session refs, enforced by a schema validator); `classType` gains `'private'`. Existing rows are backfilled with the `group-classes` Service id. | Owner: "visits should be universal truth for any visit to the academy." `docs/plans/premium-registration-and-attendance-plan.md` decision 3 scoped Visit to group only as a PR boundary, not a design position. No existing field is renamed, so group consumers and the migration stay small. |
| D7 | **Private attendance = the Visit, only.** A `scheduled` Visit is created when a booking confirms; the coach's mark updates it to `attended`/`missed`; a cancellation sets it `cancelled`. `PrivateClassSession` drops `attendance`/`markedBy`/`markedAt`. | Two places recording the same fact would be two sources of truth. Same lifecycle as group, same ledger, different trigger — exactly CKQ. |
| D8 | **Order at payment (the airtight sequence):** validate → insert the session `pending` (slot claim) → create enrollment `pending` → create ledger row `pending` → Stripe → on success flip ledger `completed`, enrollment `active` + `sessionsUsed: 1`, session `confirmed`, create the scheduled Visit → emails. **On decline:** ledger `failed`, enrollment and session **deleted** (the slot reopens). | ADR 008's lesson: reserve before charging; never charge a card for a slot you may not deliver. Releasing on decline because an unpaid hold on scarce inventory is how no-shows happen. |
| D9 | **Credit-only booking** (`POST /private-class-sessions`): validate → insert session `pending` → atomic conditional `$inc sessionsUsed` on the **oldest** `active` enrollment for that student + coach + slot duration with `sessionsUsed < quantity` → session `confirmed` + scheduled Visit. If no enrollment qualifies, the pending session is deleted and the parent gets 409 "no sessions remaining". | Both writes are reversible with no external side effect, so reserve-first is kept for consistency with D8. Oldest-first because it is deterministic and what a parent expects. |
| D10 | **Stale `pending` sessions self-heal at the next collision.** When the D8/D9 insert hits a duplicate whose existing doc is `pending`, older than `PENDING_BOOKING_TTL_MINUTES = 15`, and has no `pending`/`completed` ledger row, that doc (and its `pending` enrollment, if any) is deleted and the insert is retried once. | This project has no scheduler (`docs/plans/deployment-launch-plan.md`'s deferred-cron note). A crash between D8's steps must not hold a slot forever. |
| D11 | **Cancellation: no refunds, ever (ADR 001 stands). Cancelling a `confirmed` future booking returns the credit** (`$inc sessionsUsed: -1` on its enrollment), sets the session `cancelled`, the Visit `cancelled`. Parent-own may cancel until `PARENT_CANCEL_CUTOFF_HOURS = 24` before `startDate`; coach-own and admin may cancel until `startDate`. After `startDate` nothing is cancellable — attendance is marked instead. | Credit return is the no-refund-compatible remedy. The cutoff constants live in `privateClassSession.service.js` (one home), not `Setting` — promote to a setting only if the owner asks. |
| D12 | **No-show consumes the credit.** `missed` returns nothing. | Owner default. The consent line in the wizard and the confirmation email both state it. |
| D13 | **(SUPERSEDED 2026-09-24 by `docs/plans/coach-pack-pricing-plan.md` — packs now live on each coach's contract as fixed-price packs per lesson length; `Setting.privateClassPackages` and `discountPercent` were removed.)** Originally: **Pack pricing lives in `Setting.privateClassPackages: [{ quantity, discountPercent }]`** (default `[]`), edited on `/admin/settings`. `quantity: 1` at 0% is always offered and never stored. `utils/privateClassPricing.js` gains `computePackTotal(unitPrice, quantity, discountPercent)` — the **only** place the pack formula lives (Hard Rule 7). | Academy-wide, backend-computed, frontend never does the math. List-shaped so 5/10/20 can be added as data. |
| D14 | **Holidays block private bookings.** Available dates exclude holiday days; the booking path 400s on one as defense in depth. Bulk publish does not care (a rule may span a holiday; the day just never offers). | Closes `docs/plans/holiday-blocking-plan.md` D8's noted gap with the same helper. |
| D15 | **Cutover, not migration.** A dry-run-first script (§2.11) verifies the old shape holds no money (zero `completed`/`pending` `per_session` rows referencing the old sessions), then clears claim fields, deletes old-shape sessions/enrollments, and rebuilds the session index. It **refuses** to apply if money exists. | Memory (2026-08-30) says no real private-class data exists in staging or production. The script verifies that instead of assuming it (`feedback-verify-dont-assume`). |
| D16 | **Route paths stay** (`/private-class-schedules`, `/private-class-enrollments`, `/private-class-sessions`) with additive endpoints. Attendance-driven charging, `retry-charge`, `extend-private-sessions.js`, `scheduleOccurrence.js`'s consumer in this stack, and the `privateClassPaymentFailed` email are **deleted**. | Minimal frontend churn; dead code is removed rather than left. |
| D17 | **Private attendance gate stays `session.startDate <= now`** (a real-instant comparison), not group's day-granular same-day rule. | Private sessions are real instants (ADR 009), so "has it started" is exact — the day rule exists for group only because `GroupClassSession.date` is a sentinel. |
| D18 | **Deferred, explicitly:** credit expiry (`expiresAt`), Stripe refunds, coach notes/tags on a session, reschedule requests, admin voiding a pack, an "all visits" cross-service report UI, a `Setting`-driven cancellation cutoff. | Each is additive on this model. None blocks the owner's three requirements. |

---

## §1 PR 1 — Universal Visit (`feature/universal-visit`) — behavior-neutral for group

Lands first, alone, so the entire existing group suite + `coach-attendance.spec.ts` prove nothing
changed before private classes depend on it.

### 1.1 Model — `backend/src/models/visit.model.js`

```js
serviceId:             { type: ObjectId, ref: 'Service', required: true },
groupClassSessionId:   { type: ObjectId, ref: 'GroupClassSession', default: null },
groupClassScheduleId:  { type: ObjectId, ref: 'GroupClassSchedule', default: null },
privateClassSessionId: { type: ObjectId, ref: 'PrivateClassSession', default: null },
classType:             { enum: ['regular', 'trial', 'private'] },   // VISIT_CLASS_TYPES
```

Schema-level validator (`visitSchema.pre('validate')`): exactly one of `groupClassSessionId` /
`privateClassSessionId` is set; when the group one is set, `groupClassScheduleId` is required;
when the private one is set, `classType` must be `'private'` and `groupClassScheduleId` must be
null. A group Visit with `classType: 'private'` is also rejected. Existing indexes stay; add
`{ privateClassSessionId: 1, status: 1 }` and `{ studentId: 1, serviceId: 1 }` (CKQ's "student
visits by service" index). The header comment is rewritten: this is the academy's attendance
ledger, one row per student per session of any service.

### 1.2 Service — `backend/src/services/visit.service.js`

- Every existing function keeps its **signature** (no consumer call-site edits): each resolves the
  `group-classes` `Service` once per call via `serviceCatalog.service.js`'s `getServiceByCode` and
  writes `serviceId` in its `$setOnInsert`. `assertBillingShape` is not involved (a Visit is not a
  ledger row).
- New private-lesson functions, same idioms: `createScheduledPrivateVisit(studentId, sessionId)`
  (upsert, `classType: 'private'`, reactivates a cancelled one), `findActivePrivateVisit(studentId,
  sessionId)`, `markPrivateAttendance(studentId, sessionId, status, markedBy, markedVia)` (upsert —
  the walk-in-style safety net if a scheduled Visit was never created), `cancelPrivateVisit(sessionId)`.
- `getVisitsByStudent` unchanged — it already returns every shape.

### 1.3 Backfill — `backend/scripts/backfill-visit-service.js` (+ `scripts/lib/backfillVisitService.js`)

Dry-run by default, `--live` to write (the repo's convention, matching
`backfill-session-instants.js`; no npm script, same as that one); sets `serviceId` to the
`group-classes` Service on every Visit that lacks one; aborts with nothing written if a row has
neither a `serviceId` nor a group session ref; idempotent. **Run on staging, then production,
BEFORE deploying PR 1** — `serviceId` is `required`.

### 1.4 Consumers — verified list, no logic change

`groupClassSession.service.js` (direct `Visit.find` at lines 125 and 363 filter by
`groupClassSessionId` — unchanged; `visitService.*` calls at 211/276/305/422/436/437/462/476 —
unchanged signatures), `roster.service.js` (38/58), `trialClass.service.js` (93),
`evaluation.service.js` (48–65). `groupClassSession.model.js` references Visit only in a comment.

### 1.5 Tests (write before committing)

- `tests/services/visit.service.test.js` — extend: every existing write now carries the
  `group-classes` `serviceId`; the validator rejects (a) neither session ref, (b) both, (c) a
  private ref with `classType: 'regular'`, (d) a private ref with a `groupClassScheduleId`; the four
  new private functions (create → find → mark → cancel → re-create reactivates).
- `tests/scripts/lib/backfillVisitService.test.js` — new: dry-run writes nothing, `--apply` sets
  the id, re-run is a no-op, a Visit that already has a `serviceId` is untouched.
- Every suite that seeds a Visit directly with `Visit.create` must add `serviceId` — the grep-
  verified list: `tests/routes/evaluation.routes.test.js`, `groupClassSchedule.routes.test.js`,
  `groupClassSession.routes.test.js`, `registration.routes.test.js`, `trialClass.routes.test.js`,
  `tests/services/renewal.service.test.js`, `roster.service.test.js`, `subscription.service.test.js`.
  Suites that only go through `visitService` need no change (the point of 1.2). Seed the
  `group-classes` Service in those suites the way `registration.routes.test.js` already does.
- Full backend suite green under `TZ=UTC`; frontend and E2E untouched (no API shape changes).

### 1.6 Docs (same PR)

ADR **010 — `Visit` is the universal attendance ledger** (`docs/decisions/010-universal-visit-
ledger.md`, status Implemented on merge; index row in `docs/decisions/README.md`).
`DATABASE_SCHEMA_DOCUMENTATION.md`'s Visit section; `docs/plans/premium-registration-and-
attendance-plan.md` decision 3 gets a one-line "superseded by ADR 010" note.

---

## §2 PR 2 — Backend booking model (`feature/private-booking-backend`)

### 2.1 `backend/src/models/privateClassSchedule.model.js`

Remove `studentId`, `enrollmentId` and the `{ studentId: 1 }` index. Add:

```js
// Calendar-day sentinels (dateShapes.js dateOnlyUTC) — inclusive. The rule
// offers its weekday's occurrences only inside this range.
startDate: { type: Date, required: true },
endDate:   { type: Date, required: true },
```

Indexes: keep `{ coachId: 1, isActive: 1 }`; add `{ coachId: 1, dayOfWeek: 1, startTime: 1 }`.
Header comment rewritten: a schedule is an availability rule; bookings live on
`PrivateClassSession`.

### 2.2 `backend/src/models/privateClassEnrollment.model.js`

```js
PRIVATE_CLASS_ENROLLMENT_STATUSES = ['pending', 'active'];
studentId, parentId, coachId, coachContractId, agreedHourlyRate   // unchanged
sessionDurationMinutes: { type: Number, required: true, min: 15 },
quantity:               { type: Number, required: true, min: 1 },
discountPercent:        { type: Number, required: true, min: 0, max: 100, default: 0 },
sessionsUsed:           { type: Number, required: true, min: 0, default: 0 },
status:                 { enum: PRIVATE_CLASS_ENROLLMENT_STATUSES, default: 'pending' },
```

Remove `endDate`. Schema validator: `sessionsUsed <= quantity`. Index `{ studentId: 1, coachId: 1,
status: 1, createdAt: 1 }` (D9's oldest-first lookup). Header comment: one document per purchase;
`remaining` is derived; the price paid is on the ledger row, never here.

### 2.3 `backend/src/models/privateClassSession.model.js`

```js
PRIVATE_CLASS_SESSION_STATUSES = ['pending', 'confirmed', 'cancelled'];
scheduleId, enrollmentId, coachId, studentId, parentId, startDate, endDate   // unchanged
status:      { enum: ..., required: true, default: 'pending' },
cancelledAt: { type: Date, default: null },
cancelledBy: { type: ObjectId, ref: 'User', default: null },
```

Remove `attendance`, `markedBy`, `markedAt`, `PRIVATE_CLASS_ATTENDANCE_STATUSES`. Replace the
unique index with the partial one:

```js
privateClassSessionSchema.index(
  { scheduleId: 1, startDate: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['pending', 'confirmed'] } } }
);
privateClassSessionSchema.index({ coachId: 1, startDate: 1 });
privateClassSessionSchema.index({ enrollmentId: 1 });
privateClassSessionSchema.index({ studentId: 1, startDate: 1 });
```

Header comment: **in Frisco a private session is a booking** — the insert is the slot claim, which
is why the student is on it; attendance is the Visit.

### 2.4 `backend/src/models/registration.model.js` — `perSessionSchema` only

Add `quantity` (required, min 1), `unitPrice` (required, min 0), `discountPercent` (required, 0–100,
default 0). `sessionId`/`enrollmentId` and the partial unique index unchanged (D5). Comment: a
`per_session` row is a **purchase** of `quantity` sessions at `unitPrice` less `discountPercent`,
anchored to the booking that triggered it; `amount` is what was charged. Add
`{ enrollmentId: 1 }` index.

### 2.5 `backend/src/models/setting.model.js`

`privateClassPackages: [{ quantity: { min: 2 }, discountPercent: { min: 0, max: 100 } }]`, default
`[]`; validator: unique quantities. `setting.service.js`'s `updateSettings` whitelists it.

### 2.6 `backend/src/utils/privateClassPricing.js`

Add `computePackTotal(unitPrice, quantity, discountPercent)` →
`round(unitPrice * quantity * (1 - discountPercent / 100), 2)`; throws on a non-integer/zero
quantity or an out-of-range percent, never guesses. `computeSessionPrice` unchanged.
`resolvePackOptions(settings)` → `[{ quantity: 1, discountPercent: 0 }, ...settings.privateClassPackages]`
sorted by quantity — the single place the "1 is always offered" rule lives.

### 2.7 `backend/src/services/privateClassSchedule.service.js`

- `create({ coachId, dayOfWeek, startTime, durationMinutes, startDate, endDate })` — active
  contract required (unchanged); dates normalized through `dateOnlyUTC`, `endDate >= startDate`
  (400); **overlap rule** replaces the duplicate rule: 409 if a schedule exists for the same
  `coachId + dayOfWeek + startTime` whose range intersects (`startDate <= newEnd && endDate >=
  newStart`).
- `createBulk({ coachId, daysOfWeek[], windowStart, windowEnd, slotDurationMinutes, startDate,
  endDate })` — validates the window (`windowEnd > windowStart`, HH:mm), builds the candidate list
  (each `dayOfWeek` × each start time from `windowStart` while `start + duration <= windowEnd`),
  runs the overlap check against the DB **and** within the batch, and either 409s with every
  conflicting `(dayName, startTime)` or `insertMany`s the whole list. No transaction (a validate-
  then-insert on a single-writer admin action; `mongodb-memory-server` is not a replica set).
- `listMine` / `listAll` — drop the `studentId` populate and the `available` filter; each row
  gains `bookedCount` (confirmed future sessions) for the coach/admin lists.
- `remove(id, user)` — coach-own | admin; 409 if any `confirmed` **future** session references it
  ("Slot has upcoming bookings"); otherwise hard delete. Past sessions keep their `scheduleId`
  (history), which is why the guard is future-only.
- `listAvailableDates(scheduleId, { days = 56 })` — **public, no student data**. Walks Central
  calendar days from `max(todayDateOnly(), startDate)` to `min(endDate, today + days)` via
  `addDaysToDateOnly`/`nextDateOnlyOnOrAfter`; keeps days matching `dayOfWeek` that are not
  holidays (`getHolidaysInRange` once, `findHolidayForDate` per day); builds each instant with
  `combineDayAndTimeInTZ(day, startTime)`; keeps instants strictly after `now`; subtracts existing
  `pending`/`confirmed` sessions (one query on `scheduleId` + `startDate` range). Returns
  `[{ day: 'YYYY-MM-DD', startsAt, endsAt }]`. Also exported as `resolveBookableInstant(schedule,
  day, now)` — the same rule used by every write path (§2.8), so the picker and the guard can never
  disagree.
- `listPublic()` — unchanged shape plus `startDate`/`endDate` per slot and a per-coach
  `packageOffers: [{ quantity, discountPercent }]` from `resolvePackOptions` (no totals — the
  preview computes those for a chosen slot). Drop `firstSessionDate` (no longer meaningful).
  Delete the `nextOccurrenceStrictlyAfter` import.

### 2.8 `backend/src/services/privateClassEnrollment.service.js` — purchase + book

`preview({ scheduleId, quantity }, parent)` → `{ hourlyRate, durationMinutes, unitPrice, quantity,
discountPercent, discountAmount, total, packOptions }`; 400 if `quantity` is not one of
`resolvePackOptions`. Used by the wizard's "How many" step. Never accepted as an amount by anything.

`create({ studentId, scheduleId, day, quantity }, parent)` — D8, in this exact order:

1. Student belongs to parent (403/404 as today); schedule active + coach populated (404); active
   contract (409); `quantity` allowed (400); `resolveBookableInstant` (400 "not bookable" —
   outside range, wrong weekday, holiday, already started); card on file (400) and
   `ensureStripeCustomer` (unchanged).
2. `PrivateClassSession.create({ ..., status: 'pending' })` — E11000 → D10 self-heal attempt →
   still E11000 → 409 "This time slot was just taken — please pick another". Nothing else exists
   yet.
3. `PrivateClassEnrollment.create({ status: 'pending', agreedHourlyRate: contract.
   studentBillingRate, sessionDurationMinutes: schedule.durationMinutes, quantity,
   discountPercent, sessionsUsed: 0 })`; set `session.enrollmentId`.
4. `unitPrice = computeSessionPrice(rate, duration)`, `total = computePackTotal(...)`;
   `getServiceByCode('private-lessons', { requireActive: true })` + `assertBillingShape(...,
   'per_session')` (unchanged from today's `chargeSession`); `PerSessionRegistration.create({
   status: 'pending', sessionId, enrollmentId, quantity, unitPrice, discountPercent, amount: total,
   attempt })` — `attempt = failedCount(sessionId) + 1`, exactly today's rule.
5. Stripe `paymentIntents.create` with `idempotencyKey: \`pcs_${session._id}_${attempt}\`` (today's
   key, unchanged — the anchor is still the session).
6. Success: ledger `completed`/`paidAt`/`stripePaymentIntentId`; enrollment `active` +
   `sessionsUsed: 1`; session `confirmed`; `visitService.createScheduledPrivateVisit`; emails
   (§2.12) with the PDF invoice; return `{ enrollment, session, registration, remaining }`.
7. `StripeCardError` or non-`succeeded` intent: ledger `failed` + `failureMessage`; **delete** the
   pending enrollment and session (the slot reopens); throw `httpError(402, message)` — the same
   402 the group checkout uses for a decline. No email (nothing is left pending for the parent to
   fix; they retry from the wizard).

`listMine(parentId)` → per enrollment: the populated enrollment, `remaining`, its ledger row, and
its sessions (with each session's Visit status merged as `attendance` for display). `listAll`
(admin) unchanged filters + `remaining`. **`cancel` is removed** (D11 cancels sessions, not packs).

### 2.9 `backend/src/services/privateClassSession.service.js` — book with credit, attend, cancel

- `book({ studentId, scheduleId, day }, parent)` — D9. Same step 1 as §2.8 minus card/quantity;
  insert `pending` (D10 self-heal); `PrivateClassEnrollment.findOneAndUpdate({ studentId, coachId,
  sessionDurationMinutes: schedule.durationMinutes, status: 'active', $expr: { $lt: ['$sessionsUsed',
  '$quantity'] } }, { $inc: { sessionsUsed: 1 } }, { sort: { createdAt: 1 }, new: true })`; none →
  delete the pending session, 409 "No sessions remaining with this coach — buy more to book";
  else set `enrollmentId`, `confirmed`, scheduled Visit, booking emails (no receipt — no money).
- `markAttendance(sessionId, status, user)` — coach-own | admin (unchanged guard); session must be
  `confirmed` (409 otherwise); `startDate <= now` (400, D17); `status ∈ {attended, missed}` (400);
  → `visitService.markPrivateAttendance(...)`, `markedVia` = `'coach'`/`'admin'`. Returns `{ session,
  visit }`. **No money.**
- `cancel(sessionId, user)` — D11. Parent-own (cutoff 24h), coach-own, admin (cutoff = start).
  `confirmed` only (409). `$inc sessionsUsed: -1` on the enrollment (guarded `sessionsUsed > 0`),
  session `cancelled`/`cancelledAt`/`cancelledBy`, `cancelPrivateVisit`, cancellation email.
- `listMine(coachId, window)` — `upcoming` = `confirmed` + `startDate > now`; `unmarked` =
  `confirmed` + `startDate <= now` + Visit `scheduled`; `past` = `confirmed` + `startDate <= now`.
  Each row carries the Visit status as `attendance` and no `sessionPrice` (nothing to charge).
- **Deleted:** `generateSessions`, `chargeSession`, `retryCharge`, `SESSION_WEEKS`, the Stripe /
  invoice / `computeSessionPrice` imports.

### 2.10 Ledger reconciliation — `backend/scripts/check-private-credit-ledger.js` (read-only)

For every `active` enrollment: `quantity` must equal the sum of `quantity` over its `completed`
`per_session` rows (exactly one row), `sessionsUsed` must equal its `pending`+`confirmed` session
count. Reports drift, never writes. Lives beside `find-orphaned-references.js`; npm script
`check-private-credit-ledger`. The ledger wins any disagreement (owner decision).

### 2.11 Cutover — `backend/scripts/retire-recurring-private-classes.js` (+ `scripts/lib/`)

Dry-run by default. Counts: schedules with a claim (`studentId`/`enrollmentId` set), enrollments
without `quantity`, sessions without `status`, `per_session` rows without `quantity`, and — the
gate — `pending`/`completed` `per_session` rows whose `sessionId` is an old-shape session.
`--apply` **refuses** if the gate count is non-zero (money exists; stop and talk to the owner).
Otherwise: `$unset` the two claim fields on every schedule and set `startDate`/`endDate` on any
schedule lacking them to `[today, today + 90 days]` (so an existing published slot keeps offering,
flagged in the report); delete old-shape sessions and enrollments and their `failed`-only ledger
rows; drop the old `scheduleId_1_startDate_1` index and let Mongoose `syncIndexes()` build the
partial one. **Run on staging, then production, BEFORE deploying PR 2.**

### 2.12 Emails — `backend/src/email/templates.js`, `mail.service.js`, `docs/modules/email.md`

| Template | Trigger | To / CC | Change |
|---|---|---|---|
| `privateClassBookingConfirmation` | a booking confirms (purchase or credit path) | parent / admin, coach | Rewrite of `privateClassConfirmation`: coach, date + time (`dateFull` on the instant), duration, sessions purchased/remaining, the no-show + 24h-cutoff policy lines. |
| `privateClassCoachBooking` | same | **coach** / admin | **New** — the owner's "the coach gets an email": student, parent name, date + time, remaining count. |
| `privateClassPurchaseReceipt` | a successful purchase | parent / admin | Rewrite of `privateClassSessionReceipt`: `quantity × unitPrice`, discount line, total; carries the PDF invoice exactly as today (`invoiceAttachment`). |
| `privateClassBookingCancelled` | a cancellation | parent / admin, coach | Rewrite of `privateClassCancellation`: which date, credit returned, remaining. |
| `privateClassPaymentFailed` | — | — | **Deleted** (D16). |

`email.md`'s template registry + CC table rows updated; `sampleData.js` entries updated so the
preview script still renders every template.

### 2.13 Invoice — `backend/src/services/invoice.service.js` `buildPerSessionData`

Line items become `[{ label: 'Private lesson with <coach> — <duration> min × <quantity>', amount:
unitPrice × quantity }, { label: 'Pack discount (<pct>%)', amount: -discountAmount }]` when a
discount applies; `periodLabel` = the purchase date (`row.createdAt` via `dateFull`), not a session
date (a pack spans many). `total` is still `row.amount`, never re-derived. `serviceLabel`:
`'Private Lesson Purchase'`. `registration.service.js`'s history description (line 644) becomes
`Private Lessons ×<quantity> with <coach>`.

### 2.14 Routes / controllers

| Endpoint | Guard | Notes |
|---|---|---|
| `POST /private-class-schedules/bulk` | coach (self) \| admin (body `coachId`) | new, §2.7 |
| `POST /private-class-schedules` | same | + `startDate`/`endDate` |
| `GET /private-class-schedules/mine` · `GET /private-class-schedules` | unchanged | + `bookedCount` |
| `DELETE /private-class-schedules/:id` | unchanged | new guard semantics |
| `GET /private-class-schedules/public` | none | + `startDate`/`endDate`/`packageOffers`; − `firstSessionDate` |
| `GET /private-class-schedules/:id/available-dates?days=` | none | new (registered after `/public` and `/mine`) |
| `GET /private-class-enrollments/preview?scheduleId&quantity` | parent | new |
| `POST /private-class-enrollments` | parent | body `{ studentId, scheduleId, day, quantity }` |
| `GET /private-class-enrollments/mine` · `GET /private-class-enrollments` | unchanged | new shape |
| `POST /private-class-enrollments/:id/cancel` | — | **removed** |
| `POST /private-class-sessions` | parent | new — credit booking `{ studentId, scheduleId, day }` |
| `GET /private-class-sessions/mine?window=` | coach | new row shape |
| `PATCH /private-class-sessions/:id/attendance` | coach-own \| admin | Visit-backed |
| `POST /private-class-sessions/:id/cancel` | parent-own \| coach-own \| admin | new |
| `POST /private-class-sessions/:id/retry-charge` | — | **removed** |

Controllers stay one-line `next(error)` (PR B's contract).

### 2.15 Delete guards, scripts, diagnostics

- `user.service.js` `remove()` (lines 275–308): student guard counts `PrivateClassEnrollment` +
  `confirmed` future `PrivateClassSession`; coach guard drops the freed-slot notion (schedules
  simply count). `Visit` rows are never a delete blocker (same as group today).
- `scripts/reset-customer-data.js` (lines 122–195): the "freed" schedule branch is deleted (no claim
  fields); sessions/enrollments cleanup keyed on `studentId`/`parentId` as today; Visits with
  `privateClassSessionId` cleaned alongside group Visits.
- `scripts/lib/findOrphanedReferences.js`: drop the `PrivateClassSchedule.studentId` check; add
  `PrivateClassSession.enrollmentId` → enrollment and `Visit.privateClassSessionId` → session.
- `scripts/extend-private-sessions.js` + its npm script (`backend/package.json` line 20):
  **deleted**. `legacy-import.config.js`'s `IMPORT_PRIVATE_CLASS_ENROLLMENTS` flag and
  `runLegacyImport.js`'s branch: deleted (it created the old shape). `audit-reset.js`,
  `wipeDatabase.js`, `familyGrouping.js`, `migrateToUnifiedLedger.js`: verify at build time — the
  grep shows they reference the model names only; update any field reference the build finds.

### 2.16 Backend tests (write before committing — `docs/TESTING_STRATEGY.md` rules apply to each)

Every suite freezes the clock (`jest.useFakeTimers({ now, doNotFake })`) before seeding, builds
instants through `combineDayAndTimeInTZ`, sentinels through `dateOnlyUTC`, runs under `TZ=UTC`.

| Suite | Coverage |
|---|---|
| `tests/utils/privateClassPricing.test.js` | `computePackTotal` (rounding, 0%, 100%, throws on quantity 0 / 1.5 / negative percent); `resolvePackOptions` (1 always first, sorted, settings `[]`). |
| `tests/utils/scheduleOccurrence.test.js` | **deleted** with the util, once no consumer remains (verify with grep; the group side never used it). |
| `tests/models/privateClassSession.model.test.js` (new) | partial unique index: two `confirmed` collide, a `cancelled` + a new `pending` do not — the index is ours (partial filter), so this is a "we use it correctly" test, not a Mongoose test. |
| `tests/routes/privateClassSchedule.routes.test.js` | bulk: 6 rules from 17:00–20:00/30 min on Mon+Wed = 12 docs; window not divisible drops the tail; overlap in DB → 409 listing conflicts; overlap within the batch → 409; coach without contract → 400; admin on behalf; range validation. Available dates: holiday day excluded (seed a `Holiday`); a `confirmed` session removes its day, a `cancelled` one does not; strictly-after-now (freeze the clock at a Tuesday 09:00 Central for a Tuesday 17:00 rule — that day offers; freeze at 18:00 — it does not); range edges inclusive. Delete: 409 with an upcoming `confirmed` booking, 200 with only past/cancelled ones. |
| `tests/routes/privateClassEnrollment.routes.test.js` | **real Stripe test mode** (the same harness as `registration.routes.test.js` — saved `pm_card_visa`). Happy path: session `confirmed`, enrollment `active` with `sessionsUsed 1`, ledger `completed` with `quantity`/`unitPrice`/`discountPercent`/`amount = computePackTotal`, a `scheduled` Visit with `serviceId = private-lessons` and `classType 'private'`, `remaining` in the response. Pack of 10 at 10%: amount matches the util. Decline (`pm_card_chargeDeclined`): 402, ledger `failed`, **no session, no enrollment, no Visit**, and the same day is bookable again immediately. Race: two concurrent creates for the same day → one 201, one 409, exactly one ledger row (the D5 guarantee). D10: a seeded 20-minute-old `pending` session with no ledger row is replaced; a 5-minute-old one still 409s. Quantity not offered → 400. Holiday day → 400. Started instant → 400. No card → 400 and nothing written. Preview matches the charged amount byte for byte. `mine` shape. |
| `tests/routes/privateClassSession.routes.test.js` | Credit booking: consumes from the oldest active enrollment (seed two), skips an exhausted one, rejects duration mismatch (a 60-min enrollment cannot book a 30-min rule), 409 when none remain and the pending session is gone. Attendance: `attended`/`missed` write the Visit (assert via `Visit.findOne`), 403 for another coach, 400 before start, 409 on a `cancelled` session, no ledger row ever created (assert count 0). Cancel: parent 25h before → credit returned (`sessionsUsed` back), Visit `cancelled`; parent 23h before → 403 with the cutoff message; coach 1h before → allowed; anyone after start → 409; a second cancel → 409; the day becomes available again. `mine` windows (`unmarked` reads the Visit status). |
| `tests/services/privateClassSession.service.test.js` | Rewritten for `book`/`cancel`/`markAttendance` unit behavior (replaces the `generateSessions`/`chargeSession` suite). Includes the cancel-then-book race: a cancel and a new booking for the freed day interleaved — the new booking wins only after the cancel commits (the partial index proves it). |
| `tests/services/invoice.service.test.js` | per-session line items with and without a discount; `total === row.amount`; `periodLabel` is the purchase date. |
| `tests/routes/registration.routes.test.js` | history row description for a pack. |
| `tests/routes/setting.routes.test.js` | `privateClassPackages` round-trip, duplicate quantity → 400, quantity 1 → 400. |
| `tests/scripts/lib/retireRecurringPrivateClasses.test.js` (new) | dry-run writes nothing; refuses with money present; applies on a money-free old-shape fixture; index rebuilt (assert via `collection.indexes()`). |
| `tests/scripts/lib/checkPrivateCreditLedger.test.js` (new) | clean data → no findings; a drifted counter → reported; never writes. |
| `tests/services/mail.service.test.js` + `tests/email/*` | the four templates render; `privateClassCoachBooking` goes **to** the coach; the deleted template is gone from the registry. |
| `tests/routes/user.routes.test.js` | coach delete blocked by a schedule; student delete blocked by a `confirmed` future session, allowed with only cancelled/past ones. |

Coverage re-measured into `docs/TEST_COVERAGE.md`.

### 2.17 Docs (same PR)

ADR **011 — Private lessons are per-session bookings paid at purchase** (`docs/decisions/011-
private-per-session-booking.md`): the D3/D4/D5/D8 sequence, the no-refund credit-return rule, and
an addendum on ADR 001 (its "charge after attendance" line for private lessons is superseded).
`docs/features/private-class.md` rewritten top to bottom (lifecycle, models, the booking pipeline
with its guard layers, cancellation, routes, pages). `DATABASE_SCHEMA_DOCUMENTATION.md` §175–208 +
the `Registration` per-session block + `Setting`. `docs/plans/holiday-blocking-plan.md` D8 and
`docs/plans/deployment-launch-plan.md`'s deferred-cron note (the extend script no longer exists)
each get a one-line close-out. `CLAUDE.md`'s Platform Scope line for private classes and the
documentation-map row for this plan.

---

## §3 PR 3 — Frontend (`feature/private-booking-frontend`)

### 3.1 Types + services

`frontend/lib/types.ts`: `PrivateClassScheduleRow` (− `studentId`/`enrollmentId`, + `startDate`/
`endDate`/`bookedCount`), `PublicPrivateClassSlot` (− `firstSessionDate`, + `startDate`/`endDate`),
`PublicPrivateClassCoach` (+ `packageOffers`), new `PrivateAvailableDate`, `PrivateEnrollmentPreview`,
`PrivateClassEnrollmentRow` (+ counters, − `endDate`, status union `'pending' | 'active'`),
`PrivateClassSessionRow` (+ `status`, + `attendance` from the Visit, − `sessionPrice`/`markedBy`/
`markedAt`), `PrivateAttendanceResult` → `{ session, visit }`, `MyPrivateEnrollmentEntry` →
`{ enrollment, remaining, registration, sessions }`. `Setting` type + `privateClassPackages`.
Ref fields stay `| null` (orphan rule).

`lib/services/privateClass.ts`: `fetchPrivateAvailableDates(scheduleId)`, `fetchPrivateEnrollmentPreview`,
`createPrivateEnrollment({ studentId, scheduleId, day, quantity })`, `bookPrivateSession`,
`cancelPrivateSession`; **remove** `cancelPrivateEnrollment`. `lib/services/privateClassCoach.ts`:
`createMyPrivateClassSchedulesBulk`; window type `'upcoming' | 'unmarked' | 'past'` unchanged;
**remove** `retryPrivateClassCharge`. New `lib/services/__tests__/privateClass.test.ts` (query-throws /
mutation-never-throws contract, per the strategy's service layer).

### 3.2 Public `/private-classes`

Same coach-card layout; each slot shows day, time, duration, `$X per session`, and the date range;
a coach-level line "Packs: 10 sessions, save 10%" from `packageOffers`. "Book" → `/parent/register-
private?slot=<scheduleId>`. Test: renders offers; no client-side math.

### 3.3 Parent wizard `/parent/register-private` — 5 steps

`Who` → `When` (the slot from `?slot=`, switchable; a date list from `available-dates` rendered
with `formatInstant`; empty → "No dates available for this slot") → `How many` (options from
`preview`: "Use 1 of your N remaining sessions" first when the household has an active enrollment
for this coach + duration, else "1 session — $X" and each pack "10 sessions — $Y (save 10%)";
selecting a pack re-fetches the preview) → `Review & Pay` (card guard as today; consent line: "You
are paying $Y now for N sessions. A missed lesson uses a session. Cancel up to 24 hours before a
lesson to get the session back."; credit path shows no card line) → `Done` (date, remaining,
"Book another"). 402 renders the backend message inline, slot stays selected; 409 slot-taken keeps
today's "Refresh available dates" recovery. Deep links `?child=&slot=&day=`.
`__tests__/page.test.tsx` rewritten: both purchase paths, the credit path, 402, 409, empty dates,
preview totals rendered verbatim from MSW (never computed).

### 3.4 `/parent/subscriptions` — Private Lessons section

Per enrollment: coach, duration, `purchased / used / remaining`, purchase date + amount from
`registration`, status; nested list of its sessions (date/time, `Booked`/`Attended`/`Missed`/
`Cancelled` chip, a Cancel button on a future `confirmed` one behind the shared `Modal` with the
credit-return copy). "Book a session" link when `remaining > 0`. `ParentPortalContext`'s
`privateEnrollments` keeps its name and picks up the new entry shape (contract test updated).

### 3.5 Coach `/coach/private-students` → label **Private Lessons** (`AppShell.tsx` line 36)

Three tabs: **Availability** (bulk form: date range, weekday checkboxes, window start/end, slot
length; list of own rules with `bookedCount`; delete with the 409 message) — **Upcoming** (student,
parent, date/time, Cancel behind `Modal`) — **Needs attendance** (Attended / Missed, no money
dialog, no retry). `__tests__/page.test.tsx` rewritten; `AppShell.test.tsx` label assertion updated.

### 3.6 Admin `/admin/private-classes` — tabs Enrollments · Sessions · Schedules

Enrollments: purchases with counters + amount (read-only). Sessions: bookings with status,
attendance, Cancel. Schedules: bulk add on behalf of a coach (same form as 3.5 + coach select),
delete. `/admin/settings`: a `privateClassPackages` row editor (quantity + discount %). Admin nav
label unchanged (`admin/layout.tsx` line 56). Tests for each tab and the settings editor.

### 3.7 E2E — `frontend/e2e/private-booking.spec.ts` (new) + fixtures

Mocks in `fixtures/mock-api.ts` (line 158's entry replaced by the new shapes): public page →
wizard purchase path through `Done` with `page.clock` pinned; the credit path; the coach marks a
private session attended and the PATCH payload is `{ status: 'attended' }`. `admin-shell.spec.ts`
unchanged (nav label same). `coach-attendance.spec.ts` (group) unchanged. `docs/TESTING_STRATEGY.md`'s
spec table + `docs/plans/e2e-testing-plan.md`'s Phase 2 note updated.

### 3.8 Docs (same PR)

`docs/features/parent-portal.md` (§89 wizard, §117 subscriptions row, §120), `docs/features/
admin.md` §80, `docs/features/private-class.md` Pages table, `docs/design-system.md` components
inventory if a new shared piece appears (a `DatePillList` is likely reusable by book-trial — note
it, do not refactor book-trial here).

---

## §4 Sequencing, rollout, and what "done" means

1. **PR 1** merges alone; `backfill-visit-service.js` runs on staging then production before its
   deploy. Gate: full backend suite (all 71+ suites) green under `TZ=UTC`, E2E green, zero API
   shape change (the frontend build is untouched).
2. **PR 2** stacks on PR 1; `retire-recurring-private-classes.js` dry-run on staging first (expect
   the money gate at zero — if not, stop), then `--apply`; same on production before deploy.
   Gate: full backend suite green including the real-Stripe enrollment suite; `check-private-
   credit-ledger.js` clean on staging after the first live booking.
3. **PR 3** stacks on PR 2. Gate: `tsc --noEmit` clean, `next build`, full frontend suite,
   full E2E suite.
4. Owner rollout after PR 3: set `privateClassPackages` on `/admin/settings`; each coach (or admin)
   bulk-publishes their first range; one real staging booking end to end (purchase + credit + cancel
   + attendance), then `check-private-credit-ledger.js`.

Each PR follows CLAUDE.md's hard rules: tests before commit, owner local test before commit, no
auto-fix on a red suite. Explicit staging by file name; no `git add .`. *(2026-09-24: the owner
authorized building and shipping all three PRs to `develop` autonomously, reviewing afterward.)*

---

## §5 As built — where the implementation diverged from this spec

> **Later change (2026-09-24):** pack pricing (D13) was replaced after this build by
> `docs/plans/coach-pack-pricing-plan.md` — each coach's contract carries fixed-price packs per
> lesson length, the purchase request sends a `packId` instead of a `quantity`, and savings are
> derived from the ledger row. The notes below describe this plan's own build and are left as written.

Each change below was made during the build because it removes a duplicate, keeps a reference
valid, or matches an existing repo convention. `docs/features/private-class.md` describes the
system as built.

**PR 1**
1. **Scripts use `--live`, with no npm script** — the repo's existing convention
   (`backfill-session-instants.js`), not `--apply` + an npm script.
2. **The Service lookup lives inside `visit.service.js`**, so five suites that write Visits now seed
   the Service registry, and one hand-built `Visit.create` fixture was switched to the real writer.

**PR 2**
3. **One publish endpoint.** `POST /private-class-schedules` takes the bulk body; there is no
   separate `/bulk` route and no single-slot body (one slot = a one-slot window). The overlap check
   compares time windows, not just identical start times.
4. **`GET /private-class-enrollments/quote?studentId&scheduleId`** replaces
   `/preview?scheduleId&quantity`: every option is priced in one call, with `availableCredits`, so
   the wizard never refetches per choice and never adds numbers itself.
5. **Nothing is deleted on a decline or an abandoned hold.** The session gets a fourth status,
   `released` (with `releaseReason` `payment_failed` or `abandoned`), and the purchase gets `failed`.
   Deleting them would have left the failed ledger row pointing at documents that no longer exist.
   Only a purchase that never got as far as a booking (lost slot race) is deleted — nothing refers
   to it yet.
6. **The purchase charge goes through `chargeLedgerRow`** (idempotency key `payment_<rowId>`),
   the existing single Stripe charge path, instead of a second hand-rolled Stripe call keyed
   `pcs_<sessionId>_<attempt>`. Every purchase attempt is its own row, so `attempt` is always 1.
7. **Credit booking takes the credit first, then inserts the booking `confirmed`.** No pending state
   exists on the credit path, so the abandoned-hold rule only ever sees purchase holds. The one crash
   window (credit taken, insert never ran) shows up as `credit_count_drift` in the check script.
8. **A second unique partial index on `enrollmentId`** (pending/completed) makes "one ledger row
   per purchase" a database invariant, not a convention.
9. **Parent-inside-cutoff cancellation is 409, not 403** — the parent owns the booking; it is a time
   rule.
10. **Paid credits are honored after a coach's contract is deactivated.** A new purchase needs an
    active contract; the quote then offers only the credit path.
11. **Emails:** the parent confirmation carries the purchase lines and the PDF invoice (no separate
    receipt template); the coach gets their own email instead of being cc'd on the parent's.
    `privateClassSessionReceipt`, `privateClassPaymentFailed`, and the two recurring-model
    templates are gone.
12. **`packageOffers` is top-level** on `GET /public`, not repeated per coach — packs are
    academy-wide.
13. **Removing a rule with past bookings retires it** (`isActive: false`) instead of deleting it, so
    every past booking keeps a valid `scheduleId`.
14. **Legacy import:** the `IMPORT_PRIVATE_CLASS_ENROLLMENTS` flag and its enrollment branch are
    removed, not rewritten — an enrollment is paid credit and there is no payment to import. A
    flagged student now produces a warning.
15. **`find-orphaned-references.js` keeps its User-reference scope.** Only the schedule's
    `studentId` check was dropped, because the field no longer exists.
16. **Slot-index behavior was verified, not assumed:** booting the new code against the old
    same-named index logs `IndexKeySpecsConflict` and keeps the old non-partial index. So the
    cutover must run before deploy, and `check-private-credit-ledger.js` reports
    `slot_index_not_partial`.
17. **Partial-index tests live in `privateClassSession.service.test.js`**, where they exercise
    `reserveSlot`, rather than in a separate model test. Shared fixtures are in
    `tests/testUtils/privateLessons.js`.
18. **The student delete-guard is unchanged.** Every booking belongs to a purchase, so the existing
    enrollment count already covers bookings.
19. **`canCancel` and `cancelCutoffHours` come from the backend** (added to PR 2 while building PR 3):
    one `cancelBlockReason` rule is enforced by the cancel endpoint and exposed on every booking
    listing per viewer, and the quote carries the cutoff for the consent line. Otherwise the frontend
    would have had to re-derive both.

**PR 3**
20. **One publish endpoint, one publish form.** `PublishAvailabilityDialog` serves both the coach and
    admin pages (admin passes `coaches`), with its own token-only CSS Module since it renders in both
    shells. Coaches could not publish slots at all before; only the admin page could.
21. **One client function per endpoint.** Mutations used by several roles (publish, remove, cancel,
    mark attendance) live once in `lib/services/privateClass.ts`. The old coach and admin service
    files each had their own copy of the create/delete-slot calls.
22. **The portal context no longer fetches private purchases.** It fetched them for no consumer
    while `/parent/subscriptions` fetched them again. The dead MSW handlers in 7 suites were
    removed, and a test now guards that the context never makes the call.
23. **`lib/formatMoney.ts`** replaces `/admin/subscriptions`' local copy and is used by all
    private-lesson code. 20 other inline `toFixed(2)` sites (measured 2026-09-24) predate this work and are left for
    duplication-cleanup PR C.
24. **The wizard's submit errors are not string-matched.** Any failure shows the backend message with
    a "Pick another date" action and refetches dates and the quote. The old page matched "just taken"
    in the message text.
25. **The coach page's hand-rolled overlay was replaced with the shared `Modal`** (design-system
    anti-pattern 8). The nav label is now "Private Lessons"; the route is unchanged.
26. **`admin.md`'s Settings section no longer describes a proration checkbox** that the page has not
    had since ADR 007.
