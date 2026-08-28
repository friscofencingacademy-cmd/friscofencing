# Implementation plan: Calendar-month billing + one-sub-per-student guard + family sibling discount

**Status:** READY FOR BUILD — owner-approved decisions recorded in ADR 005/006/007 (2026-08-28).
**Builder:** Sonnet session, following §8 builder instructions exactly.
**Executes:** [ADR 005](../decisions/005-one-active-subscription-per-student.md) · [ADR 006](../decisions/006-sibling-discount-family-rule.md) · [ADR 007](../decisions/007-calendar-month-billing.md)

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

### D3 — One-active-subscription guard (PR 2)

- `subscription.model.js`: Guard A index becomes `{ studentId: 1 }`, `unique: true`, `partialFilterExpression: { status: 'active' }`. Update the schema's explanatory comments (they currently explain the student+schedule scoping).
- `registration.service.js` `create()`: pre-check at `:125` drops `scheduleId` from the query; 409 message becomes `'This student already has an active class registration'`. The `11000` catch at `:293` gets the same message.
- **Pre-flight diagnostic** `backend/scripts/find-duplicate-active-subscriptions.js` (read-only, same pattern as `find-orphaned-references.js`): list students with 2+ active subscriptions. §8 requires running it against staging before merge; the index swap will fail on Mongo if violations exist, so surface them first.
- Mongoose only builds indexes on sync — the PR notes must state how the old index gets dropped on staging/prod (explicit `dropIndex` in the migration script or manual step; builder picks the repo-consistent mechanism and documents it).

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
- Model/index: two active subs for one student rejected (11000) regardless of schedule; active+cancelled for same student OK; re-registration after cancellation OK.
- Route: 409 with the new message when the student has ANY active sub (different schedule); 409 unchanged for same schedule; the Guard-A race catch path still maps 11000 → 409.
- Diagnostic script: flags a seeded duplicate-active student; clean output otherwise.

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
`subscription.model.js` (index + comments), `registration.service.js` (broadened check + messages), `find-duplicate-active-subscriptions.js`, old-index drop mechanism, tests, docs. Run the diagnostic against staging BEFORE merge.

### PR 3 — `feature/sibling-discount-family-rule`
`calculateChargeAmount.service.js` (rewrite per D4), 4 caller updates + breakdown threading + receipt-email amount + NaN guard, tests, docs (§4 PR 3 items). This PR closes the plan.

---

## 6. Builder instructions (Sonnet session)

1. **CLAUDE.md hard rules apply in full**: discuss-then-`write` per the owner's workflow, tests before commit, owner tests locally before every commit/merge, explicit-file staging only, read every file before editing.
2. **Pre-reads before touching code**: `docs/decisions/001/005/006/007`, `docs/TESTING_STRATEGY.md`, `docs/plans/registration-ledger-plan.md` (§D4–D6 — do not disturb its sequencing/locking), `docs/plans/timezone-consistency-plan.md` (date conventions), `DATABASE_SCHEMA_DOCUMENTATION.md`.
3. **Verify every "current state" claim in §1 against source before building on it** — line numbers drift. If reality differs from this plan in a way that changes a decision (not just a line number), STOP and surface it to the owner instead of improvising.
4. One PR at a time, in order, each fully green (tests + owner local verification) before starting the next.
5. Append per-PR completion notes to THIS file (same convention as `registration-ledger-plan.md`), including anything found mid-build that deviated from the plan.
