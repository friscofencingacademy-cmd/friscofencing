# Private classes

One-on-one coaching, ported from the CKQ platform (`docs/plans/ckq-parity-plan.md` Phase 4) with
one substitution: CKQ's *admin creates enrollment → parent accepts* becomes *coach publishes
slots → parent self-registers on a public page* — an enrollment is born active with the rate
pinned. Session generation, attendance, per-session off-session Stripe charge, and cancellation
are CKQ's design, carried over with four fixes (`CKQ-BUG-FIX`, below).

## Lifecycle

```
Admin creates a CoachContract for a coach (rate + comp rate)
        │  (a coach with no active contract can publish nothing)
        ▼
Coach (or admin on their behalf) publishes a PrivateClassSchedule slot
        │  (studentId: null = available)
        ▼
Parent browses GET /private-class-schedules/public (no auth) and self-registers
        │  atomic slot claim (findOneAndUpdate studentId:null → studentId)
        ▼
PrivateClassEnrollment born ACTIVE, agreedHourlyRate PINNED from the contract
        │
        ▼
generateSessions(): 8 weeks of PrivateClassSession docs (scheduled)
        │
        ▼
Coach marks a past session attended/missed
        │  attended → chargeSession(): PrivateClassCharge (pending → completed|failed)
        ▼
Parent (or admin) cancels the enrollment
   → every claimed slot freed, only FUTURE sessions deleted, past sessions/charges untouched
```

## Models (`backend/src/models/`)

| Model | Collection | Key fields |
|---|---|---|
| `CoachContract` | `coachcontracts` | `serviceId` (ref `Service`, always 'private-lessons' today — set internally, never client-supplied), `coachId`, `studentBillingRate` ($/hr billed to parent), `coachCompensationRate` ($/hr paid to coach — audit only, no payout UI), `sessionDurationMinutes`, `isActive`. Creating a new contract deactivates the coach's previous active one (service layer) — one active contract per coach. |
| `PrivateClassSchedule` | `privateclassschedules` | `coachId`, `dayOfWeek` (0–6), `startTime` ("HH:mm"), `durationMinutes`, `studentId`/`enrollmentId` (both `null` = available). Duplicate rule (same coach+day+time) is a service-level 409. |
| `PrivateClassEnrollment` | `privateclassenrollments` | `studentId`/`parentId`/`coachId`, `coachContractId` (audit trail), `agreedHourlyRate` (**pinned at registration, immutable — D7**), `status` (`active`/`cancelled`), `endDate`. |
| `PrivateClassSession` | `privateclasssessions` | `scheduleId`, `enrollmentId`, denormalized `coachId`/`studentId`/`parentId`, `startDate`/`endDate`, `attendance` (`scheduled`/`attended`/`missed`), `markedBy`/`markedAt`. **Unique index `{ scheduleId: 1, startDate: 1 }`** — generator idempotency; safe to re-run. |
| Payment ledger | `registrations` (`per_session` discriminator) | **Not its own collection** — private-lesson charges are rows in the unified `Registration` ledger (`docs/plans/service-registry-unified-ledger-plan.md`, absorbing the former standalone `PrivateClassCharge` collection). Same fields as before (`sessionId`, `enrollmentId`, `amount`, `status`, `stripePaymentIntentId`, `attempt`, `failureMessage`, `paidAt`) plus `serviceId` (always the 'private-lessons' Service) and `billingShape: 'per_session'`. Same unique PARTIAL index on `sessionId` (`status ∈ {pending, completed}`, `failed` excluded so a retry is never blocked) — just living on the shared collection now, scoped by `sessionId: {$exists: true}` so it can never collide with a group-class ledger row. |

Full field tables + index rationale also live in `DATABASE_SCHEMA_DOCUMENTATION.md`.

## Orphaned-reference handling (orphaned-coach-reference-fix-plan)

Frisco hard-deletes users (no soft-delete `isDeleted` flag, unlike CKQ) — a User `_id`
referenced by another collection can go missing the moment a delete-guard is incomplete. This
caused a live production/staging incident: two orphaned free `PrivateClassSchedule` docs (their
coach hard-deleted before a guard blocked it) 500'd the public `/private-classes` page on an
unconditional `.coachId._id` read after a null populate. Two layers now guard against a repeat:

- **Delete guards (`user.service.js` `remove()`).** Deleting a **coach** is blocked (409) by any
  `PrivateClassSchedule`, `CoachContract`, or `PrivateClassEnrollment` still referencing them
  (alongside the pre-existing `GroupClassSchedule` check). Deleting a **student** is blocked by any
  `PrivateClassEnrollment` referencing them (alongside the pre-existing `Subscription`/`TrialClass`
  checks) — this student-side check was the gap that let the live incident's orphans form.
- **Read-path degradation (D1/D2, asymmetric by purpose).** A read path that already existed before
  a delete-guard closed the gap above can still encounter an orphan from before the fix. Two
  different correct behaviors, by what the listing is for:
  - **Booking-availability listings exclude the orphaned row** — `listPublic()` filters out any
    slot whose `coachId` didn't populate before grouping (mirrors `groupClassSchedule.service.js`'s
    own `listPublic()`), and `privateClassEnrollment.service.js create()` 404s a stale bookmarked
    slot link whose coach is gone, on top of its existing `isActive` check.
  - **Historical/management/financial listings keep the row and show a fallback label** instead of
    crashing — every admin/parent page that renders a possibly-null `coachId`/`studentId`/`parentId`
    (`admin/coach-contracts`, `admin/private-classes`, `admin/subscriptions`,
    `parent/subscriptions`) does `person ? \`${person.firstName} ${person.lastName}\` : 'Coach no
    longer available'` (or the student/parent equivalent) rather than assuming the ref is populated.
    `frontend/lib/types.ts` widens every one of those ref fields to `| null` so `tsc --noEmit`
    catches the next unguarded read.
- **Diagnostics, read-only.** `backend/scripts/find-orphaned-references.js` (lib:
  `scripts/lib/findOrphanedReferences.js`) scans `PrivateClassSchedule`/`CoachContract`/
  `PrivateClassEnrollment`/`PrivateClassSession` for any `coachId`/`studentId`/`parentId` that no
  longer resolves to a `User`, and reports only — no writes. `backend/scripts/reset-customer-data.js`
  (the staging reset tool) was extended so it can never itself become a source of new orphans: it
  cleans up `PrivateClassEnrollment`/`PrivateClassSession`/`Evaluation` rows and frees or deletes
  `PrivateClassSchedule`/`CoachContract` rows for every user it deletes.

## Pricing — `backend/src/utils/privateClassPricing.js`

The **only** place the per-session price formula lives (Hard Rule 7 — no pricing math anywhere
else, frontend included):

- `computeSessionPrice(hourlyRate, durationMinutes)` — `round(rate * minutes / 60, 2)`, throws
  (never guesses) on a missing/NaN/negative rate or a non-positive duration.
- `sessionDurationMinutes(startDate, endDate)` — minute difference between two Date instants.

Every consumer (session charge, the public availability preview, confirmation/receipt emails, the
coach page's confirm-attendance dialog) imports from here. The dollar amount is never stored
anywhere except `PrivateClassCharge.amount` — always computed at the point of use from the
(pinned) hourly rate and the session's own stored duration.

`backend/src/utils/scheduleOccurrence.js` — `nextOccurrenceStrictlyAfter(fromDate, dayOfWeek)`:
the first occurrence of a weekday **strictly after** the given date (never today itself, unlike
`GroupClassSession`'s on-or-after generator). Shared by the public availability preview and
session generation so both use the exact same rule. Disclosed MVP simplification: operates on the
server process's local `Date`, not a full IANA `America/Chicago` conversion — matches the rest of
the codebase's date math; test suites run under `TZ=UTC`.

## The four CKQ-BUG-FIXes

1. **Atomic slot claim.** CKQ reads a slot then writes it in two steps, racing two parents for
   the same slot. Here, `privateClassEnrollment.service.js create()` claims with a single atomic
   `findOneAndUpdate({ _id, studentId: null, isActive: true }, { $set: { studentId, enrollmentId } })`.
   A lost race gets a 409 and its orphan enrollment is deleted immediately — no dangling record.
2. **Coach ownership on attendance.** CKQ lets any coach mark any session attended. Here,
   `markAttendance`/`retryCharge` require the requester to be admin/superadmin OR the session's
   own `coachId` (403 "You are not the coach for this session").
3. **Suffixed Stripe idempotency key.** CKQ's un-suffixed key made Stripe replay a cached decline
   for 24h, blocking same-day retry. Here the key is `pcs_${session._id}_${attempt}` — every
   retry (which bumps `attempt`) gets its own key, so a fixed-and-retried charge is a fresh
   Stripe call.
4. **Payment-failure email.** CKQ sends nothing when a charge fails. Here,
   `sendPrivateClassPaymentFailedEmail` fires (log-only try/catch) on both the no-payment-method
   path and a `StripeCardError`.

## Charge pipeline + idempotency (three layers)

`markAttendance(sessionId, 'attended', requestingUser)` → `chargeSession(session)`:

1. **Ownership guard** (fix #2 above) → 403 for a non-assigned coach.
2. **Time guard** — 400 if `session.startDate > now` (can't record attendance for the future).
3. **No un-marking to `scheduled`** — only `attended`/`missed`.
4. **Attendance/money contradiction guard** — if a `completed` charge already exists, any change
   away from `attended` is a 409 ("This session has already been charged").
5. **Cancel-then-charge race guard** (mandatory coverage per the testing strategy) — a *fresh*
   re-fetch of the enrollment inside `chargeSession`; charges only if `status === 'active'` OR
   (`cancelled` AND `session.startDate <= enrollment.endDate` — delivered before the
   cancellation took effect). Otherwise: attendance is recorded, no charge, response carries
   `{ charged: false, reason: 'enrollment_cancelled' }`.
6. **Layer 1 — pre-check.** An existing `pending`/`completed` charge for the session short-circuits
   to that charge's outcome (idempotent — a double-save of the same attendance never
   double-charges).
7. **Layer 2 — unique partial index.** Creating the `PrivateClassCharge` doc can still race; an
   `E11000` on the partial unique index is caught and treated as "already charged," returning the
   winning charge.
8. **Layer 3 — Stripe idempotency key** (fix #3 above) — even if two processes both reach the
   Stripe call for the same session+attempt, Stripe itself dedups by key.
9. **No payment method** → charge `failed`, `sendPrivateClassPaymentFailedEmail`, response
   `{ charged: false, chargeStatus: 'failed' }` (200, not an error — a payment failure is a
   billing state, not a request failure).
10. **`StripeCardError`** → same failed/email/200 outcome as above; `retryCharge` re-runs
    `chargeSession` verbatim once the card is fixed, minting a fresh `attempt`+idempotency key.
11. **Success** → charge `completed`, `paidAt`, `stripePaymentIntentId`,
    `sendPrivateClassSessionReceiptEmail` — carrying a PDF invoice attachment
    (`docs/plans/manual-charge-and-pdf-invoice-plan.md` PR 2; `docs/modules/email.md`'s
    "PDF invoice attachments" section) generated from the just-`completed` `charge` doc (already
    reflects `status: 'completed'` in memory here — the `.save()` above mutates the real Mongoose
    document, unlike the group-class ledger's `findByIdAndUpdate`-based path, so no re-fetch is
    needed). A private-lesson row has no `Location` of its own, so its invoice always shows the
    academy's own address (D9). A PDF generation failure is caught in its own nested try/catch —
    it drops only the attachment, never the receipt email or the charge outcome.

## Cancellation (D8 — no refunds, no proration, ever)

`privateClassEnrollment.service.js cancel(enrollmentId, requestingUser)` (parent-own | admin):

1. `{ status: 'cancelled', endDate: now }`.
2. Free every slot the enrollment claimed: `$set: { studentId: null, enrollmentId: null }`.
3. **Hard-delete only future sessions** (`startDate > now`) — provably money-free, since charging
   requires attendance and attendance requires `startDate <= now`.
4. `sendPrivateClassCancellationEmail` (log-only). Past sessions and completed charges are an
   immutable ledger — untouched.

## Session generation

`privateClassSession.service.js generateSessions({ enrollmentId })` — for each claimed active
slot, creates the next **8 weeks** of `PrivateClassSession` docs starting from the first
occurrence of the slot's `dayOfWeek` strictly after today (mirrors group's 8-week
`generateInitialSessions` window rather than CKQ's 10, for consistency). Idempotent: in-memory
dedup against existing session start times, backstopped by the model's unique
`(scheduleId, startDate)` index — safe to re-run.

`backend/scripts/extend-private-sessions.js` (npm script `extend-private-sessions`) re-runs
generation for every active enrollment — same manual-run model as `run-renewals.js`, no scheduler
yet. See `docs/plans/deployment-launch-plan.md`'s deferred-cron note.

## Routes

| Endpoint | Guard | Behavior |
|---|---|---|
| `POST /coach-contracts` | admin, superadmin | validates coach exists + `role==='coach'`; deactivates previous active contract |
| `GET /coach-contracts?coachId=` | admin, superadmin | list, populated coach |
| `POST /coach-contracts/:id/deactivate` | admin, superadmin | `isActive=false` |
| `POST /private-class-schedules` | coach (self) \| admin (any, body `coachId`) | requires an active contract (400); duplicate slot 409 |
| `GET /private-class-schedules/mine` | coach | own slots (registered before `/:id`-style routes) |
| `GET /private-class-schedules` | admin, superadmin | all slots, filters `coachId`, `available=true` |
| `DELETE /private-class-schedules/:id` | coach-own \| admin | only if `studentId === null`, else 409 |
| `GET /private-class-schedules/public` | none | see below |
| `POST /private-class-enrollments` | parent | self-register — see below |
| `GET /private-class-enrollments/mine` | parent | own enrollments + slot + last 10 charges each |
| `GET /private-class-enrollments` | admin, superadmin | all, filters `status`, `coachId` |
| `POST /private-class-enrollments/:id/cancel` | parent-own \| admin | see Cancellation above |
| `GET /private-class-sessions/mine?window=upcoming\|unmarked\|past` | coach | own sessions; `unmarked` = past + still `scheduled` |
| `PATCH /private-class-sessions/:id/attendance` | coach (own) \| admin | see charge pipeline |
| `POST /private-class-sessions/:id/retry-charge` | coach (own) \| admin | only when the latest charge is `failed` |

`GET /private-class-schedules/public` — unauthenticated, no student/parent data leaks. Returns
coaches with an active contract AND ≥1 available slot:
```json
[{ "coachId", "coachName",
   "slots": [{ "scheduleId", "dayOfWeek", "dayName", "startTime", "displayTime",
               "durationMinutes", "sessionPrice", "hourlyRate", "firstSessionDate" }] }]
```
`sessionPrice` and `firstSessionDate` are always server-computed — the frontend never does date
or price math.

## Pages

| Page | Role | Purpose |
|---|---|---|
| `/private-classes` | public (no auth) | Browse coaches/slots/prices; "Book this slot" → `/parent/register-private?slot=<id>` |
| `/parent/register-private` | parent | 3-step flow-kit wizard (Who → Review & Pay → Done); saved-card guard; 409 slot-taken renders a "Refresh available slots" recovery action |
| `/parent/subscriptions` (Private Lessons section) | parent | Per-enrollment coach/slot/rate/status/recent-charges + Cancel |
| `/coach/private-students` | coach | "Needs Attention" (unmarked past sessions, Attended/Missed with a money-amount confirm dialog + Retry charge on a failed charge) + read-only Upcoming |
| `/admin/coach-contracts` | admin | List + create + deactivate |
| `/admin/private-classes` | admin | Tabs: Enrollments (cancel action) / Schedules (add slot, delete free slots) |

## Out of scope (explicitly, per the plan)

Refunds of any kind · level promotion / premium tiers · private-class trials or reschedule
requests · coach payout UI / timesheets · dunning/auto-cancel retries for private charges (retry
is manual via the coach button) · Stripe webhooks for private charges · guest checkout.
