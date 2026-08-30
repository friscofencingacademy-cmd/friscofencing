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

**Superseded 2026-08-28** by `docs/decisions/006-sibling-discount-family-rule.md` — the rule itself changed (highest payer excluded rather than lowest payer included — equivalent for 2 children, but not for 3+), it now applies immediately at registration even when the newly-registering child is the higher payer (the "bridge" case), and the 2-child-only MVP scoping is lifted. The "re-verified fresh every cycle, never locked in" principle stated here is unchanged and still governs the new rule.

## Implementation notes
Built as `renewOne(subscriptionId)` (its own fresh fetch + live re-check, never trusting a value from the caller) called sequentially by `runRenewals()` for each candidate — this is what makes safeguard #1 a directly testable property of one function rather than something only provable by racing real concurrency. Safeguard #2 above is refined slightly from how it first reads: cancellation is two-stage, not a single atomic block. `cancelAtPeriodEnd` is set immediately on cancel, but `status` and roster access are untouched until the renewal job actually reaches that subscription's `nextBillingDate` — at that point it *finalizes* the cancellation (flips `status` to `'cancelled'`, removes the student from the schedule roster and future sessions) instead of charging. No dunning/auto-cancel-after-N-failed-charges — a declined card leaves the period untouched for a natural retry next run; disclosed MVP limitation, not built.

## Addendum — 2026-08-23: read-only pricing preview

`GET /registrations/preview` (`registration.service.js`'s `previewChargeAmount`) lets the register wizard show the sibling discount to the parent *before* they commit to paying, not just after — reuses `calculateChargeAmount()` verbatim, never a separate/approximate calculation, so the preview can't structurally disagree with what the real charge computes. No new decision here — same "backend is the source of truth for discount amounts" principle this ADR already establishes, just a second read path onto it. Never requires a saved payment method (that's the point) and skips the `existingSubscription`/capacity checks `create()` enforces (a pricing estimate doesn't need them; the real `POST` still enforces both regardless of what a preview showed).

## Addendum — 2026-08-26: live current-charge display + one-time registration fee

**Live current-charge display.** `GET /registrations/mine` now enriches every active subscription with a `currentCharge` snapshot, computed fresh via `calculateChargeAmount()` on every read — the same function the real charge and the preview use, called an additional time for display purposes. This is distinct from `lastChargeAmount`/`lastSiblingDiscountApplied`, which remain exactly what they always were: a record of what happened at that subscription's own last charge, never retroactively corrected. The gap this closes: previously, if a family's sibling-discount eligibility changed because a second child registered, the already-active (and now newly-eligible) sibling's subscription showed no visible sign of it until their own next renewal — looking indistinguishable from a bug. `currentCharge` is display-only and never written back to the `Subscription` document; the actual charge is still computed independently, live, at actual renewal time. No refund logic was added or considered acceptable here — an already-completed charge is never adjusted, only what's *displayed* about the current state changed.

**One-time registration fee**, admin-configurable (`Setting.registrationFee`, superadmin-only), bundled into the same `PaymentIntent` as a registration's first monthly charge — never a second charge, never discounted by the sibling rule. Includes an optional returning-student waiver (`Setting.returningStudentGracePeriodMonths`): a student whose most recent prior `Subscription` ended (per `currentPeriodEnd`) within that many months of `now` pays no fee on re-registration. See `DATABASE_SCHEMA_DOCUMENTATION.md`'s `Setting` section for the full field/model detail. No caching, consistent with this ADR's "re-verified every time" principle — a `Setting` read is cheap and only happens at registration time, so there's no performance case for deviating from that.

## Addendum — 2026-08-26 (2): prorated first-month billing

Full plan: `docs/plans/prorated-first-month-billing-plan.md`. Admin-gated (`Setting.prorationEnabled`,
default `false` — no live charge changes until an owner deliberately turns it on).

**What changes.** A student's first charge is prorated to the class days remaining, this calendar
month, at their level — not a rolling month. `backend/src/services/billing/proration.service.js`'s
`computeProration()` is the single function this math ever runs in; `create()` and
`previewChargeAmount()` are its only two callers, so a preview can never structurally disagree with
the real charge, same guarantee every other billing preview in this codebase already has. The
frontend never reimplements this math — it only displays what the backend returned.

**Sequencing, owner-directed and worth stating precisely because it isn't the only defensible
order:** proration runs on the *raw* list price first; that *result* is what feeds into
`calculateChargeAmount()` — completely unmodified by this change. Sibling-discount eligibility
therefore compares "what this student actually owes this cycle" (their prorated amount, if
prorated) against a sibling's own current standard rate — not the raw, unprorated list price. The
one-time registration fee is unaffected by any of this: flat, unprorated, undiscounted, always added
last, exactly as it was before this addendum.

**Period model, for a prorated first charge only.** `currentPeriodEnd` becomes the end of the
registration's calendar month instead of `addOneMonth(now)` — a genuinely short first period,
matching the smaller charge, because access to a physical space shouldn't outlast what was paid for.
Every subsequent renewal is `renewal.service.js`, **completely unchanged** — a full calendar month
at full price. When `prorationEnabled` is `false` (the shipped default), `create()` and
`previewChargeAmount()` are byte-identical to their pre-proration behavior.

**Deliberately out of scope**, see the plan doc's own "explicitly out of scope" section for the full
list: no holiday/closure exclusion (Frisco has no `Holiday` model), no migration of any already-
active subscription's rolling period to a calendar-anchored one, no change to the renewal cron's
cadence (renewals will cluster around the 1st of the month once this is live at real volume — a
noted future operational consideration, not addressed by code here).

## Addendum — 2026-08-28: timezone-correct "today" for the renewal gate and registration anchor

Full plan: `docs/plans/timezone-consistency-plan.md`. Before this, `renewOne()`'s
`nextBillingDate <= today` gate (safeguard #1 above) resolved "today" via the server process's
raw local `Date`, which is UTC in production (no `TZ` env var configured) — not Central, where
Frisco's business actually happens. This meant the gate genuinely disagreed with the intended
Central calendar day for roughly 5-6 hours every day, not a rare edge case. `todayAtMidnight()`
now resolves via real IANA timezone math (`moment-timezone`, `DEFAULT_TIMEZONE = 'America/Chicago'`
in `config/timezone.js`) — the same class of fix CKQ's own `dateUtils.js` shipped after hitting
this bug four separate times. `registration.service.js`'s `anchorDate` (an immediate
registration's implicit start date) gets the same correction via a new `todayDateOnly()` — a
distinct primitive from `todayAtMidnight()` because `anchorDate` is a date-only value (matching
`GroupClassSession.date`'s storage convention), not a real instant; conflating the two would have
reintroduced a different bug (see the plan's D9/D10 for the full reasoning, including one
correction made mid-implementation after the first draft of the fix got that distinction wrong).
No change to the three safeguards themselves, or to any other business rule — this addendum is
about resolving "today" correctly, not about what happens once it's resolved.

## Addendum — 2026-08-28 (2): payment ledger, create-pending-first sequencing, and dunning

Full plan: `docs/plans/registration-ledger-plan.md` (PR 1 merged 2026-08-27; PR 2 and PR 3 both
merged 2026-08-28). This is the fourth safeguard layer this ADR's original three didn't yet have —
CKQ's own durable renewal dedup, ported here as a real `Registration` ledger rather than the
3-field enrollment-status doc `Registration` used to be.

**The ledger, and why sequencing matters.** Every charge — initial registration, renewal, retry —
is one immutable row in the unified `Registration` ledger
(`docs/plans/service-registry-unified-ledger-plan.md`), on the `SubscriptionCycleRegistration`
discriminator for group classes. A renewal/retry charge creates its ledger row `pending`
**before** Stripe is ever charged, not after — the DB-level partial unique index on
`{subscriptionId, periodStart}` (scoped to `pending`/`completed`, `failed` excluded so a retry is
never blocked by its own prior failure) is what turns "two racing renewal-job runs for the same
subscription" into a guaranteed single charge: the loser's insert fails with `E11000` before it
ever reaches Stripe, not after. This is genuinely a fourth, independent layer — it survives even
if the application-level checks (safeguards #1/#2 above) were ever bypassed or buggy, the same way
the per-period idempotency key (#3) already does for Stripe's own side.

**Stale-pending recovery.** A `pending` row with no resolution (the process died between insert
and the Stripe response) is not itself a bug — it's recovered on the next run by searching Stripe
for a PaymentIntent carrying the row's own id in `metadata.registrationId` before ever charging
again: found-and-succeeded is adopted with no new charge; nothing found is re-driven under the
same idempotency key. This ports the fix for a real incident CKQ hit in production (2026-07-01) —
a died process leaving a family stranded, permanently unchargeable, because a new attempt was
blocked by the very dedup guard meant to prevent double-charging. The lesson generalized: a
dedup guard needs a recovery path, not just a block.

**Dunning policy — adopted, replacing the pre-ledger "retry forever, silently, at a
re-calculated price."** A failed charge enters `retryCount`/`nextRetryAt` state instead. Retry
cadence is daily, fixed (not exponential) — Day 0 fails, Day 1/2/3 retry, Day 3's failure cancels
the subscription. Every retry charges the **locked** amount from the original failed row, never a
live recalculation — a price change mid-dunning cannot silently change what the parent is charged
after being emailed a specific amount. `MAX_PAYMENT_RETRIES = 3` (`config/billing.js`, matching
CKQ's own `config/payment.js` value). Parents now get a failure email on every attempt (Day 0
through the final cancellation notice) — previously, none was sent at all.

**Cancel-after-exhaustion — the CKQ zombie-loop fix, ported verbatim.** Exhausting retries cancels
the subscription with `$unset: { nextRetryAt: '' }`, never a plain `null`/`undefined` write —
Mongoose silently strips an `undefined` value from an update, which would leave the OLD
(still-due) `nextRetryAt` in place on an otherwise-cancelled subscription. Combined with the retry
candidate query's own `status: 'active'` filter, this is two independent layers keeping a
cancelled subscription from ever being picked up again, not one.

## Addendum — 2026-08-29: display-only `savings` breakdown (Family Scorecard checkout quote panel)

Full plan: `docs/plans/wordpress-ui-alignment-plan.md`, Phase 3. `previewChargeAmount()` and
`create()` both now return a `savings: { siblingDiscount, registrationFeeWaived, total }` object —
the same "backend is the source of truth" principle every other addendum here already establishes,
applied to one more number the frontend needed and previously couldn't derive on its own:
`registrationFeeWaived`'s *dollar value*. Before this, `registrationFeeCharged` was `0` both when a
fee was waived AND when no fee was configured at all — indistinguishable from the response alone,
so a "you saved $25 on the registration fee" line was impossible to show without either the
frontend doing its own `Setting` lookup (a second, un-synchronized read of the same fee this ADR
already governs) or the backend exposing it. `resolveRegistrationFee()` (`registrationFee.service
.js`) gained a fourth return field, `standardAmount` — the configured fee before any waiver, `0`
when none is configured — computed in the same pass, from the same `Setting` read, as `amount`/
`waived`/`reason` always were; no new query. `savings` itself is assembled in `registration.service
.js` from fields both functions already had in scope (`siblingDiscountAmount`, the waived fee's
`standardAmount`) — display-only, never touches `chargeAmount`/`totalChargeAmount` or what Stripe
is actually asked to charge. The frontend (`OrderSummary`'s "Family Scorecard" quote panel) does
formatting (`.toFixed(2)`) only, per this ADR's standing rule.

## Addendum — 2026-08-30: scheduled renewal runs paused; superadmin manual Charge button

Full plan: `docs/plans/manual-charge-and-pdf-invoice-plan.md` PR 1. Owner decision: for now, renewals
are not run on any schedule (`npm run renewals` was never actually wired to a scheduler in the first
place — this addendum documents the decision to keep it that way for the time being, not a code
change to disable anything). In its place, a superadmin-only **Charge** button on
`/admin/subscriptions` (`docs/features/admin.md`) processes one subscription at a time, showing the
exact amount and card-on-file status before confirming.

The button adds zero new charge logic: `renewal.service.js`'s new `chargeNow(subscriptionId)` is a
3-line router onto the SAME `renewOne`/`retryOne` this ADR's safeguards already govern (routed by
`retryCount > 0`, the same signal `runRenewals`/`runRetries` split their two phases on) — every
guard above (charge-time re-verification, the atomic conditional update, the per-period idempotency
key, the payment-ledger dedup index, stale-pending recovery, dunning) applies completely unchanged.
A new read-only `previewRenewal(subscriptionId)` computes the exact amount via the same
`resolveMonthlyFee`/`calculateChargeAmount` pair `renewOne` itself calls (the standing "a preview can
never structurally disagree with the real charge" rule, this ADR's 2026-08-23 addendum), including
returning the LOCKED amount from the latest failed ledger row when the subscription is in dunning —
never a live recalculation.

One operational consequence worth stating: `renewOne` also finalizes a due, pending-cancel
subscription (flips `status` to `cancelled`, removes the roster) instead of charging. With no
scheduled run, that finalization now only happens when a superadmin clicks Charge on that row — the
dialog states this explicitly ("this will finalize the cancellation — nothing is charged") rather
than hiding the button, so the path still exists.

`npm run renewals` itself is untouched and remains safe to run at any time — same functions, same
guards, same idempotency; nothing about this addendum makes running it dangerous or redundant with
manual charges (Guard B's ledger dedup means a manual charge and a later `npm run renewals` run can
never double-charge the same period either way).

## Consequences
- More code to build and own than adopting Stripe Billing (a renewal job, an idempotency scheme, a `PaymentMethod` model) — accepted trade-off.
- Full portability of the billing domain model if the payment vendor ever changes — only the charge-adapter function needs to change, not the subscription/billing business logic, admin UI, or reporting.
- Structural protection against the specific stale-snapshot race that caused real overcharges in CKQ's cron-based system.
