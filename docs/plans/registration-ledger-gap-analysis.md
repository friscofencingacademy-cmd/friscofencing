# Gap analysis: `Registration`/`Subscription` is not a payment ledger

**Status:** Reviewed and DECIDED 2026-08-27 — the candidate direction below was adopted (with one correction: the concurrent-registration race is closed by a partial unique index on `Subscription {studentId, scheduleId, status:'active'}`, not by the Registration ledger index, which cannot see two racing subscriptions). Implementation spec: `docs/plans/registration-ledger-plan.md`. Nothing built yet.

**Date:** 2026-08-27

---

## The question that started this

> "subscription collection is supposed to be the collection that shows who is registered and what level etc, registration is the collection that should act like our ledger. Registration is mostly immutable and keeps track of payments and history of payments, has stripe details of payment intent and stuff. Now do we have both setup like this because this is how chesskq is setup?"

**Answer: no, on both counts.** Frisco's group-class `Registration`/`Subscription` split does not match that description, and does not match how CKQ is actually built. Verified directly against both codebases' source, not from memory.

---

## What Frisco has today (group classes)

`backend/src/models/registration.model.js` — the entire schema:

```js
{
  studentId: ObjectId,   // ref User
  scheduleId: ObjectId,  // ref GroupClassSchedule
  status: 'active' | 'cancelled',
  timestamps: true,
}
```

No amount, no payment status, no Stripe PaymentIntent id, no date-of-charge. And it is only ever created **once**, at initial signup (`registration.service.js`'s `create()`). `renewal.service.js`'s `renewOne()` — the monthly renewal charge — never creates a new `Registration` document. So even if the schema had payment fields, nothing writes a new row after month one; there is structurally no per-charge history.

`Subscription` (`backend/src/models/subscription.model.js`) carries `lastChargeAmount` / `lastSiblingDiscountApplied` / `registrationFeeCharged` / `firstChargeProrated` — but every one of these is a single **overwritten-in-place** snapshot of the most recent charge. The model's own comment says it outright:

> "Record of what happened at the most recent charge — for display/record-keeping only. NOT the source of truth for future discount decisions."

Every renewal (`renewal.service.js:162-173`) overwrites `lastChargeAmount`/`lastSiblingDiscountApplied` via `findOneAndUpdate`. There is no historical record anywhere of what was charged last month, or the month before that.

**No `stripePaymentIntentId` is stored anywhere in the group-class path.** Grepped every model file in the repo for `paymentIntent`/`PaymentIntent`: the only two hits are `privateClassCharge.model.js` (a *different* feature — private lessons) and `webhookEvent.model.js`. Neither is group-class registration or renewal. If a group-class charge ever needs to be traced back to a specific Stripe PaymentIntent — a support question, a dispute, a reconciliation — there is currently no stored link to find it by.

## What CKQ actually does

Verified directly against `chesskqwebsite/backend/backend-2.0/src`, not assumed:

- `Registration` is a genuine ledger. A new row is created on **every** charge — `renewalCron.js`'s `processSingleRenewal()` does `const registration = new Registration({...})` per subscription per `billingMonth`, carrying `amount`, `paymentStatus`, `paymentDetails.stripePaymentIntentId`, and a full `paymentCalculation` breakdown snapshot (`originalAmount`, discounts, `finalAmount`, etc.).
- `Subscription` is current state only — level, schedule, status, `lastChargedMonth` — never itself the payment record.
- A **DB-level partial unique index** on `Registration`: `{subscription: 1, billingMonth: 1}`, `unique: true`, `partialFilterExpression` scoped to active payment statuses (`groupClassRegistrationSchema`, `registration.model.js:312-320`). This is what actually closes the race a plain "check-then-insert" can't: two near-simultaneous charge attempts for the same subscription+month cannot both insert, enforced by MongoDB itself, not application logic.

This is the fourth layer of CKQ's double-charge protection (on top of `lastChargedMonth`, the Registration-existence check, and the Stripe idempotency key — see the "triple dedup" discussion earlier in this thread, which undercounts by one: the DB-level index is a distinct, stronger layer than the application-level existence check).

## A data point already inside this codebase

Frisco already has this exact pattern built correctly — just for a different feature. `backend/src/models/privateClassCharge.model.js` (the per-session private-lesson charge ledger) has `amount`, `status`, `stripePaymentIntentId`, and a partial unique index on `sessionId` whose own comment reads:

> "CKQ's Layer-1 dedup: a session may have at most one non-failed charge at a time..."

So this isn't unfamiliar territory for this codebase — it was consciously ported from CKQ for private lessons, and simply never applied when group-class `Registration`/`Subscription` was originally built.

## The gap, stated plainly

1. **No historical ledger** — no way to answer "what did we charge this family in June" beyond whatever the current `lastChargeAmount` snapshot happens to hold today.
2. **No Stripe PaymentIntent traceability** — a charge can't be looked up by its Stripe id from either model.
3. **No DB-level double-charge protection** — `create()`'s `existingSubscription = Subscription.findOne(...)` check-then-`create()` has a TOCTOU race under concurrent requests (double-click, a retried request racing the original). The Stripe idempotency key likely prevents a literal double-*charge* in that instant (both requests would compute the same key), but the race can still produce **two active `Subscription` documents from one real charge** — and each one independently rolls forward and gets billed on its own future renewal, which is a real double-charge, just deferred to next month.

## Candidate direction (not decided — for the reviewing model to weigh in on)

Bring `Registration` in line with both CKQ and Frisco's own `PrivateClassCharge` precedent:

- `Registration` becomes a per-charge ledger row: `subscriptionId`, `studentId`, `scheduleId`, `amount`, `status`, `stripePaymentIntentId`, `siblingDiscountApplied`/`siblingDiscountAmount`, `registrationFeeCharged`, `prorated`, `periodStart`/`periodEnd`, created on the initial charge **and** on every `renewOne()` renewal (currently creates none).
- Partial unique index on `Registration`, scoped to active statuses, on `{subscriptionId, periodStart}` (Frisco's rolling-anchor equivalent of CKQ's `{subscription, billingMonth}`) — closes the concurrent-registration race at the DB level.
- `Subscription` stays exactly what it already mostly is: current enrollment/billing state, not history. `lastChargeAmount` etc. could arguably be dropped once the ledger exists (the ledger's most recent row *is* "last charge"), but that's a separate call.

## Related open items from this session (not part of this doc's scope, noted so they aren't lost)

- End-of-month proration edge case: `computeProration()` can compute a $0 prorated amount (when a level's remaining class-days this month is 0), which Stripe rejects with a raw 500. Discussed plan: cap the register wizard's date picker to the current calendar month, fall back to "start next month, full price, no proration" when none remain. Not yet built. **Checked against `docs/plans/timezone-consistency-plan.md` (2026-08-28):** confirmed via `git stash` that this reproduces identically on code with none of that plan's changes applied — root cause is genuinely the $0-remaining-class-days condition described above, not a timezone bug. Still not yet built.
- `registration.service.js`'s `create()` calls `addStudentToRoster(schedule, studentId, todayAtMidnight())` — hardcoded to literal *today* rather than the chosen `anchorDate`. A parent registering for a future start (later this month, or next month once that flow exists) currently still gets `Visit` records scheduled for any sessions between today and their real start date. Should become `addStudentToRoster(schedule, studentId, anchorDate)`. Not yet fixed — `todayAtMidnight()`'s *own* value is now timezone-correct (`docs/plans/timezone-consistency-plan.md` D3), but that's orthogonal to this item: the bug here is which value it's called with, not whether that value is computed correctly.

## References

- `backend/src/models/registration.model.js`, `backend/src/models/subscription.model.js` — Frisco, current state
- `backend/src/models/privateClassCharge.model.js` — Frisco's own correct precedent
- `backend/src/services/registration.service.js`, `backend/src/services/renewal.service.js` — Frisco, current charge flow
- `chesskqwebsite/backend/backend-2.0/src/models/registration.model.js` (lines ~296-320), `.../src/cron/renewalCron.js` (lines ~352-530) — CKQ, verified source
- `docs/decisions/001-in-house-subscription-billing.md` — the existing ADR this would need an addendum to, if the candidate direction above is adopted
