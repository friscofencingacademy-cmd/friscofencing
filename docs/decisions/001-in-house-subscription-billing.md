# ADR 001: In-house subscription/billing model over Stripe-native Subscriptions

**Status:** Implemented — 2026-08-06 (Phase 9)

## Context
Group class registration needs recurring monthly billing with a 10% sibling discount (matches CKQ). Two options were considered: Stripe's native Subscription object (Stripe owns billing cycles, invoicing, proration, cancellation), or an in-house `Subscription` model that owns the billing domain and uses Stripe only to charge a saved card.

## Decision
Own the `Subscription`/`Registration` domain model. Stripe is used only for `PaymentMethod` storage and `PaymentIntent` charges — never its Subscriptions API.

Renewal is handled by our own job, with three safeguards against the overcharge-after-cancellation race that affected CKQ's cron-based renewal system:
1. **Charge-time re-verification** — status is checked immediately before charging, never from a snapshot taken earlier in the run.
2. **Atomic conditional update** — the charge-eligibility check and the "mark as charged" write happen in one `findOneAndUpdate` gated on `status: 'active'`, so a cancellation racing the renewal job wins deterministically.
3. **Per-period idempotency key** (`subscriptionId + billingPeriod`) on every Stripe charge, so a retried or rerun job can never double-charge a period even if the application-level guard is bypassed.

Cancellation takes effect at the end of the already-paid period — `cancelAtPeriodEnd` is set immediately, the family keeps access through what they paid for, and the next renewal simply never fires (blocked by the same atomic guard). No refund logic is needed for MVP.

Sibling discount (10%, dynamic lower-payer rule, 2-child case only for MVP) is re-verified at every renewal using the same charge-time-verification principle — it is derived fresh at each billing cycle, never locked in permanently.

## Implementation notes
Built as `renewOne(subscriptionId)` (its own fresh fetch + live re-check, never trusting a value from the caller) called sequentially by `runRenewals()` for each candidate — this is what makes safeguard #1 a directly testable property of one function rather than something only provable by racing real concurrency. Safeguard #2 above is refined slightly from how it first reads: cancellation is two-stage, not a single atomic block. `cancelAtPeriodEnd` is set immediately on cancel, but `status` and roster access are untouched until the renewal job actually reaches that subscription's `nextBillingDate` — at that point it *finalizes* the cancellation (flips `status` to `'cancelled'`, removes the student from the schedule roster and future sessions) instead of charging. No dunning/auto-cancel-after-N-failed-charges — a declined card leaves the period untouched for a natural retry next run; disclosed MVP limitation, not built.

## Consequences
- More code to build and own than adopting Stripe Billing (a renewal job, an idempotency scheme, a `PaymentMethod` model) — accepted trade-off.
- Full portability of the billing domain model if the payment vendor ever changes — only the charge-adapter function needs to change, not the subscription/billing business logic, admin UI, or reporting.
- Structural protection against the specific stale-snapshot race that caused real overcharges in CKQ's cron-based system.
