# ADR 007: Calendar-month billing — all renewals on the 1st (CKQ model)

**Status:** Implemented — 2026-08-28 (PR 1 of `docs/plans/billing-anchor-and-sibling-discount-plan.md`, merged to `develop` via PR #50). PR 2 (ADR 005) and PR 3 (ADR 006) not yet started.

**2026-08-30 addendum — proration scoped to the current month
(`docs/plans/payment-airtight-plan.md` D1):** this ADR's original text below
("the prorated-first-month path becomes the *only* path") was refined after a
real incident. `computeProration()` was being called unconditionally for
ANY registration anchor date, including one the parent explicitly picked in
a FUTURE calendar month (the wizard's "Enroll for next month" action) — so a
next-month anchor that didn't happen to land exactly on that month's first
class day was silently charged a fraction of the month (e.g. 275 × 16/17 =
258.82 instead of 275). The rule is now explicit: proration applies **only**
when the chosen start date falls in the CURRENT calendar month; any
FUTURE-month anchor is billed the full monthly fee for that entire calendar
month, unconditionally, regardless of which day within that month is chosen.
Both branches still anchor their period to the calendar-month boundary this
ADR establishes — this only changes whether the FIRST month's amount is a
fraction or the full fee, never the period math itself. Single source of
truth: `billing/proration.service.js`'s `resolveFirstChargePeriod()`, called
identically by `registration.service.js`'s `create()` and
`previewChargeAmount()`.

## Context

**The intended model** (owner, 2026-08-28): "Our renewal is supposed to be going 1st of each month — that is the chesskq model." CKQ's payment module doc states it directly: *"we collect the first month's payment immediately and then automatically renew on the 1st of each month"*, and CKQ's `renewalCron.js` targets `startOf('month')` in Central time. CKQ additionally forces schedule start dates to the 1st at validation, sidestepping most proration.

**What Frisco actually implements today** (verified against source 2026-08-28):

- `registration.service.js` sets the first period to `anchorDate → addOneMonth(anchorDate)` — a **rolling month from the registration date**.
- `renewal.service.js` advances each period as `newPeriodStart = currentPeriodEnd`, `newPeriodEnd = addOneMonth(newPeriodStart)` — pure **anniversary billing**. A child registered January 17th renews on the 17th of every month, forever.
- The only exception: a subscription whose first month was prorated (`Setting.prorationEnabled`, ADR 001 addendum 2026-08-26(2)) gets a first period ending at calendar-month end, after which its renewals land on the 1st. But `prorationEnabled` defaults **false** and is off everywhere, so every subscription created to date is anniversary-billed.

So the calendar-month model exists in the codebase only as the proration feature's side effect, gated behind a flag that is off. That is the mix-up: the pieces were built, but the live default produces a different billing model than the intended CKQ one.

**Renewal cron status, for the record:** the renewal *engine* is fully built and merged — `renewal.service.js` + the two-phase `scripts/run-renewals.js` (renewals then retries/dunning), registration-ledger PRs #37/#46/#48. What is NOT built is the *scheduler*: `npm run renewals` is manual, listed as a pending follow-up in `docs/plans/deployment-launch-plan.md` ("Renewals scheduling … Options: Vercel Cron …"). The engine itself is date-driven off each subscription's `nextBillingDate`, so it does not care which model those dates follow — fixing the anchor is a registration/renewal date-math change, not a cron rewrite.

## Decision

**All group-class subscriptions bill on the calendar month: the first (partial) month is charged at registration, and every renewal happens on the 1st of the month** (Central time, per the timezone-consistency plan's `DEFAULT_TIMEZONE`).

Intended mechanism (to be detailed in the implementation plan, not yet built):

1. Registration charges the first month immediately, with the period ending at calendar-month end — i.e., the prorated-first-month path becomes the *only* path, not an option. Whether that first charge is prorated to remaining class days (the built `computeProration()`) or full-price is an owner pricing choice the plan must confirm; the *period math* is calendar-anchored either way.
2. `nextBillingDate` is always the 1st. The renewal cron (once scheduled) runs on the 1st and processes everyone.
3. Existing anniversary-billed subscriptions (dev/staging data; production has no real payments yet — Stripe env vars are still empty in prod) need a one-time migration to realign `currentPeriodEnd`/`nextBillingDate` to the month boundary. The migration must decide per subscription whether the realignment short-changes or extends the already-paid period, and err in the family's favor.

## Consequences

- **Sibling discount interplay (ADR 006):** with every renewal on the 1st, a mid-month second-child registration always happens *after* the sibling's renewal for that month — the "both discounted in the same month" overlap window (F5) closes on its own for same-month cases, and the family-discount-at-registration rule covers the partial month cleanly.
- Receipts, the parent portal, and admin views all describe periods as calendar months — matching how the owner and families already think about billing.
- Registration on the 1st itself racing the renewal cron is the one residual ordering edge; the implementation plan must state the behavior (the existing per-period idempotency + ledger dedup guards already prevent double charges).

## Alternatives considered

- **Keep anniversary billing** — rejected by owner; the business model (and CKQ precedent, and family expectations) is month-of-service billing.
- **Anchor renewals per family instead of globally on the 1st** — not considered seriously; complicates the cron and every "what month is this charge for" question with no business benefit.
