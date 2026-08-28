# ADR 006: Sibling discount is a family discount — highest payer excluded, applied immediately

**Status:** Proposed — 2026-08-28 (owner-decided in conversation; supersedes the "dynamic lower-payer, 2-child only" rule in ADR 001; implementation lands with the sibling-discount hardening plan)

## Context

The MVP rule (ADR 001) was: among two siblings, the lower-fee child gets 10% off — 2-child case only, one winner. CKQ's equivalent decision ([CKQ ADR backend-002](../../../chesskqwebsite/docs/decisions/backend-002-sibling-discount-highest-payer.md), local checkout) frames it the other way: **the highest payer pays full price, all other children get 10% off** — which is also the rule the owner confirmed for Frisco: "If there are 3 kids, we will give sibling discount to 2 kids. It always does not give discount to top paying student, rest will get 10% off."

The 2026-08-28 analysis of the current implementation (`calculateChargeAmount.service.js`) found the "hunt for the one winner" shape is also what produced its two real bugs: nondeterministic sibling-subscription selection (F1) and possible double-discount with 3+ equal-fee siblings (F2). A separate owner-flagged fairness gap: when the *newly registering* child is the higher payer, the family saw no discount until the existing child's next renewal.

## Decision

### The rule
Among a family's active children (same `parentId`, each holding at most one active subscription per ADR 005), resolved with **live** fees every time (schedule → class → level → `Price`, never cached, never read from stored fields — unchanged principle from ADR 001):

- The child with the **highest current fee pays full price**. Every other active child gets **10% off their own fee**.
- **Tiebreak** for equal highest fees: the child enrolled first (earliest subscription `createdAt`) pays full price — deterministic and auditable, adopted verbatim from CKQ ADR backend-002. (Replaces the current `studentId` string comparison.)

### Immediate application at registration — including when the new child is the top payer
Owner-decided: "the discount is for the family — apply it to whatever charge is happening right now." At registration, if the student has any active sibling, the bill always gets a discount of:

> **10% × min(registering child's charge-now fee, the current top payer's fee)**

- New child is a lower payer (including a prorated first charge): this reduces to 10% of their own charge — identical to existing behavior. "Always apply for the lower amount, whether it is prorated fee or lower monthly fee" (owner).
- New child is the new top payer: 10% of the sibling's (previously top) fee comes off *this* bill — the family's discount starts the moment the family qualifies, instead of waiting for the sibling's next renewal. The receipt/portal `reason` string states the discount came from the lower-priced plan's rate.
- N-child form: `min(newFee, previousTopFee)` is exactly the marginal discount the new child's arrival creates for the family, for any N.

This deliberately diverges from CKQ, whose ADR states "new sibling enrollments never retroactively change an existing sibling's rate mid-month — existing subscriptions realign at next renewal." Frisco keeps the no-retroactivity half (money already collected is never touched — no refunds/credits) but does not make the family wait: the immediate discount rides the charge that is happening anyway.

### What is stored (audit only, never input)
Unchanged principle: eligibility is re-derived live at every charge; nothing stores "who the discounted child is." Each charge's ledger row records `siblingDiscountApplied` + `siblingDiscountAmount` + the human-readable `reason`; the subscription keeps `lastSiblingDiscountApplied`/`lastChargeAmount` as display-only records. **No suppression state is needed**: the registration-time family discount exists only inside `create()` (fires once per registration), and renewals run the pure top-payer-excluded rule — a top payer's renewal never gets a discount, so nothing can double-fire.

### Hardening folded into the same implementation
- **Pending-cancel cutoff (F3):** a sibling subscription with `cancelAtPeriodEnd: true` whose `currentPeriodEnd` has passed no longer counts as active for the discount — removes order-dependence between same-day cancel-finalization and renewals, and the phantom window a cron outage would extend.
- **Cents rounding (F4):** discount math rounds once at the final amount (`Math.round(x*100)/100`), matching `proration.service.js`'s established discipline, so the ledger can never disagree with the cents Stripe charged.

## Consequences

- F1 and F2 disappear structurally — there is no "pick the winner" comparison left to get wrong.
- Idempotency is preserved: the function stays a pure read applied to fresh base fees; retries/dunning charge the amount locked into the pending ledger row (ADR 001 D6), never recomputing.
- **Accepted overlap:** in a transition month, the family can receive slightly more than one month's 10% (e.g. new child's discounted prorated charge + the existing child's discounted anniversary renewal later that same month — the analysis's F5). Bounded at 10% of one fee, happens at most once per family formation, errs in the family's favor, and only arises at all under proration and/or non-aligned renewal dates. Documented as accepted rather than "fixed" by delaying the discount — delaying is exactly what the owner rejected.
- ADR 001's sibling-discount paragraph and CLAUDE.md's "2-child case only" scope line are superseded by this rule.

## Alternatives considered

- **Wait-for-next-renewal when the new child is the top payer** (CKQ's behavior) — rejected by owner as unfair: "If someone registers on the 2nd and his sibling registers on the 3rd, it is unfair to say they won't get discount until the next month."
- **Mid-cycle credit/refund of the existing child's already-paid month** — rejected; money already collected is never adjusted (consistent with ADR 001's no-refund stance), and it would require a refund mechanism the platform deliberately doesn't have.
- **Stored "discount processed" suppression flag** — rejected; cross-subscription stored state is exactly what the live-derivation design avoids, and the pure recurring rule makes it unnecessary. The "mark" the owner asked for is satisfied by the existing per-charge ledger audit fields plus a distinct `reason` string.
