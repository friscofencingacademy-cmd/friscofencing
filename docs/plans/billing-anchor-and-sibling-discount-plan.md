# Implementation plan: Calendar-month billing + one-sub-per-student guard + family sibling discount

**Status:** SHIPPED — all 3 PRs merged to `develop` (PR #50, #51, #52). See each PR's completion notes below for what actually shipped vs. this original design.
**Builder:** Sonnet session, following §8 builder instructions exactly.
**Executes:** [ADR 005](../decisions/005-one-active-subscription-per-student.md) · [ADR 006](../decisions/006-sibling-discount-family-rule.md) · [ADR 007](../decisions/007-calendar-month-billing.md) · [ADR 008](../decisions/008-registration-create-pending-first.md) (found mid-PR-2, not in the original plan)

Three PRs, in this order, each independently shippable to `develop`:

| PR | Delivers | ADR |
|---|---|---|
| PR 1 | Calendar-month billing anchor (all periods end on the 1st) + realignment migration | 007 |
| PR 2 | One active group-class subscription per student (index + app check + pre-flight diagnostic) | 005 |
| PR 3 | Sibling discount rewrite: top-payer-excluded family rule, immediate at registration, F3/F4 | 006 |

Order matters: PR 3's tests assume calendar-aligned periods (PR 1) and at-most-one-active-sub-per-student (PR 2). Do not reorder.

---

## 0. Owner sign-off items (defaults adopted; owner may override before build)

1. **First-charge pricing under calendar anchoring (PR 1):** the first charge is ALWAYS prorated via the existing `computeProration()` (remaining class days this calendar month). `Setting.prorationEnabled` is retired — the gate made sense when proration was optional behavior on top of rolling months; under ADR 007 a full-month charge for a partial calendar month would be an overcharge. Owner's own framing assumed proration exists ("whether it is prorated fee or lower monthly fee").
2. **Migration direction (PR 1):** realignment always EXTENDS an existing subscription's paid period to the next month boundary (family gets free days), never shortens. Per ADR 007 "err in the family's favor."
3. **Renewal cron scheduling (Vercel Cron etc.) stays OUT OF SCOPE** — it remains the deployment-plan follow-up. This plan only guarantees that when the scheduler is wired, running on the 1st processes everyone.

---

## 1. Current state (verified against source 2026-08-28 — builder must re-verify at build time)

- `registration.service.js` `create()`: period = `anchorDate → addOneMonth(anchorDate)` (rolling month; `:259`), except prorated first periods which already end at calendar-month end. `prorationEnabled` read at `:185`.
- `renewal.service.js`: `newPeriodStart = subscription.currentPeriodEnd` (`:373`), `newPeriodEnd = addOneMonth(newPeriodStart)` (`:444`) — anniversary math that becomes calendar math automatically once every anchor is a month boundary. **No renewal date-math change is expected in PR 1**; verify, don't assume.
- Guard A (`subscription.model.js:136`): unique partial `{studentId, scheduleId}` on `status:'active'`.
- `calculateChargeAmount.service.js`: lowest-payer-wins 2-child rule, `findOne` per sibling (nondeterministic under multi-sub), `studentId` tiebreak, no rounding, no pending-cancel cutoff.
- Callers of `calculateChargeAmount()`: `registration.service.js:206` (create), `:429` (preview), `:494` (portal `currentCharge`), `renewal.service.js:433` (renewOne). Receipt email recomputes discount as `monthlyFee * 0.1` at `renewal.service.js:96`.
- Ledger audit fields already exist: `Registration.siblingDiscountApplied/siblingDiscountAmount` (`registration.model.js:130-131`), `Subscription.lastSiblingDiscountApplied/lastChargeAmount`.

---

## 2. Design decisions

### D1 — Calendar-month period math (PR 1)

New helper `firstOfNextMonth(date)` in `backend/src/utils/billingDates.js`, tz-aware via `config/timezone.js`'s `DEFAULT_TIMEZONE` (same discipline as `todayDateOnly`/`addOneMonth` after the timezone-consistency plan): returns the 1st of the month strictly after `date`, as a date-only UTC-midnight-sentinel value (the repo's established date-only convention).

In `create()`:
- `currentPeriodEnd = firstOfNextMonth(anchorDate)` — unconditionally. Registration ON the 1st yields a full month ending the next 1st.
- `nextBillingDate = currentPeriodEnd` (unchanged pattern).
- Proration always runs: `feeForDiscountCalc = computeProration(...).proratedAmount`, and the `prorationEnabled` branch is removed. **Builder must verify** `computeProration()`'s `periodEnd` equals `firstOfNextMonth(anchorDate)` under the same date convention — if it returns "last day of month" or a different sentinel shape, normalize to `firstOfNextMonth` as the single source of period math and keep `computeProration` responsible only for the amount. Registration on a date whose month has no remaining class days: keep whatever `computeProration` does today (verify + preserve; document in the PR notes).
- `firstChargeProrated` stays as the audit field, now set from whether the prorated amount differed from the full fee.

`Setting.prorationEnabled` retirement: remove from `setting.service.js` defaults/validation and any admin UI surface; `previewChargeAmount()` loses its gate the same way `create()` does. Leave existing stored Setting docs untouched (the field is simply no longer read); note it as deprecated in `DATABASE_SCHEMA_DOCUMENTATION.md`.

### D2 — Realignment migration (PR 1)

New script `backend/scripts/realign-billing-anchors.js`, modeled on the repo's existing script conventions (dry-run by default, `--apply` to write; read-only diagnostic output listing every change):

For every `Subscription` with `status: 'active'` where `currentPeriodEnd` is not a month boundary:
- `currentPeriodEnd → firstOfNextMonth(currentPeriodEnd)` (extend, never shorten — sign-off item 2)
- `nextBillingDate → same new value`
- Print old/new per subscription. No ledger rows are touched (no money moved).

Cancelled subs untouched. Prod has no real payments yet, but run the same script there for consistency once PR 1 deploys.

### D3 — One-active-subscription guard, via create-pending-first registration (PR 2)

Full design: [ADR 005](../decisions/005-one-active-subscription-per-student.md) (the guard itself) + [ADR 008](../decisions/008-registration-create-pending-first.md) (the create-pending-first sequencing this guard turned out to require). Found mid-plan, not in the original PR 2 scope: tightening Guard A to "one active subscription per student, any schedule" exposes a real cross-schedule double-charge race under the OLD charge-first `create()` (two different schedules ⇒ two different Stripe idempotency keys ⇒ both can charge for real before Guard A rejects the loser's `Subscription.create()`). Closing it properly means reordering `create()` to reserve first, not just widening the guard's query — see ADR 008 for the full reasoning and rejected alternatives (refund-on-conflict, narrower idempotency key, accept-the-race).

**D3a — The guard itself:**
- `subscription.model.js`: Guard A index becomes `{ studentId: 1 }`, `unique: true`, `partialFilterExpression: { status: 'active' }`. Comments updated. **Already built** (this session, before the race was found).
- **Pre-flight diagnostic** `backend/scripts/find-duplicate-active-subscriptions.js` (read-only, same pattern as `find-orphaned-references.js`): list students with 2+ active subscriptions. Run against staging before merge — the index creation fails on Mongo if violations exist.
- The old `{studentId, scheduleId}` index isn't automatically dropped by Mongoose on deploy (it just coexists with the new one — harmless but redundant, since the new index is strictly tighter). `backend/scripts/drop-old-subscription-index.js` (+ `scripts/lib/dropOldSubscriptionIndex.js`), same dry-run/`--live` convention as `realign-billing-anchors.js`, drops the old compound index by name (`studentId_1_scheduleId_1`) once confirmed obsolete.

**D3b — Shared charge-finalization module** (`backend/src/services/billing/chargeFinalization.service.js`, new file): extracts `advanceSubscriptionPeriod`, `chargeLedgerRow` (the Stripe call + outcome classification), `finalizeSuccessfulCharge`, and `finalizeFailedCharge` out of `renewal.service.js`, **stripped of email-sending** — those four functions become pure "charge Stripe, update the ledger row, update the Subscription" mechanics with no side effects beyond that. A new `chargeAndFinalize({ row, subscription, paymentMethod, stripeCustomerId, siblingDiscountApplied, attemptNumber })` orchestrates all three (charge → finalize-success or finalize-failure) and returns a result (`{ outcome: 'charged' | 'failed_payment', ... }`) for the CALLER to act on — specifically, to decide which email to send and (for `create()` only) whether to grant roster access. This split exists because a renewal's success email (`sendRenewalReceiptEmail`) and an initial registration's success email (`sendRegistrationConfirmationEmail`, richer — level/location/coach/proration) are genuinely different templates with different data, and only `create()` ever grants roster access — those differences don't belong inside shared "charge the card" logic.

`renewal.service.js`'s three call sites (`renewOne`'s fresh charge, `retryOne`, `recoverStalePending`'s both branches) update to call `chargeAndFinalize`/the shared `finalizeSuccessfulCharge` and then explicitly call their existing `sendReceiptEmail`/`sendFailureEmail` wrappers (unchanged content) with the result — mechanical, no behavior change, verified by the full existing renewal/retry test suite staying green.

**D3c — `registration.service.js`'s `create()` reordered:**
1. Validate (student/schedule/groupClass/service/payment method) + compute `chargeAmount`/discount/proration/`totalChargeAmount` — all unchanged, all before any write.
2. **NEW:** `Subscription.create({ status: 'active', currentPeriodStart: anchorDate, currentPeriodEnd, nextBillingDate: currentPeriodEnd, isPremium, registrationFeeCharged, firstChargeProrated, lastChargeAmount: null, lastSiblingDiscountApplied: false, retryCount: 0 })` — BEFORE Stripe. Guard A fires here; a duplicate (any schedule) never reaches Stripe. `error.code === 11000` → 409 `'This student already has an active class registration'` (same message as the pre-check, now genuinely the backstop, not just defense-in-depth).
3. Create the ledger row, `status: 'pending'`, `eventType: 'initial'`, `amount: totalChargeAmount`, full `breakdown` — same shape `renewOne()` already creates for a renewal's pending row.
4. `chargeAndFinalize({ row, subscription, paymentMethod, stripeCustomerId, siblingDiscountApplied, attemptNumber: 1 })`.
5. **`outcome: 'charged'`** → `addStudentToRoster(...)`, send `sendRegistrationConfirmationEmail(...)` (unchanged content), return `201` with `paymentStatus: 'completed'`.
6. **`outcome: 'failed_payment'`** → no roster access, send `sendPaymentFailureEmail(...)` (the existing generic template — copy review for an initial-vs-renewal-specific tone is a documented follow-up, not silently dropped), return `201` with `paymentStatus: 'pending'` (the registration was *accepted*; the charge is retrying) and enough detail (`retryCount`, `nextRetryAt`) for the frontend to show it accurately. The existing `runRetries()`/`retryOne()`/`cancelAfterExhaustion()` (registration-ledger plan D6, unchanged) pick this subscription up daily exactly like a renewal's dunning — no separate initial-registration retry logic exists or is needed.
7. The existing `existingSubscription` pre-check (now checking any active sub — D3a) stays as the friendly pre-Stripe UX layer; Guard A is the real backstop, same "pre-check is UX, guard is the backstop" relationship the registration-ledger plan already established.

**D3d — Frontend contract change.** `RegistrationCreateResponse` gains a `paymentStatus: 'completed' | 'pending'` field (mirrors the ledger row's own `status`, `pending` never surfaces `'failed'` to the frontend as a distinct value — a `201` either means charged, or means "accepted, first attempt failed, retrying," both of which read as `pending` from the parent's perspective until either a success or the final cancellation-after-exhaustion). The register wizard's success screen branches on it: `completed` → today's existing confirmation UI; `pending` → a distinct "we're processing your first payment; we'll retry over the next few days if needed" state, not the success screen and not an error state.

### D4 — `calculateChargeAmount` rewrite (PR 3)

New contract (same file, same export name; `resolveCurrentFee` unchanged):

```js
calculateChargeAmount(student, feeNow, { mode, subscription })
// mode: 'registration' | 'renewal'   (required — no default; every caller states intent)
// subscription: required in 'renewal' mode (the student's own sub, for the createdAt tiebreak)
// returns { amount, siblingDiscountApplied, siblingDiscountAmount, reason }  — same shape as today
```

**Sibling gathering (both modes):** find sibling students (same `parentId`, `_id ≠ student._id`, role student — unchanged query), then each sibling's single active subscription (`findOne` is now deterministic per ADR 005). **F3 cutoff:** skip a sibling subscription when `cancelAtPeriodEnd === true && currentPeriodEnd <= todayAtMidnight()` — it's past its paid period and only awaiting cron finalization. Resolve each counted sibling's fee live via `resolveCurrentFee` (unchanged). Collect `{ studentId, fee, subscriptionCreatedAt }`.

No active siblings → `{ amount: feeNow, applied: false, ... }` (unchanged).

**`mode: 'renewal'` — pure top-payer-excluded rule:**
- Compare the student's own STANDARD fee (`feeNow` — at renewal this is the standard monthly fee) against sibling fees. The student pays full price iff they are the family's top payer: their fee is strictly greater than every sibling fee, OR tied for highest and their own `subscription.createdAt` is the earliest among the tied-for-highest (CKQ ADR backend-002 tiebreak — earliest-enrolled pays full; ties on `createdAt` are broken by smaller `studentId` as a final deterministic fallback, documented in a comment).
- Top payer → full `feeNow`, `applied: false`, reason: sibling-discount-goes-to-your-other-children wording.
- Not top payer → `siblingDiscountAmount = round2(feeNow * 0.1)`, `amount = round2(feeNow - siblingDiscountAmount)` (F4 — round the discount once, subtract; `round2(x) = Math.round(x * 100) / 100`).

**`mode: 'registration'` — family discount always applies (ADR 006 bridge):**
- `base = Math.min(feeNow, topSiblingFee)` where `topSiblingFee` = the highest counted sibling fee (the current family top payer, pre-this-registration).
- `siblingDiscountAmount = round2(base * 0.1)`, `amount = round2(feeNow - siblingDiscountAmount)`, `applied: true` — always, whenever ≥1 counted sibling exists. No tiebreak needed in this mode.
- Two reason strings: own-fee case (base === feeNow) keeps a "your lower-priced plan gets the 10% sibling discount" wording; bridge case (base < feeNow) gets a NEW distinct wording, e.g. "10% family sibling discount, applied at your other child's lower plan rate" — exact copy at builder's discretion, but the two cases MUST be distinguishable on receipts/portal (this is the "mark" the owner asked for, together with the ledger fields).

**Caller updates:**
- `create()` (`registration.service.js:206`) → `mode: 'registration'` with the prorated `feeForDiscountCalc` (prorate-first sequencing unchanged).
- `previewChargeAmount()` (`:429`) → `mode: 'registration'` (preview must remain structurally identical to the real charge).
- `getMine` `currentCharge` (`:494`) → `mode: 'renewal'` with that subscription (it displays what the next renewal will charge).
- `renewOne` (`renewal.service.js:433`) → `mode: 'renewal'` with the subscription; also capture `siblingDiscountAmount` from the return and thread it through the pending row's `breakdown` so the receipt email at `:96` uses the ACTUAL rounded amount instead of recomputing `monthlyFee * 0.1`. Retry/dunning and stale-pending paths keep charging the locked `row.amount`/`row.breakdown` (no recomputation — verify untouched).
- **Footnote fix from the analysis:** guard the `recoverStalePending` receipt-email path against `monthlyFee: null` (Price deleted between runs) producing `NaN` — one-line guard where the email payload is built.

### D5 — What is deliberately NOT changing

- No refunds/credits ever; money already collected is never adjusted (ADR 006).
- No stored suppression state for the registration-time family discount — the pure renewal rule makes double-firing impossible (ADR 006 records why).
- The transition-month overlap (old F5) is ACCEPTED, not coded around.
- Ledger/dunning architecture (registration-ledger plan) untouched except the `breakdown` threading in D4.
- Trial registration and private classes untouched.
- Renewal cron scheduling out of scope (sign-off item 3).

---

## 3. Test plan

Follow `docs/TESTING_STRATEGY.md` (pre-read, mandatory). All date fixtures via the tz-aware helpers, never raw `new Date()` arithmetic.

### PR 1 tests
- `billingDates`: `firstOfNextMonth` — mid-month, 1st itself (→ next 1st), month/year boundaries, DST-adjacent dates (Central).
- `registration.routes/service`: registering mid-month → `currentPeriodEnd`/`nextBillingDate` = next 1st, charge = prorated amount; registering ON the 1st → full month to next 1st; preview parity (preview amount === create amount for same inputs); proration no longer gated (remove/replace any `prorationEnabled` test fixtures).
- `renewal.service`: a sub with period ending on the 1st renews to the next 1st (verify existing tests still express this; adjust fixtures from anniversary to boundary dates).
- Migration script: dry-run reports without writing; `--apply` extends a mid-month `currentPeriodEnd` to the next 1st and matches `nextBillingDate`; boundary-aligned and cancelled subs untouched.

### PR 2 tests
- `chargeFinalization.service` (new unit suite): `chargeLedgerRow` succeeded/StripeCardError/non-succeeded-status outcomes, real Stripe TEST-mode (never mocked, matching this codebase's convention); `finalizeSuccessfulCharge`/`finalizeFailedCharge` update the ledger row + Subscription correctly in isolation; `chargeAndFinalize` orchestrates both branches correctly.
- `renewal.service` (existing suite, must stay green with ZERO behavior change): every renewOne/retryOne/recoverStalePending/cancelAfterExhaustion test still passes after the extraction — this is the regression bar, not new coverage.
- `registration.routes` (extensive rewrite, since `create()`'s sequencing changed):
  - Route: 409 with the new message when the student has ANY active sub, same OR different schedule; the Guard-A race catch path still maps 11000 → 409, now firing BEFORE any Stripe call (assert no orphaned PaymentIntent for the loser — the actual bug this PR closes).
  - Happy path: successful charge → `paymentStatus: 'completed'`, roster access granted, confirmation email sent — same outward behavior as before, now via the new sequencing.
  - **New — the actual race this PR exists to close:** two concurrent registration requests for the SAME student on TWO DIFFERENT schedules → exactly one 201 (`completed`) + one 409, and the loser has NO Stripe charge at all (was the real gap; assert via `stripe.paymentIntents.list()` that only one PaymentIntent exists for that customer).
  - **New — failed first charge enters dunning, doesn't reject outright:** a real Stripe TEST-mode decline (`pm_card_chargeDeclined`) on `create()` now returns `201` with `paymentStatus: 'pending'`, NOT a 402 — a `Subscription` (`retryCount: 1`, `nextRetryAt` set) and a `failed` ledger row exist; no roster access granted; `sendPaymentFailureEmail` fired, not `sendRegistrationConfirmationEmail`.
  - **New — retry/cancel-after-exhaustion on a NEVER-successfully-paid subscription:** `retryOne`/`runRetries` pick up a failed initial registration exactly like a failed renewal; 3 failed attempts → `cancelAfterExhaustion` cancels it, still zero roster access ever granted, matching the line-45 mandate's cancel-then-charge race coverage applied to this new path too.
  - Preview (`previewChargeAmount`) is unaffected by this PR — still read-only, still never creates a Subscription — verify unchanged.
- Diagnostic script (`find-duplicate-active-subscriptions`): flags a seeded duplicate-active student; clean output otherwise.
- `drop-old-subscription-index` script: dry-run reports the old index's presence without dropping; `--live` drops it; no-op (not an error) when already absent.
- Frontend: register wizard's success-screen test gains a `paymentStatus: 'pending'` case asserting the distinct "processing" state renders instead of the success screen, alongside the existing `completed` case.

### PR 3 tests (`calculateChargeAmount.service.test.js` largely rewritten + renewal integration)
Unit — renewal mode: 2 kids lower/higher; 3 kids (only top pays full — owner's "3 kids → 2 discounts"); equal-fee ties (earliest `createdAt` pays full; both orderings; `studentId` fallback); F3 (pending-cancel past period end excluded; pending-cancel still inside period counted); rounding on a non-round fee (e.g. 149.99 → discount 15.00, amount 134.99 — assert exact cents); no siblings.
Unit — registration mode: new child lower (10% of own fee); new child higher (bridge — 10% of sibling's fee, distinct reason); prorated `feeNow` below sibling fee (10% of prorated amount); 3-kid bridge (`min(newFee, topFee)` both directions); result never negative.
Integration — renewal path (closing the analysis's coverage gap): full `renewOne` where a sibling exists → pending row `amount`/`breakdown` carry the rounded discount; receipt email payload uses the actual amount (not `monthlyFee * 0.1`); top-payer renewal charges full; retry path charges the locked amount even after the sibling landscape changes mid-dunning.
Integration — registration: create-with-higher-fee-than-sibling asserts the discounted Stripe amount, ledger row fields, and bridge reason; preview === create parity in both bridge and non-bridge cases.
Regression: `currentCharge` display uses renewal mode (a top payer's portal shows full price even though their registration charge was bridged).

### Every PR
Run the full backend suite; the only tolerated failures are ones REPRODUCED as pre-existing on the base branch via `git stash` (the known $0-proration failure may disappear entirely with PR 1 — if it does, say so in the PR notes). Frontend: run suite + `tsc --noEmit` (PR 1 may touch preview-display expectations; PRs 2–3 expect zero frontend changes — verify, and stop if that's wrong).

---

## 4. Docs to update (in the PR that makes each true)

- ADR 007 → Implemented (PR 1). ADR 005 → Implemented (PR 2). ADR 006 → Implemented (PR 3); flip statuses in `docs/decisions/README.md`.
- ADR 001: addendum noting the sibling-discount paragraph and the 2026-08-26(2) proration addendum's gating are superseded by ADR 006/007 (PR 3 / PR 1 respectively — do not rewrite history, add addenda).
- `CLAUDE.md`: scope line "10% sibling discount (dynamic lower-payer rule … 2-child case only)" → family rule wording; docs-map row for this plan; note `prorationEnabled` retirement (PR 1) and the one-sub rule (PR 2).
- `DATABASE_SCHEMA_DOCUMENTATION.md`: Guard A index change (PR 2); `prorationEnabled` deprecated (PR 1).
- `docs/TEST_COVERAGE.md`: refresh counts per its own real-run rule (PR 3 close-out).

---

## 5. PR breakdown

### PR 1 — `feature/calendar-month-billing`
`billingDates.js` (+`firstOfNextMonth`), `registration.service.js` (period math + always-prorate + preview), `setting.service.js` (retire flag), `realign-billing-anchors.js`, tests, docs (§4 PR 1 items). Ship → owner tests locally → merge to `develop` with owner approval → run migration dry-run then `--apply` on staging.

### PR 2 — `feature/one-active-subscription-guard`
`subscription.model.js` (index + comments — done), new `chargeFinalization.service.js` (extracted from `renewal.service.js`), `renewal.service.js` (repointed call sites, zero behavior change), `registration.service.js` (`create()` reordered per D3c, broadened check + messages), `find-duplicate-active-subscriptions.js` + `drop-old-subscription-index.js` (+ their `scripts/lib/*`), frontend register-wizard `paymentStatus` branch, tests, docs (ADR 005 + ADR 008 → Implemented). Run the diagnostic against staging BEFORE merge.

### PR 3 — `feature/sibling-discount-family-rule`
`calculateChargeAmount.service.js` (rewrite per D4), 4 caller updates + breakdown threading + receipt-email amount + NaN guard, tests, docs (§4 PR 3 items). This PR closes the plan.

---

## PR 1 completion notes (2026-08-28)

**Built, tests passing, NOT YET COMMITTED** — awaiting owner local testing per Hard Rule 5 before `write`-triggered commit.

**Verified against source before building (§1 claims held, with one correction):** `listMine`'s `currentCharge` caller is named `listMine` in code, not `getMine` as an earlier draft of this plan said — trivial naming slip, no behavioral impact. Everything else in §1 matched source exactly.

**What shipped, matching D1/D2 as written:**
- `backend/src/utils/billingDates.js` — added `firstOfNextMonth(date)` (sets day to 1 before incrementing month, avoiding `addOneMonth`'s day-preserving rollover quirk on month-end dates).
- `backend/src/services/billing/proration.service.js` — `periodEnd` is now `firstOfNextMonth(registrationDate)` in BOTH branches (real proration and the zero-schedules fallback), replacing `endOfMonth`. `computeProration()` remains the single source of the period boundary, not just the amount — `registration.service.js` uses its returned `periodEnd` directly rather than recomputing.
- `backend/src/services/registration.service.js` — `create()` and `previewChargeAmount()` both call `computeProration()` unconditionally now; the `Setting.prorationEnabled` read/branch is removed from both. `currentPeriodEnd`/`periodEnd` come straight from `prorationInfo.periodEnd`. Dead `addOneMonth` re-export removed (nothing depended on it — verified via grep). `settingService` import removed entirely (nothing else in the file used it).
- `Setting.prorationEnabled` deprecated per plan: field kept on the Mongoose schema (no migration needed for existing docs) but no longer read/written by `setting.service.js`, no longer part of the frontend `Setting` type or the admin settings page UI.
- `backend/scripts/lib/realignBillingAnchors.js` + `backend/scripts/realign-billing-anchors.js` (+ `npm run realign-billing-anchors`) — dry-run-by-default migration, `--live` to apply, always extends (never shortens) per sign-off item 2.

**One deviation from the plan, decided during the build, not deferred to the owner:** §0 sign-off item 1 said "the first-charge is ALWAYS prorated" — implemented exactly as stated. No change from what was proposed.

**Test coverage added/updated:**
- `backend/tests/utils/billingDates.test.js` — 6 new `firstOfNextMonth` cases (mid-month, on-the-1st, year boundary, month-end day-preservation bug avoidance, non-leap Feb, DST-adjacent sentinel).
- `backend/tests/services/billing/proration.service.test.js` — 2 existing tests updated for the `periodEnd` shape change (now asserts day-1-of-next-month instead of end-of-this-month).
- `backend/tests/scripts/lib/realignBillingAnchors.test.js` — new, 5 tests (dry-run reports without writing, `--live` extends both fields and only forward, already-aligned subscriptions untouched, cancelled subscriptions never touched, mixed batch only touches what needs it).
- `backend/tests/routes/registration.routes.test.js` — the suite now runs under a global `beforeEach`/`afterEach` fake-timer freeze to a fixed 1st-of-month instant (`2026-10-01T15:00:00.000Z`), so registering-on-the-1st tests get a full month at the flat fee (proratedAmount == monthlyFee exactly when `remainingClassDays === totalClassDays`) without needing every existing money assertion rewritten. Two tests were deleted (`prorationEnabled` OFF / explicit-OFF — the toggle no longer exists) and folded into a renamed "registering exactly on the 1st" test; the mid-month proration test and the proration-before-sibling-discount test each now do their own `jest.setSystemTime()` shift to a genuine mid-month instant so they still prove a REAL partial charge rather than coincidentally testing the same on-the-1st case. `Setting.create({ prorationEnabled: true })` removed from 5 tests (dead now). The two `GET /preview` full-object `toEqual` tests now assert `prorated`/`totalClassDays`/`remainingClassDays`/`dailyRate` via a new `expectedProrationFor()` test helper (real `computeProration()` call) instead of hardcoded `false`/`null`.
- `backend/tests/routes/setting.routes.test.js` — `prorationEnabled` removed from every fixture/assertion; the two tests solely about that field (independent toggle, non-boolean 400) deleted.
- `frontend/lib/types.ts`, `frontend/app/admin/settings/page.tsx` — `prorationEnabled` removed from the `Setting` type, the form state, and the page (checkbox + hint text deleted).
- `frontend/app/admin/settings/__tests__/page.test.tsx` — proration-checkbox test deleted; remaining tests' fixtures/payloads updated.

**Verification run (this session, not a re-derivation of stale notes):**
- Backend: `TZ=UTC npx jest` — **49 suites / 485 tests, all passing.** Notably, the plan's own note anticipated the pre-existing "$0-proration flakiness" might disappear with this change — it did: zero failures, not even the previously-documented flaky one. Freezing the registration test suite's clock likely removed the real-wall-clock-month-end timing dependency that caused that flakiness in the first place; worth confirming on a second run before treating this as fully proven, but nothing reproduced here.
- Frontend: `npx jest` — **47 suites / 275 tests, all passing.** `npx tsc --noEmit` — clean, no errors.

**Docs updated in this PR's diff:** ADR 007 status flipped to "BUILT, pending owner review"; `docs/decisions/README.md` row updated; `CLAUDE.md` active-plan row updated; `DATABASE_SCHEMA_DOCUMENTATION.md`'s `Setting`/proration section updated to describe the deprecation and the new unconditional behavior.

**Not yet done (correctly out of scope for PR 1):** the realignment migration has not been run against staging — that happens after this PR merges to `develop`, per the plan's own sequencing (dry-run first, then `--live`). PR 2 (ADR 005) and PR 3 (ADR 006) have not been started.

## PR 2 completion notes (2026-08-28)

**Built, tests passing, NOT YET COMMITTED** — awaiting owner local testing per Hard Rule 5 before `write`-triggered commit. Branch: `feature/one-active-subscription-guard`, on top of `develop` post-PR-1-merge (`68d1f44`).

**Real deviation from the original PR 2 scope, found mid-build, not anticipated in this plan's first draft:** tightening Guard A to `{studentId}` alone exposed a genuine cross-schedule double-charge race under the OLD charge-first `create()` — two near-simultaneous requests for the same student on two DIFFERENT schedules could both charge Stripe for real (different idempotency keys) before Guard A rejected the loser's `Subscription.create()`, leaving an orphaned real charge with nothing to attach to. Surfaced to the owner mid-build rather than silently patched (three narrower fixes were proposed and rejected — see [ADR 008](../decisions/008-registration-create-pending-first.md)'s Alternatives) or improvised past. Researching CKQ's own `groupClassRegistration()` flow (a background subagent task, cited in ADR 008) confirmed CKQ already creates its enrollment/registration documents before charging and runs a failed *initial* charge through the same retry/dunning cron as a renewal failure — this plan adopted that shape, reusing Frisco's own already-built renewal dunning machinery rather than porting CKQ's code.

**What shipped, beyond D3a's original guard-only scope:**
- `backend/src/models/subscription.model.js` — Guard A tightened to `{studentId: 1}` unique partial on `status:'active'`. Comments updated.
- `backend/src/services/billing/chargeFinalization.service.js` (new) — `advanceSubscriptionPeriod`, `chargeLedgerRow`, `finalizeSuccessfulCharge`, `finalizeFailedCharge`, `chargeAndFinalize` extracted from `renewal.service.js`, stripped of email-sending (callers decide which email to send and, for `create()` only, whether to grant roster access). `finalizeSuccessfulCharge` takes an explicit `chargeAmount` override (defaulting to `row.amount`) — needed because an 'initial' ledger row's `amount` includes the one-time registration fee, but `Subscription.lastChargeAmount` must stay fee-free; found and fixed via a real failing test (`lastChargeAmount` came back 175 instead of 150) before it could ship as a silent regression.
- `backend/src/services/renewal.service.js` — repointed to the shared module at 3 call sites (`renewOne`'s fresh charge via a new local `chargeAndEmail` wrapper, `retryOne`, `recoverStalePending`'s both branches); zero behavior change, verified by the full pre-existing renewal/retry suite staying green untouched.
- `backend/src/services/registration.service.js` — `create()` reordered per D3c: reserve `Subscription` → create `pending` ledger row → `chargeAndFinalize` → branch on outcome for roster access/email/response. Re-fetches both documents fresh after charging rather than returning the stale pre-charge in-memory objects — a second real bug caught by a failing test (`registration.status` came back `'pending'` instead of `'completed'` on the response body, because `chargeAndFinalize`'s `findByIdAndUpdate` calls don't mutate the caller's local Mongoose objects). `stripe`/`paymentFailedError` (dead after the rewrite) removed.
- `backend/src/services/subscription.service.js` — `changeSchedule()`'s "does the student already have another active subscription at the target schedule" check removed: Guard A now makes it permanently unreachable (a student can have at most one active subscription, period, and `changeSchedule` operates on that one document). Its corresponding test (which seeded a now-impossible fixture) removed, not skipped — found via the one real regression the full-suite run surfaced.
- `backend/scripts/lib/findDuplicateActiveSubscriptions.js` + `scripts/find-duplicate-active-subscriptions.js` (+ `npm run find-duplicate-active-subscriptions`) — read-only pre-flight.
- `backend/scripts/lib/dropOldSubscriptionIndex.js` + `scripts/drop-old-subscription-index.js` (+ `npm run drop-old-subscription-index`) — dry-run-by-default cleanup for the now-redundant old compound index.
- Frontend: `RegistrationCreateResponse.paymentIntentStatus` replaced with `paymentStatus: 'completed' | 'pending'`; the register wizard's confirmation screen branches on it (distinct "Registration received" / processing copy for `pending`, never the success screen).

**Test coverage added/updated:**
- `backend/tests/services/billing/chargeFinalization.service.test.js` (new, 8 tests) — real Stripe TEST-mode charge/decline/idempotent-replay, finalize-success/finalize-failure in isolation, `chargeAndFinalize` orchestration both ways.
- `backend/tests/services/renewal.service.test.js` — unchanged, all 18 tests pass with zero edits, proving the extraction preserved behavior exactly.
- `backend/tests/routes/registration.routes.test.js` — the old "402 on decline" test rewritten into "201 + paymentStatus:'pending', enters dunning, no roster access, correct email" (30s); a new "cancels after exhaustion on a never-successfully-paid subscription" test (drives `retryOne` directly through 3 failed attempts); **the actual regression test this PR exists for** — a cross-schedule concurrent-registration race asserting exactly one 201/one 409 AND exactly one real Stripe PaymentIntent for that customer (the loser's card is never touched).
- `backend/tests/scripts/lib/findDuplicateActiveSubscriptions.test.js` / `dropOldSubscriptionIndex.test.js` (new) — the former deliberately drops Guard A's index in its own `beforeAll` to recreate the pre-migration legacy condition it's designed to detect (the new index makes the duplicate fixture otherwise impossible to construct).
- `backend/tests/services/subscription.service.test.js` — the now-impossible duplicate-fixture test removed with an explanatory comment in its place.
- `frontend/app/parent/register/__tests__/page.test.tsx` — new test for the `paymentStatus:'pending'` confirmation-screen branch; existing fixtures' `paymentIntentStatus` renamed to `paymentStatus`.

**Verification run (this session):**
- Backend: `TZ=UTC npx jest` — **52 suites / 501 tests, all passing.** `TZ=UTC npx jest --coverage` — 88.12% statements / 68.50% branches / 89.66% functions / 88.20% lines (stable vs. pre-PR-1 baseline).
- Frontend: `npx jest` — **47 suites / 276 tests, all passing.** `npx tsc --noEmit` — clean.

**Docs updated in this PR's diff:** ADR 005 + ADR 008 status flipped to "Built, pending owner review"; `docs/decisions/README.md` rows; `CLAUDE.md` active-plan row; `DATABASE_SCHEMA_DOCUMENTATION.md`'s `Subscription`/Guard A description (also fixed a stale line that predated Guard A's original addition and was never corrected then); `docs/plans/registration-ledger-plan.md` D2/D3 marked superseded with addenda pointing at ADR 005/008; `docs/TEST_COVERAGE.md` re-measured.

**Not yet done:** the diagnostic script has not been run against staging (happens after this PR merges, before the index swap ships there); `drop-old-subscription-index` likewise. PR 3 (ADR 006) has not been started.

## PR 3 completion notes (2026-08-28)

**Built, tests passing, NOT YET COMMITTED** — awaiting owner local testing per Hard Rule 5 before `write`-triggered commit. Branch: `feature/sibling-discount-family-rule`, on top of `develop` post-PR-2-merge (`3cc1481`).

**Built as designed in D4, with one contract addition found necessary during implementation, not anticipated in the original design:** `calculateChargeAmount()` throws (rather than silently defaulting) when `options.mode` is missing or invalid, and throws when `mode: 'renewal'` is called without the required `subscription`. This surfaced one caller the original plan's "callers to update" list missed entirely — `backend/scripts/lib/runLegacyImport.js`'s historical-backfill enrollment path, found only because the full backend suite failed loudly on it rather than silently computing something wrong. Fixed with `mode: 'registration'` (a legacy backfill creates a brand-new Subscription, structurally the same "first enrollment" case `registration.service.js`'s `create()` handles).

**What shipped, matching D4 as written:**
- `backend/src/services/billing/calculateChargeAmount.service.js` — full rewrite per D4's contract. `gatherSiblingFees()` centralizes the F3 pending-cancel cutoff and live fee resolution for both modes. `round2()` closes F4 (cents rounding) in both modes. Renewal mode's tiebreak follows CKQ ADR backend-002 exactly (earliest `subscription.createdAt` among everyone tied at the family max pays full; exact-`createdAt`-tie falls back to smaller `studentId`).
- Four callers updated: `registration.service.js`'s `create()` and `previewChargeAmount()` → `mode: 'registration'`; `listMine()`'s `currentCharge` → `mode: 'renewal'` with the subscription; `renewal.service.js`'s `renewOne()` → `mode: 'renewal'` with the subscription.
- `siblingDiscountAmount` now threaded through the renewal ledger row's `breakdown` (previously only `siblingDiscountApplied` was stored) and through every `chargeAndEmail`/`recoverStalePending` call site, so `sendReceiptEmail()` uses the ACTUAL rounded amount from the ledger row instead of recomputing `monthlyFee * 0.1` (the old F4 bug this closes) — verified by a new integration test using a non-round fee where a recompute would have disagreed. `sendReceiptEmail()` also gained a one-line `monthlyFee ?? 0` display fallback (the footnote fix, guards a deleted-Price NaN in the email template).
- `backend/scripts/lib/runLegacyImport.js` — the missed caller, fixed (see above).

**A real, expected behavior change surfaced by the full-suite run, not a bug:** `runLegacyImport`'s two-siblings-at-an-exact-fee-tie test previously asserted NEITHER sibling got the discount — an artifact of the OLD rule's studentId-based tiebreak (the second-created sibling's numerically larger ObjectId happened to lose). The NEW rule needs no tiebreak for an exact tie in registration mode (`base = min(newFee, existingFee)` is just that fee either way) — the second sibling now correctly gets the discount immediately. Test updated to assert the new, more correct behavior, with the reasoning recorded in the test's own comment so a future reader doesn't mistake it for drift.

**Test coverage added/updated:**
- `backend/tests/services/billing/calculateChargeAmount.service.test.js` — fully rewritten (18 tests): input-contract errors; no-siblings both modes; renewal mode's 2-kid lower/higher, 3-kid (only top excluded), tie-by-createdAt (both orderings), tie-by-studentId fallback, F3 (both directions), F4 rounding, live re-verification; registration mode's own-fee case, bridge case, prorated fee, 3-kid bridge, never-negative.
- `backend/tests/services/renewal.service.test.js` — new `describe('sibling discount', ...)` block (3 tests) closing the previously-real coverage gap: a real `renewOne` charge with a sibling discount asserts the ledger row + receipt email carry the actual rounded amount; a top-payer renewal charges full; the retry path charges the LOCKED amount even after a new, pricier sibling joins mid-dunning (proving no recomputation). All 18 pre-existing tests in this file pass unchanged.
- `backend/tests/routes/registration.routes.test.js` — new bridge-case test (higher-payer new child gets the family discount immediately, distinct reason, real Stripe amount, ledger fields) and its preview-parity counterpart; the pre-existing lower-payer test's stale ADR-001 framing in its comment corrected.
- `backend/tests/scripts/lib/runLegacyImport.test.js` — the exact-tie test's assertion and comment corrected per the behavior-change note above.

**Verification run (this session):**
- Backend: `TZ=UTC npx jest` — **52 suites / 519 tests, all passing.** `--coverage`: 88.25% statements / 69.02% branches / 89.94% functions / 88.32% lines (stable, slightly up).
- Frontend: `npx jest` — **47 suites / 276 tests, all passing** (unaffected — this PR is backend-only). `npx tsc --noEmit` — clean.

**Docs updated in this PR's diff:** ADR 006 status flipped to "Built, pending owner review"; `docs/decisions/README.md` row; ADR 001's sibling-discount paragraph gets a supersession addendum pointing at ADR 006; `CLAUDE.md`'s platform-scope line and active-plan row; `docs/TEST_COVERAGE.md` re-measured.

**Not yet done:** nothing — this is the last PR in the plan. Once merged, the plan doc's `## 5. PR breakdown` and `## 0`/`## 1` framing could be marked closed in a small follow-up doc pass, but no further code work is scoped here.

## 6. Builder instructions (Sonnet session)

1. **CLAUDE.md hard rules apply in full**: discuss-then-`write` per the owner's workflow, tests before commit, owner tests locally before every commit/merge, explicit-file staging only, read every file before editing.
2. **Pre-reads before touching code**: `docs/decisions/001/005/006/007`, `docs/TESTING_STRATEGY.md`, `docs/plans/registration-ledger-plan.md` (§D4–D6 — do not disturb its sequencing/locking), `docs/plans/timezone-consistency-plan.md` (date conventions), `DATABASE_SCHEMA_DOCUMENTATION.md`.
3. **Verify every "current state" claim in §1 against source before building on it** — line numbers drift. If reality differs from this plan in a way that changes a decision (not just a line number), STOP and surface it to the owner instead of improvising.
4. One PR at a time, in order, each fully green (tests + owner local verification) before starting the next.
5. Append per-PR completion notes to THIS file (same convention as `registration-ledger-plan.md`), including anything found mid-build that deviated from the plan.
