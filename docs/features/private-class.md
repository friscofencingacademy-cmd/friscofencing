# Private lessons — per-session bookings

A coach publishes availability; a parent buys one session or one of that coach's packs and books
one date at a time. Money moves once, at purchase. Attendance never moves money. Design:
[ADR 011](../decisions/011-private-per-session-booking.md) (bookings) and
[ADR 010](../decisions/010-universal-visit-ledger.md) (attendance). Plan:
`docs/plans/private-class-per-session-booking-plan.md`.

This replaced the CKQ-ported recurring model (a weekly slot claimed by one family, eight generated
weeks, a Stripe charge after each attended session). That model's history is in git and in
`docs/plans/ckq-parity-plan.md`.

## Lifecycle

```
Admin creates a CoachContract for a coach (rate + comp rate + default lesson length + packs)
        │  (no active contract -> the coach can publish nothing, and nobody can buy)
        ▼
Coach (or admin) bulk-publishes availability: weekdays x time window x slot length, over a date range
        │  -> one PrivateClassSchedule rule per (weekday, start time). Nothing else is created.
        ▼
Parent picks a coach, a rule, and a date (GET /:id/available-dates computes open dates)
        │
        ├─ no credits: buy 1 session or a pack (packId) -> POST /private-class-enrollments
        │     purchase pending -> booking pending (slot claim) -> ledger pending -> Stripe
        │     -> ledger completed, purchase active (1 credit used), booking confirmed
        │     -> decline: ledger failed, purchase failed, booking released (slot reopens), 402
        │
        └─ has credits: book with one           -> POST /private-class-sessions
              oldest usable purchase: sessionsUsed +1 -> booking confirmed (no ledger row)
        ▼
Booking confirmed -> scheduled Visit, parent email (+ PDF invoice for a purchase), coach email
        ▼
Coach marks the Visit attended / missed after the lesson starts (no money)
   or: cancel before it starts -> credit returned, Visit cancelled, slot reopens
```

## Models (`backend/src/models/`)

| Model | Role | Key fields |
|---|---|---|
| `CoachContract` | Rate and pack source | `studentBillingRate` ($/hr), `coachCompensationRate` (audit only), `sessionDurationMinutes` (default slot length), `privateLessonPacks` (`[{ _id, sessionDurationMinutes, quantity, price }]` — fixed-price packs per lesson length, editable on the active contract), `isActive`. One active contract per coach. |
| `PrivateClassSchedule` | Availability rule | `coachId`, `dayOfWeek`, `startTime` "HH:mm" Central, `durationMinutes`, `startDate`/`endDate` (calendar-day sentinels, inclusive), `isActive`. No student is ever stored here. |
| `PrivateClassEnrollment` | One purchase of credits (no price field) | `studentId`/`parentId`/`coachId`, `coachContractId`, pinned `agreedHourlyRate`, `sessionDurationMinutes`, `quantity`, `sessionsUsed`, `status` `pending`/`active`/`failed`. Remaining = `quantity - sessionsUsed`, never stored. |
| `PrivateClassSession` | One booking | `scheduleId`, `enrollmentId`, `coachId`/`studentId`/`parentId`, `startDate`/`endDate` (real instants), `status` `pending`/`confirmed`/`cancelled`/`released`, `releaseReason`, `cancelledAt`/`cancelledBy`. **Partial unique index `(scheduleId, startDate)` where status is pending or confirmed** — the slot claim. |
| `Registration` (`per_session`) | The money | One row per purchase: `sessionId` (the booking it came with), `enrollmentId`, `quantity`, `unitPrice` (single-session price), `amount` (what was charged). Savings are derived, never stored. Unique partial indexes on `sessionId` and on `enrollmentId` (pending/completed). |
| `Visit` | Attendance | `privateClassSessionId`, `classType: 'private'`, `serviceId` = private-lessons. |

Full field tables: `DATABASE_SCHEMA_DOCUMENTATION.md`.

## Single sources of truth

| Question | Answered only by |
|---|---|
| Is this (rule, day) bookable? | `privateClassSchedule.service.js` `resolveBookableInstant` — used by the date picker and both booking paths |
| Who holds this slot? | The partial unique index on `PrivateClassSession` |
| What does a session / a pack cost, and what does it save? | `utils/privateClassPricing.js` — `computeSessionPrice`, `quotePurchase` (the only savings formula), `purchaseOptionsFor` (the one shape of a purchase option, used by the quote, the purchase and the public listing) |
| Which packs are offered? | The coach's active `CoachContract.privateLessonPacks`, only those of the slot's length |
| Is a pack's price allowed? | `privateClassPricing.js` `describePack` (the one check; `validatePacks` runs it on save, `POST /coach-contracts/pack-quotes` runs it for the editor preview) against `packPriceBand`: `[ceil(subtotal × PACK_PRICE_FLOOR_RATIO), subtotal − $0.01]`, whole cents |
| What lines does a purchase's email / invoice show? | `privateClassPricing.js` `purchaseBreakdown(row)` — from the ledger row, total always `row.amount` |
| What was paid? | The `Registration` row. `amount` is never re-derived. |
| How many credits are left? | `PrivateClassEnrollment` counters, reconciled against the ledger by `scripts/check-private-credit-ledger.js` |
| Did the student attend? | The `Visit` |
| How is a purchase described? | `utils/privateLessonLabels.js` — payment history and the invoice share it |
| Can this booking be cancelled, by this viewer, now? | `privateClassSession.service.js` `cancelBlockReason` — enforced by the cancel endpoint, exposed on every booking listing as `canCancel` |

## Booking pipeline guards

1. **Validation before any write**: own student, live rule and coach, bookable day (range, weekday, holiday, not started), an offered option (`packId` absent = single session; a `packId` not among the slot's current options — removed, edited, or another length — is a 409 "This pack is no longer offered", nothing written), positive price, card on file, `private-lessons` Service active with the `per_session` shape.
2. **Reserve before charging**: the booking is inserted `pending` before Stripe is called. A lost race is a 409 with nothing charged.
3. **One Stripe path**: `billing/chargeFinalization.service.js` `chargeLedgerRow`, idempotency-keyed `payment_<rowId>`.
4. **Money dedup**: the ledger's unique partial index on `sessionId`.
5. **Decline**: row `failed`, purchase `failed`, booking `released` (`payment_failed`), 402. The slot is bookable again at once.
6. **Unexpected Stripe error**: everything stays `pending` and the slot stays held, so money that may have moved is never lost track of. The check script reports it.
7. **Abandoned holds**: a `pending` booking older than `PENDING_HOLD_TTL_MINUTES` (15) with no pending/completed charge is released by the next attempt on that slot.
8. **Credit path**: atomic guarded `$inc` (`sessionsUsed < quantity`) on the oldest usable purchase, then the claim; a lost claim returns the credit.

## Cancellation and attendance

- **Cancel** (`POST /private-class-sessions/:id/cancel`): confirmed and not started. A parent may cancel until `PARENT_CANCEL_CUTOFF_HOURS` (24) before the lesson; the assigned coach or an admin until it starts. The credit returns and the Visit is cancelled. No money moves (ADR 001). The rule is one function, `cancelBlockReason`: the endpoint enforces it, and every booking listing exposes it per viewer as `canCancel`, so a Cancel button can never disagree with the endpoint. The purchase quote carries `cancelCutoffHours` for the wizard's consent line.
- **Attendance** (`PATCH /private-class-sessions/:id/attendance`): the assigned coach or an admin, confirmed booking, lesson started (`startDate <= now` — an exact instant, unlike group's day rule). Writes the Visit only. A missed lesson keeps its credit spent.
- A holiday added after a booking does not cancel it. Cancel it from the admin page to return the credit.

## Routes

| Endpoint | Guard | Notes |
|---|---|---|
| `POST /private-class-schedules` | coach (self) \| admin (body `coachId`) | Bulk publish `{ daysOfWeek, windowStart, windowEnd, slotDurationMinutes?, startDate, endDate }`. All-or-nothing; 409 names every slot that overlaps existing availability (time and date range). |
| `GET /private-class-schedules/mine` | coach | Current rules with `bookedCount` |
| `GET /private-class-schedules` | admin | Same, all coaches, `?coachId=` |
| `GET /private-class-schedules/public` | none | `{ coaches: [{ coachId, coachName, slots: [...] }] }` — slot = rule + `sessionPrice` + `hourlyRate` + `options` (the quote's exact option shape: single session, then that coach's packs for the slot's length). No student data. |
| `GET /private-class-schedules/:id/available-dates?days=` | none | `{ dates: [{ day, startDate, endDate }] }` — default 56 days, max 120 |
| `DELETE /private-class-schedules/:id` | coach-own \| admin | 409 with an upcoming booking; `retired` if it has past bookings; else `deleted` |
| `GET /private-class-enrollments/quote?studentId&scheduleId` | parent | `{ durationMinutes, hourlyRate, options: [{ packId, quantity, unitPrice, subtotal, savings, total }], availableCredits, cancelCutoffHours }` |
| `POST /private-class-enrollments` | parent | Buy + book `{ studentId, scheduleId, day, packId? }` -> `{ enrollment, session, registration, remaining }`. 409 when `packId` is not an offered option. |
| `GET /private-class-enrollments/mine` | parent | Active purchases: `{ enrollment, remaining, payment: { amount, quantity, unitPrice, savings, paidAt }, sessions }` |
| `GET /private-class-enrollments` | admin | Same, `?status=&coachId=` |
| `POST /private-class-sessions` | parent | Book with a credit `{ studentId, scheduleId, day }` -> `{ session, enrollment, remaining }` |
| `GET /private-class-sessions/mine?window=upcoming\|unmarked\|past` | coach | Confirmed bookings with `attendance` (from the Visit) and `canCancel` |
| `GET /private-class-sessions` | admin | Confirmed + cancelled by default, `?status=&coachId=` |
| `POST /coach-contracts` | admin | Create a contract; `privateLessonPacks` optional (omitted = the previous active contract's packs carry over), every pack re-checked against the new rate |
| `PUT /coach-contracts/:id/packs` | admin | Replace the active contract's packs `{ privateLessonPacks }`; an unchanged pack keeps its `_id`, an edited one gets a new one; 409 on an inactive contract |
| `POST /coach-contracts/pack-quotes` | admin | Pack-editor preview `{ studentBillingRate, packs }` -> `{ quotes: [{ …pack, perLessonPrice, subtotal, savings, savingsPercent, allowedRange, error }] }`. Writes nothing; `error` is the exact message a save would return. |
| `PATCH /private-class-sessions/:id/attendance` | coach-own \| admin | `{ status: 'attended' \| 'missed' }` -> `{ session, visit }` |
| `POST /private-class-sessions/:id/cancel` | parent-own \| coach-own \| admin | -> `{ session, remaining }` |

## Emails (`docs/modules/email.md`)

`privateClassBookingConfirmation` (parent, cc admin; purchase lines + PDF invoice when the booking
came with a purchase), `privateClassCoachBooking` (coach, cc admin), `privateClassBookingCancelled`
(parent, cc admin + coach).

## Operations

- `scripts/retire-recurring-private-classes.js` — one-time cutover from the recurring model. Dry
  run by default, `--live` to apply. Refuses if the old model ever moved money. **Run before
  deploying**: autoIndex cannot replace the old same-named, non-partial slot index (verified — it
  logs `IndexKeySpecsConflict` and keeps the old index, which would block every cancelled slot).
- `scripts/check-private-credit-ledger.js` — read-only. Reports purchases that disagree with the
  ledger, credit drift, stranded pending holds and purchases, and a non-partial slot index.
- `scripts/find-orphaned-references.js` — read-only User-ref scan (coach/student/parent).

## Orphaned-reference handling

Frisco hard-deletes users. `user.service.js` blocks deleting a coach referenced by a rule,
contract, or purchase, and a student referenced by a purchase (every booking belongs to a
purchase). Booking paths 404 a rule whose coach no longer resolves; the public listing skips it.
Management pages show a fallback label for a missing person.

## Pages

| Page | Role | Purpose |
|---|---|---|
| `/private-classes` | public | Each coach's availability rules (slot, server price per session, bookable range) with that coach's own packs for each slot's length; "Pick a date" → the wizard (`/login?next=` when logged out) |
| `/parent/register-private` | parent | 5-step wizard — Who → When (open dates) → Sessions (use a paid session, or buy 1 / a pack, all from the quote) → Review (card guard for a purchase; cancel-cutoff consent) → Done. `?slot=&child=&day=` deep links |
| `/parent/subscriptions` (Private Lessons section) | parent | Each purchase — sessions left, amount paid — with its bookings; Cancel where `canCancel` |
| `/coach/private-students` ("Private Lessons" in the nav) | coach | Tabs: Needs attendance (Attended / Missed — a Visit, no money) · Upcoming (Cancel where `canCancel`) · Availability (publish in bulk, remove) |
| `/admin/private-classes` | admin | Tabs: Purchases (read-only) · Bookings (cancel) · Availability (publish for any coach, remove) |
| `/admin/coach-contracts` | admin | Rate contracts plus each coach's packs: one `PackEditor` (live backend preview per pack) in the create dialog, prefilled from the current contract, and behind an "Edit packs" action on the active contract |

Shared frontend pieces: `lib/services/privateClass.ts` (one client function per endpoint; mutations used
by several roles live here once), `lib/services/privateClassCoach.ts` / `privateClassAdmin.ts` (role
list queries), `lib/privateLessons.ts` (every private-lesson display string — lesson time, slot,
range, booking status), `lib/formatMoney.ts`, and
`app/components/privateLessons/PublishAvailabilityDialog` (the one publish form, coach and admin).

## Out of scope

Refunds, credit expiry, reschedule requests, coach notes/tags on a lesson, coach payout, guest
checkout, an admin "void a pack" action, a cross-service attendance report UI.
