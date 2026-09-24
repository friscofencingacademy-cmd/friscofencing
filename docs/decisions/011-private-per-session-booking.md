# ADR 011: Private lessons are per-session bookings, paid at purchase

**Status:** Implemented — 2026-09-24 (PR 2 of `docs/plans/private-class-per-session-booking-plan.md`).

## Context

Private lessons were ported from CKQ as a recurring model: a parent claimed one weekly slot, eight weeks of sessions were generated, and each session was charged after the coach marked it attended. Frisco does not sell private lessons that way. A coach opens a block of time ("Tuesdays 5–8 pm, 30-minute slots, October to December"), and a parent books one specific date at a time. Parents can also buy a discounted pack of sessions and book them one by one.

## Decision

**A private lesson is a single booked date, paid for before it is confirmed. A purchase buys credits; a booking spends one.**

1. **`PrivateClassSchedule` is an availability rule**: weekday, start time, length, and a bookable date range. Nobody owns a rule. Coaches publish rules in bulk from a time window. No sessions are generated.
2. **`PrivateClassSession` is the booking.** It is created only when a parent books, and it names the student. Inserting it against a partial unique index on `(scheduleId, startDate)`, restricted to `pending`/`confirmed`, is the whole slot claim. A cancelled or released booking frees the slot and keeps its history.
3. **`PrivateClassEnrollment` is one purchase.** It holds `quantity`, `sessionsUsed`, and the pinned rate, lesson length, and discount. Remaining credits are derived. A credit books only a slot of the same coach and length.
4. **`Registration` stays the only money ledger.** A purchase is one `per_session` row with `quantity`, `unitPrice`, `discountPercent`, and `amount`. It is anchored to the booking that came with it (`sessionId`) and to the purchase (`enrollmentId`). The existing one-non-failed-charge-per-`sessionId` index remains the money dedup. A booking paid with a credit writes no row.
5. **Purchase order, reserve before charging (ADR 008's lesson):** validate, create the purchase `pending`, claim the slot with a `pending` booking, create the `pending` ledger row, charge through `chargeLedgerRow` (the one Stripe charge path, idempotency-keyed on the row), then activate or release. A decline releases the slot immediately and returns 402. An unexpected Stripe error leaves everything `pending`, so a slot is never released while money may have moved.
6. **Booking with a credit:** one atomic guarded `$inc` on the oldest usable purchase, then the slot claim. A lost claim gives the credit back.
7. **Attendance moves no money.** It is a `Visit` ([ADR 010](./010-universal-visit-ledger.md)).
8. **Cancellation returns the credit, never money.** Parents may cancel online until 24 hours before a lesson; coaches and admins until it starts. A missed lesson uses its credit.
9. **Pack pricing** is academy-wide data (`Setting.privateClassPackages`). Every pack rule and price formula lives in `utils/privateClassPricing.js`. A single session is always offered.
10. **Abandoned holds self-heal.** A `pending` booking older than 15 minutes with no pending or completed charge is released by the next attempt on that slot. This project has no scheduler.

## Consequences

- The attendance-triggered charge, its retry button, the cancel-then-charge race guard, the payment-failed email, the 8-week generator, and `extend-private-sessions.js` are all gone.
- ADR 001's no-refund rule is unchanged and now covers private lessons explicitly: a cancellation returns a credit, never money. ADR 001 carries a pointer addendum.
- Paid credits are honored even after a coach's contract is deactivated. A new purchase needs an active contract.
- The legacy import can no longer create a private enrollment, because an enrollment is paid credit. It warns instead.
- Cutover: `scripts/retire-recurring-private-classes.js` deletes the old model and swaps the slot index to the partial one. It refuses to run if the old model ever moved money. It must run before deploy. Mongoose auto-indexing cannot replace a same-named index. It only logs the conflict, and the old non-partial index would block every cancelled slot. `scripts/check-private-credit-ledger.js` reports that condition and every purchase that disagrees with the ledger.

## Alternatives considered

- **Keep charging after attendance, per session.** One payment timing for singles and a different one for packs means two money paths. Prepaid packs are the owner's requirement anyway.
- **Attendance on the session.** Rejected in ADR 010.
- **Bookings as Visits.** Visit has no unique index by design, so a cancelled visit can be reinstated. It cannot be the atomic slot claim, and it would pull payment state into the attendance ledger.
- **One accumulating enrollment per student and coach.** The pinned price could not stay immutable across purchases, and the enrollment and its ledger rows would no longer pair one to one.
