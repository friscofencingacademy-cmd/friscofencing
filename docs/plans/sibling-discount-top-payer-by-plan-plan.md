# Sibling Discount — Top Payer Decided by Plan (F15)

**Status (current, 2026-10-27):** MERGED TO `develop` as #133 (2026-10-27); its live gate `f15-prorated-top-payer` passed on staging the same day (by hand, then by Playwright). Not in production (`main` was last promoted 2026-08-23, #19).

**Status when written:** MERGED TO `develop` as #133 (2026-10-27), at the owner's request before the staging test; owner still tests Charge → prorated on staging. Production not promoted. See §6.
**Executor:** Opus or Sonnet, in auto mode, ONE PR (`fix/sibling-discount-top-payer-by-plan` → `develop`).
§1 is the binding contract. The owner tests the PR locally/on staging before it is merged.
**Origin:** finding F15 in `docs/plans/audit-and-health-refresh-plan.md` §9 ("Staging go-live",
2026-10-26), same root cause as F12 (fixed in #131).
**Touches payments** — `docs/decisions/001-in-house-subscription-billing.md` and
`docs/decisions/006-sibling-discount-family-rule.md` are required reading before any edit.

---

## 0. The problem (measured 2026-10-26 against `develop` at `a9578dc`)

ADR 006: among a family's active children, **the child on the highest-priced plan pays full;
every other child gets 10% off their own charge**. Renewal mode of
`backend/src/services/billing/calculateChargeAmount.service.js` decides "who is the top payer" by
comparing `feeNow` (the amount being charged right now) with each sibling's live plan fee
(`resolveCurrentFee` → `Price.monthlyFee`).

For a normal monthly renewal `feeNow` IS the plan fee, so the comparison is plan vs plan and correct.
But two callers pass a **prorated** `feeNow`:

| Caller | File:line | What it passes |
|---|---|---|
| `previewRenewal` — the Charge dialog's "prorated from today" option | `renewal.service.js:360` | `proration.proratedAmount` |
| `chargeProratedNow` — the charge that option performs | `renewal.service.js:652` | `proration.proratedAmount` |

**Failure:** child B on the $100 plan, sibling A on the $50 plan. Late in the month a superadmin uses
Charge → prorated; B's prorated amount is $25. Renewal mode sees $25 < $50, decides B is NOT the
top payer, and takes 10% off: B is charged $22.50. ADR 006 says B pays full ($25). The preview and the
charge agree with each other, so nothing flags it. Only the superadmin manual prorated path is
affected; the monthly cron, registration and the parent portal are not.

**Not affected (verified):** `renewOne` (`:546`, full `monthlyFee`), `previewRenewal`'s full-month
option (`:346`), `listMine` (`registration.service.js:601`, `currentFee`), `recordManualPayment`
(no sibling discount at all — the admin enters the amount), registration mode (already decides by
plan since #131, `planFee`), `retryOne` (charges the locked failed-row amount, never recomputes).

### 0.1 CKQ comparison (owner-requested, 2026-10-26)

CKQ (`backend-2.0/src/utils/paymentCalculator.js` `_applyGroupClassDiscounts`, ADR backend-002)
ranks every child by the full monthly amount they are billed and gives 10% of the current child's
own amount when they are not the highest. It never ranks a partial amount against a full one in that
path. So this fix brings Frisco's renewal mode in line with CKQ's principle: **rank by plan, discount
the charge being made.**

The one intended difference stays: Frisco's registration "bridge" (ADR 006 — when the newly
registering child is the pricier one, 10% of the lower plan comes off that first bill instead of
waiting for the sibling's next renewal). **Owner re-confirmed 2026-10-26: keep it.** CKQ has no
equivalent (the family waits a month); that is a CKQ matter and out of scope here.

---

## 1. EXECUTION CONTRACT (binding)

1. Read before editing: ADR 001, ADR 006 (incl. both addenda), `docs/TESTING_STRATEGY.md`,
   `DATABASE_SCHEMA_DOCUMENTATION.md` (no schema change is expected — stop if one seems needed),
   and every file in §3 in full.
2. Follow CLAUDE.md hard rules: tests in the same PR, no `any`, no `console.log`, stage files by
   name, never `git add .`/`-A`, run the backend suite with `TZ=UTC` (`npm test` does this).
3. **Money rules that must not move:** the 10% rate; 10% is taken from `feeNow` (the charge being
   made) in renewal mode; the tiebreak (earliest subscription `createdAt` pays full, then smaller
   `studentId`); the F3 pending-cancel cutoff; cents rounding via `round2`; registration mode as-is.
   The ONLY behaviour change is which input the top-payer comparison reads.
4. Preview == charge: `previewRenewal`'s prorated option and `chargeProratedNow` must keep calling
   the same function with the same inputs.
5. If anything in §0 no longer matches the code, stop and report — do not adapt silently.
6. Do not merge. Open the PR to `develop`, wait for `ci-passed`, report to the owner.

## 2. LOCKED DECISIONS

- **D1 — `planFee` becomes required in renewal mode too**, exactly as in registration mode
  (same validation: finite and ≥ 0, same error style). Every caller states it explicitly; no
  default to `feeNow`. Reason: one shape for both modes, and a future prorated caller cannot
  silently reintroduce F15.
- **D2 — top payer is decided by `planFee`** against the siblings' plan fees: `familyMax` is the max
  of `planFee` and every sibling fee; "strictly lower" and "tied at max" both use `planFee`. The
  tiebreak code is otherwise unchanged.
- **D3 — the discount is `round2(feeNow * 0.1)`**, unchanged: a non-top child charged a prorated
  amount still gets 10% of that prorated amount.
- **D4 — reasons unchanged:** `TOP_PAYER` / `OWN_PLAN` from `SIBLING_DISCOUNT_REASONS`. They already
  describe plans, which is now what decides them.
- **D5 — no data migration, no backfill.** Past prorated manual charges are not re-priced (ADR 006:
  money already collected is never touched). The as-built note records how many such rows exist on
  staging (read-only count of `subscription_cycle` rows with `breakdown.prorated: true`,
  `eventType: 'renewal'`, `siblingDiscountApplied: true`) so the owner can decide separately.

## 3. CHANGES

| File | Change |
|---|---|
| `backend/src/services/billing/calculateChargeAmount.service.js` | Renewal mode: require `planFee` (D1); compare by `planFee` (D2); update the header comment block for both modes. |
| `backend/src/services/renewal.service.js` | Pass `planFee: monthlyFee` at all four calls (`:346`, `:360`, `:546`, `:652`). |
| `backend/src/services/registration.service.js` | `listMine` (`:601`): pass `planFee: currentFee`. |
| `backend/tests/services/billing/calculateChargeAmount.service.test.js` | Add `planFee` to every existing renewal call (= `feeNow`, so every existing expectation is unchanged) + the new tests in §4. |
| `backend/tests/services/renewal.previewAndCharge.test.js` | New tests in §4. |
| `docs/decisions/006-sibling-discount-family-rule.md` | 2026-10-26 addendum: replace the "Open… F15" paragraph with the resolution (renewal mode ranks by plan too). |
| `docs/plans/audit-and-health-refresh-plan.md` §9 | F15 entry: "fixed in #<PR>". |
| `docs/features/admin.md` (Subscriptions → Charge) | One sentence: the prorated option applies the sibling rule by plan. Only if that section describes the sibling discount today. |
| `CLAUDE.md`, `CLAUDE_HISTORY.md` | Doc-map row for this plan + history row; drop "F15 open" from the audit-plan row. |

Search before finishing: `grep -rn "mode: 'renewal'" backend` must show `planFee` on every hit
(src, tests, scripts).

## 4. TESTS (all must fail on `develop` before the fix where marked ✱)

**Unit — `calculateChargeAmount.service.test.js`**
- U1 renewal mode without `planFee`, or with `NaN`/negative, throws `/planFee/`.
- U2 ✱ top payer charged a prorated amount: this child plan $100, `feeNow` $25, sibling plan $50 →
  `amount` 25, `siblingDiscountApplied` false, reason `TOP_PAYER`.
- U3 non-top child prorated: plan $50, `feeNow` $12.50, sibling plan $100 → discount 1.25,
  `amount` 11.25, reason `OWN_PLAN`.
- U4 ✱ tie at the top by plan, prorated `feeNow`: both plans $100, this `feeNow` $25; this
  subscription enrolled earlier → full $25; enrolled later → $22.50.
- U5 full month unchanged: every pre-existing renewal test passes with `planFee === feeNow` and no
  expectation edited.

**Service — `renewal.previewAndCharge.test.js`** (pin the clock with `freezeAt` from
`tests/testUtils/clock.js` to a late-month Central date so the prorated amount is below the
sibling's plan fee; assert that precondition explicitly; compute expected amounts with
`computeProration`, never hard-code them; use the existing seed helpers and fake payment provider)
- S1 ✱ `previewRenewal` for the top payer with a cheaper active sibling: prorated option
  `siblingDiscountApplied` false and `amount === proratedAmount`; full-month option also undiscounted.
- S2 ✱ `chargeProratedNow` same family: outcome `charged`, `chargeAmount === proratedAmount`, ledger
  row `breakdown.siblingDiscountApplied` false; equals S1's previewed amount.
- S3 the cheaper sibling's `chargeProratedNow` still gets 10% of its own prorated amount.

Run the full backend suite (`npm test` in `backend/`) and the frontend suite once (no frontend change
expected; it proves nothing else read the changed shape). Report counts in the as-built note.

## 5. DEFINITION OF DONE

- All §4 tests pass; ✱ tests shown failing on `develop` first (state it in the PR body).
- Full backend + frontend suites green, `ci-passed` green on the PR.
- `grep` check in §3 clean; no amount changes for any full-month path (U5 untouched).
- Docs in §3 updated; §6 as-built note filled in; staging read-only count from D5 recorded.
- PR open to `develop`, not merged; owner tests the Charge → prorated option on staging with a
  two-child audit family before merging. *(Done: merged as #133 at the owner's request; the
  `f15-prorated-top-payer` live gate then passed on staging, 2026-10-27.)*

## 6. AS-BUILT NOTES (executor appends)

Built 2026-10-26 on `fix/sibling-discount-top-payer-by-plan`, at `develop` `6009338`. §0 still matched
the code exactly (all five renewal-mode callers at the listed lines), so nothing was adapted.

- **Code.** `calculateChargeAmount` now validates `planFee` for both modes with one check, after the
  mode and subscription checks, so the existing "renewal without a subscription" test still sees its
  own error first. Renewal mode builds `familyMax` from `planFee` and compares `planFee` to it. The
  tiebreak, 10% of `feeNow`, `round2` and the reasons are unchanged. All four `renewal.service.js`
  callers pass `planFee: monthlyFee`, and `listMine` passes `planFee: currentFee`. The preview's
  prorated option and `chargeProratedNow` still pass identical inputs.
- **Tests.** U1–U4 added to `calculateChargeAmount.service.test.js`, and the 15 existing renewal calls
  now pass `planFee` equal to `feeNow` with no expectation edited (U5). S1–S3 added to
  `renewal.previewAndCharge.test.js` in their own describe, which pins the clock to 2026-10-29
  10:00 Central and restores the file's own instant afterward. Both levels there have a class every
  day, so the prorated slice is always chargeable; the S-tests use a $300 top plan and a $150 sibling
  plan.
- **Shown failing on `develop` first.** With the source changes stashed, U2, U4, S1 and S2 failed as
  marked, plus U1 (the new contract). U3 and S3 passed on both, as expected. With the fix, both files
  pass 47 of 47.
- **Full suites.** Frontend 81 suites, 633 tests, all green. Backend 97 suites, 1,327 tests: the first
  run had one failure, the Guard B unique-index test in `tests/models/registration.model.test.js`.
  It passes alone three times out of three and touches nothing this PR changed. It never waits for
  the unique index to finish building, so under full-suite load the duplicate insert can win the
  race. Left as a pre-existing flake for a separate fix (CLAUDE.md hard rule 6). A second full run
  passed 97 of 97 suites and 1,327 of 1,327 tests.
- **D5 staging count (read-only, `friscofencing-staging`).** Zero `registrations` rows with
  `breakdown.prorated: true` and `eventType: 'renewal'`, so zero with a sibling discount. No past
  charge on staging was affected. Production was not queried.
- **Docs.** ADR 006 addendum, the audit plan's F15 entry, CLAUDE.md and CLAUDE_HISTORY.md updated.
  `docs/features/admin.md`'s Charge section does not describe the sibling rule, so it is unchanged.
- **Grep check.** Every `mode: 'renewal'` call in `src`, `tests` and `scripts` passes `planFee`.
