# Airtight Payments — Proration Rule, Admin Charge Modes, Parent Billing Page

**Status:** PR 1 MERGED TO DEVELOP 2026-08-30 (PR #79). PR 2 BUILT 2026-08-30 on branch
`feature/charge-modes-and-month-guard`, not yet committed — pending owner local testing + review
before commit, per Hard Rule 5. PR 3 not started.

**PR 2 completion notes:** All of D4–D9 built as specced. `registration.model.js`'s base schema
gained `chargeMethod`/`manualNote`/`recordedBy`; the `subscription_cycle` discriminator gained
`periodMonth` (derived by a pre-validate hook from `periodStart`, never accepted from a caller) and
Guard B's unique index moved from `{subscriptionId, periodStart}` to `{subscriptionId,
periodMonth}` — verified with a real cross-pathway test proving a manual "prorated" payment now
blocks a later card "prorated from today" charge for the same month, the exact gap the old exact-
day index missed. `renewal.service.js` gained `chargeProratedNow` (the card prorated-from-today
path) and `recordManualPayment` (the offline path); `previewRenewal` gained `options.fullMonth`/
`options.prorated`/`monthAlreadyPaid`; `renewOne`'s own dedup pre-check moved to the `periodMonth`
key. New `scripts/migrate-period-month.js` (+ `scripts/lib/migratePeriodMonth.js`), dry-run-first,
backfills `periodMonth` and swaps the index, aborting with zero writes on any detected same-month
collision — not yet run anywhere (staging first, per the plan, at ship time). Admin Charge dialog
(`app/admin/subscriptions/page.tsx`) reworked into the card/manual × full/prorated matrix; `Record
offline payment` prefills its amount from the selected period and requires a note. Invoice PDF +
renewal receipt email both gained a method-aware line ("Charged to card on file." vs. "Payment
recorded by the academy — {note}").

Tests: new `tests/models/registration.model.test.js` (10/10 — periodMonth derivation, manualNote
validation, Guard B collision/non-collision incl. the cross-day-same-month case); new
`tests/scripts/lib/migratePeriodMonth.test.js` (5/5 — dry-run, live, idempotent re-run, collision
abort, failed-row-never-blocks); `tests/routes/subscription.routes.test.js` extended with a new
`POST .../record-payment` describe block (9 new tests: role gating, invalid_amount/invalid_note,
full-period happy path incl. dunning-clearing, prorated-period-despite-broken-chain, already-paid
rejection) — full file 36/36; `tests/services/renewal.previewAndCharge.test.js` extended (7 new
tests: `options`/`monthAlreadyPaid` shape, `chargeProratedNow` happy path + inactive rejection, and
three Guard-B cross-pathway proofs) — full file 18/18, real Stripe TEST-mode; `tests/services/
invoice.service.test.js` (+1) and `tests/services/mail.service.test.js` (+1) for the method-aware
line. `app/admin/subscriptions/__tests__/page.test.tsx` extended (+6: prorated selection, disabled-
when-unavailable, already-paid alert, manual prefill/validation/submit, period-switch re-prefill) —
full file 28/28. Full backend suite: 692/724 passing — the 32 failures reverified via `git stash` as
byte-identical to unmodified `develop` (same count, same tests: the 14 pre-existing
`registration.routes.test.js` failures already documented under PR 1, plus 18 more across 4
unrelated suites — `scheduleOccurrence`/`billingDates`/`realignBillingAnchors`/
`groupClassSchedule.routes` — all pre-existing on `develop` before this PR, same "today"/local-
machine-TZ-dependent flakiness class, confirmed via the same stash-and-rerun discipline). Full
frontend suite: 384/384. `tsc --noEmit` clean both sides. Docs closed out: ADR 001 addendum
(2026-08-30(2)), `DATABASE_SCHEMA_DOCUMENTATION.md`'s `Registration` section, `docs/features/
admin.md`'s Subscriptions → Charge section, `docs/modules/email.md`'s new "Method-aware receipt/
invoice line" section.

**PR 1 completion notes:** `billing/proration.service.js` gained `resolveFirstChargePeriod()` — the
single new branch point (D1) — leaving `computeProration()` itself untouched, as planned.
`registration.service.js`'s `create()` and `previewChargeAmount()` both call it in place of
`computeProration()` directly; no other call site existed. The future-month branch deliberately
builds its period via explicit `Date.UTC` arithmetic rather than `billingDates.js`'s
`firstOfNextMonth()` (which reads a Date's LOCAL components) — caught by a real test failure on
this dev machine (non-UTC host) during the build, confirming the fix is genuinely host-TZ-independent
rather than only correct under `TZ=UTC`. New tests: 4 unit tests for `resolveFirstChargePeriod` in
`tests/services/billing/proration.service.test.js` (fast, no network); 3 integration tests in
`tests/routes/registration.routes.test.js` (real Stripe TEST-mode) covering the future-month charge
+ period, the `GET /preview` mirror, and the owner's exact edge case end-to-end (register in one
month for the next, then prove `previewRenewal`/`renewOne`/`runRenewals` all recognize the month as
already paid when checked during it — zero new charge, zero duplicate ledger rows). Full
`tests/routes/registration.routes.test.js` run: 36/50 passing, 14 failing — reverified via
`git stash` as byte-identical to unmodified `develop` (34/48 passing, same 14 failures), the
already-documented pre-existing real-Stripe-minimum-charge/month-end-proration flakiness from
wall-clock-anchored fixtures, unrelated to this PR. Frontend: the register wizard's "Enroll for
next month" UI needed **no logic changes** — it was already built assuming a future-month
registration would report `prorated: false` (see its own pre-existing code comments), so this PR
makes that existing frontend behavior finally accurate rather than requiring new frontend work.
One stale test fixture was corrected: `app/parent/register/__tests__/page.test.tsx`'s
"Enroll for next month" preview mock encoded the OLD backend quirk (`prorated: true` structurally,
100% of class days remaining) — updated to the new real contract (`prorated: false` flat). Frontend
suite for the touched file: 28/28. `tsc --noEmit` clean. E2E (`e2e/parent-register.spec.ts`) needed
no changes — its mocks already returned `prorated: false` for the next-month path. Docs closed out:
ADR 007 addendum (this file's own D1 restated there for readers who land on the ADR first).

**Trigger incident:** viji.annadurai@gmail.com (staging) used "Enroll for next month" on 2026-08-30
and was charged **$403.82** instead of the expected 275 + 145 = $420. Root cause: the wizard's
"Enroll for next month" anchors `startDate` to the earliest real *session document* of next month
(Sept 3), while `computeProration` counts the *level's class weekdays* — a level weekday landing
Sept 1–2 counted as "missed," so the backend prorated 16/17 of September unconditionally
(275 × 16/17 = 258.82, + 145 fee). Second finding from the same audit: the parent portal's
"Last Charge" column reads `Subscription.lastChargeAmount` ($258.82, deliberately fee-free) — the
parent never sees the $403.82 that actually hit their card, and no parent-facing view reads the
`Registration` ledger for group classes at all.

---

## Context (verified against the code 2026-08-30)

- `feature/manual-charge-button` and `feature/pdf-invoices` are both **merged to `develop`** — this
  plan builds on `previewRenewal`/`chargeNow`, the Charge dialog, and `invoice.service.js` as they
  exist on `develop`.
- **Renewals run on no schedule** (owner decision 2026-08-30, manual-charge-and-pdf-invoice-plan):
  the superadmin Charge button is the intended charge path; `npm run renewals` remains available
  but unscheduled. Every guard in this plan must therefore hold for button-driven charges, not
  just batch runs.
- Charge-amount computation is already single-sourced and stays that way: `computeProration` →
  `calculateChargeAmount` → `resolveRegistrationFee`, shared verbatim by `create()`, the preview,
  and renewals. **This plan adds zero new charge math** — it adds a branching *rule* (D1), new
  *entry points* (D3–D5), and *display* read paths (D10–D11), all composing the existing SOT
  functions and `chargeFinalization.service.js`.
- The one-payment-per-month invariant already has three layers: Guard A (one active Subscription
  per student, DB index), the `nextBillingDate <= today` not-due gate inside `renewOne`
  (renewal.service.js:332), and Guard B (unique `(subscriptionId, periodStart)` over
  pending/completed ledger rows, with `renewOne`'s pre-check + self-heal). The Charge dialog
  already greys Confirm when not due. **The gap:** Guard B keys on the *exact* `periodStart`
  date; PR 2's mid-month-anchored rows (prorated-from-today, manual) would not collide with a
  same-month row anchored on a different day. D7 closes this at the DB level.
- `Setting.prorationEnabled` is deprecated and read by nothing (setting.service.js explicitly
  excludes it). Proration behavior is governed by ADR 007 + this plan's D1, never by that flag.

## The rule (D1, stated once)

> **Proration happens only when the chosen start date falls inside the current calendar month
> (Central time). A start date in any future month charges the full monthly fee, and the billing
> period is that entire calendar month (1st → 1st).**
>
> **And: one payment per subscription per calendar month, through every pathway — cron, Charge
> button (card, full or prorated), manual recording, and initial registration — enforced by a
> single DB index on the ledger.**

## Decisions

| # | Decision |
|---|---|
| D1 | **Explicit proration rule** (above). Current-month anchor → `computeProration` exactly as today, period `anchorDate → firstOfNextMonth`. Future-month anchor → full `monthlyFee`, `periodStart` = 1st of the anchor's month, `periodEnd` = 1st of the following month, `firstChargeProrated: false`. Registering on the 1st degrades gracefully (prorated = 100% = full fee) — no seam. The rule is generic over "any future month," not special-cased to "next month." |
| D2 | **The backend infers the branch from the anchor month — no new API field.** The wizard's picker only offers this-month days plus the "Enroll for next month" anchor, so anchor-month inference is exact, and it automatically covers any other caller. Sibling discount and registration fee apply identically in both branches (prorate-then-discount sequencing unchanged; the fee is never prorated or discounted, as today). |
| D3 | **Roster start ≠ billing period start.** The student joins the roster from their chosen first session (`anchorDate`, e.g. Sept 3); only the *paid-for period* is the whole month. `Subscription.currentPeriodStart` = billing period start (1st of month for the full-month branch). |
| D4 | **Charge dialog becomes two independent choices:** payment method — **"Charge card on file"** (Stripe, amount locked to the computed number) vs **"Record offline payment"** (admin enters amount, prefilled + editable, and a **required note**; no Stripe call) — × period covered — **"Full month"** (standard renewal: full fee + sibling rule, period rolls `currentPeriodEnd` → +1 month) vs **"Prorated from today"** (`computeProration` anchored today, period today → 1st of next month; the tool for lapsed/mid-month situations). Dunning bypasses both choices: the locked failed-row amount is retried as today (registration-ledger dunning policy). |
| D5 | **Manual payments live on the same ledger and the same funnel.** A manual recording creates a `pending` ledger row first, then finalizes it `completed` via the existing finalization path (`advanceSubscriptionPeriod` rolls the period, clears retry/dunning state) — no path ever writes a `completed` row directly, so Guards apply identically. New base-schema fields: `chargeMethod: 'card' \| 'manual'` (default `'card'`), `manualNote` (validation-required when manual), `recordedBy` (admin user id; also set on admin-triggered card charges for audit). Mutation contract in registration.model.js's header updated accordingly. |
| D6 | **Manual scope: `active` subscriptions only** (including in-dunning — a manual payment clears dunning). Reactivating a fully-cancelled subscription remains the existing Reactivate flow. Known, deliberately out-of-scope edge: an admin hard-cancels mid-month and the family re-registers the same month — that is a new subscription and a new charge, admin-mediated; a per-*student*-per-month DB lock would wrongly block legitimate cancel-refund-rejoin cases. |
| D7 | **Guard B re-keyed to the calendar month.** Subscription-cycle ledger rows gain a derived, immutable `periodMonth` (`'2026-09'`, computed from `periodStart` in Central **inside the model** — a pre-validate hook, so callers cannot get it wrong or disagree with `periodStart`). The unique partial index becomes `(subscriptionId, periodMonth)` over pending/completed rows (same `$exists` scoping idiom). "One payment per subscription per calendar month" is then a DB invariant across every pathway. Dry-run-first migration backfills `periodMonth` and swaps the index; the plain `(subscriptionId, createdAt)` query index is untouched. |
| D8 | **Already-paid gating reads the ledger, not just the Subscription.** `previewRenewal` additionally looks up the current Central month's pending/completed ledger row; when one is `completed`, the dialog greys **both** payment methods and states, from the row itself: *"September is already paid — $403.82 on Aug 30 (card). Next charge due Oct 1."* The backend `skipped_not_due` gate stays as the enforcement; the note is the ledger-sourced explanation. `renewOne`'s existing dedup pre-check + self-heal move to the `periodMonth` key. |
| D9 | **Receipts and invoices cover manual payments too.** A manual recording sends the receipt email with the PDF invoice attached (same never-blocks nested try/catch); `buildInvoiceData` renders the method — "Paid by card ····1234" vs "Payment recorded by academy — {note}". No new template: the existing receipt gains a method-aware line (block-based email system, docs/modules/email.md). |
| D10 | **Parent payment history reads the `Registration` collection only.** New `GET /registrations/history` (parent role): every ledger row for `parentId` across billing shapes, newest first — date, student, description (class + period, or private session date), amount, status, method, breakdown, invoice availability. New portal page **`/parent/billing`** renders it with per-row invoice download (the existing `GET /registrations/:id/invoice` endpoint, which already enforces parent ownership, finally gets UI). The table is a standalone `PaymentHistoryTable` component taking rows as props, so the admin user-detail page can mount it later with an admin endpoint — zero rework. |
| D11 | **Fix the "Last Charge" mislabel.** On `/parent/subscriptions`, "Last Charge" becomes **"Last Payment,"** sourced from the subscription's most recent `completed` ledger row (fee included — the $403.82 truth), enriched server-side in `registration.service.js`'s `listMine`. The live `currentCharge` stays as the clearly-labeled upcoming monthly rate. `Subscription.lastChargeAmount` remains internal billing state (recurring-only), no longer displayed as "what you paid." Admin `/admin/subscriptions` gets the same treatment. |
| D12 | **Superadmin-only, unchanged**, for both charge modes (route-level `requireRole('superadmin')` + in-page gate, as today). |
| D13 | **Three PRs, one feature branch each, executed 1 → 2 → 3.** PR 1 fixes live billing behavior; PR 2's prorated option reuses PR 1's clarified rule; PR 3 is display-only. Full backend + frontend suites and `tsc --noEmit` green before each is handed to the owner for local testing (Hard Rules 4–5). |

---

## PR 1 — Explicit proration rule

Branch: `feature/proration-month-rule`

### 1.1 Backend — `registration.service.js`

- `create()` and `previewChargeAmount()` branch on "anchor month == current Central month"
  (calendar-day comparison via the existing tz-aware utils in `utils/billingDates.js` /
  `utils/dateShapes.js` — no new date math primitives):
  - **Current month** → existing path verbatim (`computeProration`, period `anchor → firstOfNextMonth`).
  - **Future month** → skip `computeProration`; `feeForDiscountCalc = price.monthlyFee`;
    `prorationInfo`-equivalent breakdown records `prorated: false`; `currentPeriodStart` /
    ledger `periodStart` = 1st of the anchor's month; `periodEnd` = 1st of the following month;
    `firstChargeProrated: false`.
- `computeProration` itself is untouched — the rule lives at its two call sites' shared branch
  (extracted into one helper so create/preview cannot diverge).
- Roster join stays keyed on `anchorDate` (D3) — no change to roster-mutation call sites.

### 1.2 Frontend — register wizard (`app/parent/register/page.tsx`)

- "Enroll for next month" now displays the flat full-month price; this-month day pills keep the
  prorated preview. Both numbers come verbatim from `GET /registrations/preview` (unchanged
  contract — the response's `prorated: false` + full amount drive the label).
- Confirmation step copy distinguishes "Full month of {Month}" vs "Prorated from {date}".

### 1.3 Tests

- `tests/services/registration.service.test.js` (+ preview tests): future-month anchor → full fee,
  period = full calendar month, `firstChargeProrated: false`; current-month anchor → unchanged
  prorated behavior; 1st-of-month anchor → full fee via 100% proration (seam check).
- **The owner's edge case, pinned:** register on Aug 30 for September → `runRenewals()` on Sept 1
  produces zero candidates for that subscription and a direct `renewOne` returns
  `skipped_not_due`; `previewRenewal` returns `due: false`.
- Wizard tests for the label branch; **update `frontend/e2e/` register-wizard spec in the same PR**
  (CLAUDE.md pre-read rule — the wizard is touched).

### 1.4 Docs close-out

- Amend ADR 007 (`docs/decisions/007-calendar-month-billing.md`) with D1's rule and the trigger
  incident. Add this plan's row to CLAUDE.md's Documentation Map.

---

## PR 2 — Ledger month-guard + admin charge modes (card/manual × full/prorated)

Branch: `feature/charge-modes-and-month-guard`

### 2.1 Schema + migration (`registration.model.js`, `scripts/`)

- Base schema: `chargeMethod` (`'card' | 'manual'`, default `'card'`), `manualNote`
  (`String`, `default: null`; validation: required non-empty when `chargeMethod === 'manual'`),
  `recordedBy` (`ObjectId ref User`, `default: null`).
- Subscription-cycle discriminator: `periodMonth` (`String`, `'YYYY-MM'`), set in a pre-validate
  hook from `periodStart` in Central — never accepted from callers (D7).
- Guard B index swap: unique partial `(subscriptionId, periodMonth)` replaces
  `(subscriptionId, periodStart)`; same `status ∈ [pending, completed]` + `$exists` scoping.
- Migration script (dry-run-first, same discipline as `migrate-*.js` predecessors): backfill
  `periodMonth` on all subscription_cycle rows; verify zero duplicate
  `(subscriptionId, periodMonth)` buckets before creating the new index; drop the old one.
  Run on staging first, then production at ship time.

### 2.2 Backend — `renewal.service.js` + new manual path

- `previewRenewal`: additionally returns (when previewable and not in dunning)
  `options.fullMonth` and `options.prorated` — each `{ amount, breakdown, periodStart, periodEnd }`,
  computed via the same SOT functions (`resolveMonthlyFee` + `calculateChargeAmount` for full;
  `computeProration` then `calculateChargeAmount` for prorated) — plus `monthAlreadyPaid`
  (`{ paidAt, amount, chargeMethod } | null` from the current month's completed ledger row, D8).
- `chargeNow(subscriptionId, { period })`: `'full'` routes to `renewOne`/`retryOne` verbatim
  (unchanged); `'prorated'` routes to a new `chargeProratedNow` that mirrors `renewOne`'s guard
  sequence (fresh fetch → active check → month-paid ledger check → pending-row-first →
  `chargeAndFinalize`) with the prorated amount/period. Stripe/finalization mechanics stay solely
  in `chargeFinalization.service.js`.
- New `recordManualPayment(subscriptionId, { amount, note, period }, adminUser)`: same guard
  sequence, pending row (`chargeMethod: 'manual'`, `recordedBy`), no Stripe call, finalize
  completed via the existing finalization path (D5) — clears dunning state, sends receipt +
  invoice (D9). Validates `amount > 0` and non-empty `note`.
- `renewOne`'s dedup pre-check + self-heal query moves from exact `periodStart` to `periodMonth`.

### 2.3 Backend — routes/controller (`subscription.routes.js`)

- Extend the existing preview/charge endpoints for the `period` option; new
  `POST /subscriptions/:id/record-payment` — all `requireRole('superadmin')` (D12).

### 2.4 Frontend — Charge dialog (`app/admin/subscriptions/page.tsx`)

- Two-step dialog per D4: method radio (card / offline) × period radio (full / prorated), each
  period option showing its real dollar figure from the preview; manual mode exposes editable
  amount (prefilled) + required note field.
- When `monthAlreadyPaid` is set: both modes disabled, ledger-sourced note per D8. Dunning: options
  hidden, locked-amount retry flow exactly as today.

### 2.5 Invoice + email (`invoice.service.js`, email templates)

- Method-aware invoice line and receipt-email line (D9). Manual rows have no
  `stripePaymentIntentId` — `buildInvoiceData` must not assume one.

### 2.6 Tests

- Model: `periodMonth` derivation (incl. month-boundary sentinels), manual-note validation, index
  behavior — same-month different-day rows collide; failed rows don't block.
- Services: both `chargeNow` periods, `recordManualPayment` happy path / dunning-clear /
  month-already-paid rejection / inactive rejection; `previewRenewal` options + `monthAlreadyPaid`.
- Migration: dry-run vs live, backfill correctness, duplicate-bucket abort.
- Routes + dialog component tests for every new branch.

### 2.7 Docs close-out

- ADR 001 addendum (manual payments + month guard), `DATABASE_SCHEMA_DOCUMENTATION.md` (new
  fields + index), `docs/features/admin.md` (Subscriptions section rewrite of the Charge dialog),
  `docs/modules/email.md` (method-aware receipt line).

---

## PR 3 — Parent billing page

Branch: `feature/parent-billing-history`

### 3.1 Backend — `registration.service.js` + routes

- `listHistory(parentId)`: all ledger rows for `parentId` (every billing shape), newest first,
  populated for display (student name; subscription rows → schedule/class/level labels + period;
  per-session rows → session date + coach). Returns amount, status, `chargeMethod`, breakdown,
  `paidAt`/`createdAt`, and `invoiceAvailable` (completed rows). Route:
  `GET /registrations/history`, `requireRole('parent')` — registered **before** `/:id/invoice`
  patterns (the existing route-shadowing discipline in registration.routes.js).
- `listMine` enrichment for D11: `lastPayment` (most recent completed subscription-cycle row's
  `{ amount, paidAt, chargeMethod }`).

### 3.2 Frontend

- `PaymentHistoryTable` component (props-driven rows, no fetching inside — D10) + new page
  `app/parent/billing/page.tsx` in the portal nav ("Billing"), with per-row **Download invoice**
  hitting `GET /registrations/:id/invoice`.
- `/parent/subscriptions`: "Last Charge" → "Last Payment" from `lastPayment` (D11); upcoming
  monthly rate column unchanged. Same relabel on `/admin/subscriptions`.
- Private-lesson charge display on the subscriptions page may consolidate into the history table
  later; not removed in this PR.

### 3.3 Tests + docs close-out

- Service/route tests for `listHistory` (ownership scoping, shape mixing, ordering) and the
  `lastPayment` enrichment; component/page tests; `docs/features/parent-portal.md` (new page +
  nav), `docs/features/admin.md` (future-reuse note for the table), `docs/TEST_COVERAGE.md`
  refresh.

---

## Explicitly out of scope

- Admin user-detail page mounting `PaymentHistoryTable` (deliberately enabled by D10, built later).
- Refunds/credits as ledger rows; per-student-per-month cross-subscription locks (D6's edge).
- Scheduling the renewal job (stays an open deployment decision).
- Truing up In Mag's staging row ($403.82 vs $420) — staging data; in production the PR 2 manual
  tool is the correction path for anything similar.
