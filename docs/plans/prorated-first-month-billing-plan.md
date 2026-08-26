# Prorated First-Month Billing — Plan

**Status: DRAFT — awaiting owner confirmation.** Not yet approved for autonomous execution. Once the
owner reviews this document and replies `write`, the executing agent runs PR 1 → PR 2 in one
uninterrupted pass (same "auto mode" convention as `docs/plans/audit-system-plan.md` and
`docs/plans/ckq-parity-plan.md`), branching, testing, committing, pushing, opening a PR into
`develop`, and merging after each PR's own test gate passes — no per-PR check-in unless a gate
fails. If a gate fails, stop and report; do not weaken a test to get green.

## 0. Context

Every premium registration today charges the full monthly fee and grants a full rolling month of
access (`currentPeriodEnd = registrationDate + 1 month`), regardless of what day of the month
someone joins. Fencing is a physical space with a fixed weekly class calendar — someone joining on
the 25th shouldn't pay for (or be billed as if entitled to) days before they joined.

**The rule, as directed by the owner:**
- A student's first charge is prorated to the **class days remaining in the calendar month they
  register in** — not calendar days, not sessions they'd attend if premium-any-session, but the
  count of distinct weekdays that level actually holds a class on, from the registration date
  (inclusive) through month-end.
- Their first billing period ends at the end of that calendar month, not a rolling month out. They
  are only ever billed/entitled for the days remaining, matching physical access to a physical
  space.
- Every renewal after that is a full calendar month at the full price — proration only ever applies
  to the first, partial month.
- **Sequencing (owner-directed, confirmed):** proration is computed on the **raw** monthly list
  price first. The **result** of that proration is then the number handed into
  `calculateChargeAmount()` (the existing, unmodified sibling-discount function) — i.e., sibling
  discount is evaluated against "what this student actually owes this cycle" (their prorated
  amount), compared against siblings' own current standard rates, not against the raw unprorated
  list price.
- The one-time registration fee (already shipped) is unaffected — flat, unprorated, undiscounted,
  always added last.
- **Single source of truth, no duplication (owner-directed):** exactly one function computes
  proration. Every caller — the real charge and the pre-commit preview — calls that same function
  with the same inputs and gets the same answer. Nothing else (frontend included) ever
  re-derives or approximates this math.
- **Rollout safety:** an admin toggle (`Setting.prorationEnabled`, default `false`) gates all of
  this. Shipping the code changes nothing about any live charge until an owner deliberately turns
  it on — same pattern already proven for the registration fee.

## 1. LOCKED DECISIONS (do not reopen without an explicit owner conversation)

| # | Decision |
|---|---|
| D1 | Proration only ever applies to a registration's **first** charge/period. Every subsequent renewal is a full calendar month at full price, computed by the existing, **unmodified** `renewal.service.js` — no renewal-side changes at all. |
| D2 | Proration is computed on the **raw monthly list price**. That result feeds into the existing `calculateChargeAmount()` unmodified — sibling-discount eligibility compares "what I actually owe this cycle" (my prorated amount) against siblings' own current standard rates. `calculateChargeAmount.service.js` itself is **not touched** by this plan. |
| D3 | One function, `proration.service.js`'s `computeProration()`, is the only place this math ever runs. Called by `create()` and `previewChargeAmount()` only. `renewal.service.js` never calls it — renewals are always full months by design. The frontend never reimplements any of this math; it only displays whatever the backend returns. |
| D4 | "Class days" = distinct weekdays (`dayOfWeek`) across **every** `GroupClassSchedule` at the student's level, deduplicated — not just their one chosen "home" schedule. A level with schedules on Tue/Thu/Sat counts all three, matching that premium students can attend any of them. |
| D5 | No holiday/closure exclusion in this pass — Frisco has no `Holiday` model (unlike CKQ, which this was researched against). A documented v1 simplification, not an oversight. |
| D6 | Registering on the last day of the month still counts that day as "remaining" (inclusive) — no same-day cutoff logic. A documented v1 simplification. |
| D7 | A level with **zero** configured schedules cannot be meaningfully prorated — `computeProration()` returns `prorated: false` and the full, unprorated fee, rather than dividing by zero or blocking registration. |
| D8 | `Setting.prorationEnabled` defaults to `false`. No live charge changes on deploy; the owner turns it on deliberately, same rollout pattern as the registration fee. |
| D9 | `Subscription.firstChargeProrated` (Boolean) is a permanent audit record of whether *that specific* subscription's first charge was prorated — never recomputed or touched after creation, same spirit as `registrationFeeCharged`. |

## 2. The math, precisely

`proration.service.js`'s `computeProration({ levelId, monthlyFee, registrationDate })`:

1. Find every `GroupClass` at `levelId`, then every `GroupClassSchedule` referencing one of those
   classes. Collect their `dayOfWeek` values into a deduplicated set (e.g. `{2, 4, 6}`).
2. If that set is empty → return `{ prorated: false, totalClassDays: 0, remainingClassDays: 0,
   dailyRate: 0, proratedAmount: monthlyFee, periodEnd: addOneMonth(registrationDate) }` (D7 — falls
   back to exactly today's existing rolling-month behavior).
3. `totalClassDays` = count of calendar dates in the **full** month containing `registrationDate`
   whose weekday is in the set.
4. `remainingClassDays` = same count, restricted to dates `>= registrationDate` (inclusive, D6)
   through month-end.
5. `dailyRate = monthlyFee / totalClassDays`.
6. `proratedAmount = round2(dailyRate * remainingClassDays)`.
7. `periodEnd` = the last calendar date of `registrationDate`'s month, end-of-day.
8. Returns `{ prorated: true, totalClassDays, remainingClassDays, dailyRate, proratedAmount,
   periodEnd }`.

New generic date helpers in `billingDates.js` (not proration-specific — reused, not duplicated):
`daysInMonth(date)`, `endOfMonth(date)`.

## 3. `registration.service.js` integration

In `create()` (and mirrored exactly in `previewChargeAmount()` — D3):

```js
const now = new Date(); // moved earlier in create() so proration can use the real "now"

const settings = await settingService.getSettings();
let feeForDiscountCalc = price.monthlyFee;
let prorationInfo = null;

if (settings.prorationEnabled) {
  prorationInfo = await computeProration({
    levelId: groupClass.levelId,
    monthlyFee: price.monthlyFee,
    registrationDate: now,
  });
  feeForDiscountCalc = prorationInfo.proratedAmount;
}

// Unchanged call, unchanged function — just possibly a prorated input (D2).
const { amount: chargeAmount, siblingDiscountApplied, siblingDiscountAmount, reason: siblingDiscountReason } =
  await calculateChargeAmount(student, feeForDiscountCalc);

// Unchanged from the registration-fee PR.
const { amount: registrationFeeCharged, waived: registrationFeeWaived, reason: registrationFeeReason } =
  await resolveRegistrationFee(studentId);

const totalChargeAmount = chargeAmount + registrationFeeCharged;

const currentPeriodEnd = prorationInfo?.prorated ? prorationInfo.periodEnd : addOneMonth(now);
```

`Subscription.create()` gains `firstChargeProrated: prorationInfo?.prorated ?? false`.

**Response shape, both `create()` and `previewChargeAmount()` (identical fields, same guarantee
`siblingDiscountReason`/`registrationFeeReason` already have — preview can never structurally
disagree with the real charge):**

```js
{
  // ...existing fields (chargeAmount, totalChargeAmount, siblingDiscount*, registrationFee*)...
  prorated: boolean,
  totalClassDays: number | null,      // null when prorated is false
  remainingClassDays: number | null,
  dailyRate: number | null,
  periodEnd: string,                  // ISO date — "your plan covers/renews through this date"
                                       // present even when prorated is false, so the wizard can
                                       // always show a period-end date, not just on the prorated path
}
```

## 4. PR 1 — Backend: proration engine, wiring, admin API, docs

**Files:**
- `backend/src/models/setting.model.js` — add `prorationEnabled` (Boolean, default `false`).
- `backend/src/services/setting.service.js` — validate/persist the new field (same explicit
  `badRequestError` pattern as `registrationFee`).
- `backend/src/utils/billingDates.js` — add `daysInMonth`, `endOfMonth`.
- `backend/src/services/billing/proration.service.js` — **new**, `computeProration()` per §2.
- `backend/src/models/subscription.model.js` — add `firstChargeProrated` (Boolean, default `false`).
- `backend/src/services/registration.service.js` — wire per §3, both `create()` and
  `previewChargeAmount()`.
- `backend/src/services/mail.service.js`, `backend/src/email/templates.js`,
  `backend/src/email/layout.js`, `backend/src/email/text.js` — confirmation email itemizes
  "Prorated (`remainingClassDays` of `totalClassDays` class days)" as its own breakdown line when
  `prorated` is true, same conditional-line pattern the sibling-discount and registration-fee lines
  already use.
- `docs/decisions/001-in-house-subscription-billing.md` — new dated addendum (this is a real period-
  model change, not a footnote on an existing one).
- `DATABASE_SCHEMA_DOCUMENTATION.md` — `Setting.prorationEnabled`, `Subscription.firstChargeProrated`.

**Tests:**
- `backend/tests/services/billing/proration.service.test.js` (new) — pure math: a level with
  schedules on multiple weekdays; registering on the 1st (remaining == total, proratedAmount ==
  monthlyFee); registering on the last class day of the month; a level with zero schedules (D7
  fallback); a 28/29/30/31-day month each produce correct `totalClassDays`; rounding to cents.
- `backend/tests/routes/setting.routes.test.js` — extend for `prorationEnabled` (GET default, PATCH
  validation, partial-update doesn't clobber `registrationFee`).
- `backend/tests/routes/registration.routes.test.js` — real end-to-end Stripe tests: proration
  **off** (default) → byte-identical to current behavior, full month charged, `firstChargeProrated:
  false`; proration **on**, mid-month registration → real Stripe charge equals the prorated amount,
  `Subscription.currentPeriodEnd` is genuinely end-of-month (not a rolling month out),
  `firstChargeProrated: true`; proration **on** + sibling discount, mid-month registration →
  confirms D2's sequencing with real numbers (prorated amount is what the 10% is computed against,
  not the raw list price); preview and real charge produce identical `proratedAmount`/`periodEnd`
  (the same "preview never disagrees with reality" guarantee already proven for sibling discount and
  the registration fee).
- `backend/tests/email/renderEmail.test.js` — the new breakdown line shows/hides correctly.

**Gate:** `cd backend && TZ=UTC npm test` all green before opening the PR.

## 5. PR 2 — Frontend: full display, backend-is-the-brain throughout

Hard rule for this PR, restated because it's the whole point: **the frontend never computes,
estimates, or re-derives a prorated amount, a day count, or a period-end date.** Every number
displayed is read verbatim from a `GET/POST` response. If a number isn't in the response, it isn't
shown — it is never approximated client-side.

**`frontend/lib/types.ts`:**
- `Setting` gains `prorationEnabled: boolean`.
- `RegistrationPricePreview` and `RegistrationCreateResponse` both gain: `prorated: boolean`,
  `totalClassDays: number | null`, `remainingClassDays: number | null`, `dailyRate: number | null`,
  `periodEnd: string`.
- `Subscription` and `AdminSubscriptionRow` both gain `firstChargeProrated?: boolean`.

**`frontend/app/admin/settings/page.tsx`:**
- New checkbox: "Enable prorated first-month billing" next to the two existing fields. Same
  save/error/success flow already built.

**`frontend/app/parent/register/page.tsx`:**
- Level & Time step (where the sibling-discount preview line already renders): when
  `pricePreview.prorated`, show the real breakdown — *"`remainingClassDays` of `totalClassDays`
  class days remain this month — $`dailyRate`/day → $`chargeAmount`"* — sourced entirely from
  `pricePreview`.
- Review & Pay summary rail: an itemized "Prorated This Month" line (replacing/alongside "Monthly
  Fee" when `prorated` is true — never silently merged into it) plus a "Plan renews" line using
  `periodEnd` verbatim, so the parent knows exactly when full-price billing starts — no frontend
  date math (no `addOneMonth` reimplementation), just displaying the ISO date the backend already
  computed.
- Confirmation screen: same itemization using the real `create()` response — prorated amount, day
  counts, and `periodEnd`, plus the existing sibling-discount and registration-fee lines (all four
  can coexist on one confirmation).

**`frontend/app/admin/subscriptions/page.tsx`:**
- A small chip (matching the existing `10% sibling`/`Premium — any session` chip style) on rows
  where `firstChargeProrated` is true, so an admin can see at a glance which subscriptions started
  mid-month.

**`frontend/app/parent/subscriptions/page.tsx`:**
- Same chip, parent-facing, so a family can see their own child's first charge was prorated — not
  just admins.

**Tests:**
- `frontend/app/admin/settings/__tests__/page.test.tsx` — new toggle, save round-trip.
- `frontend/app/parent/register/__tests__/page.test.tsx` — prorated preview line, Review step
  itemization, confirmation screen itemization, and (regression) the **non**-prorated path renders
  exactly as it does today when `prorated: false`.
- `frontend/app/admin/subscriptions/__tests__/page.test.tsx` and
  `frontend/app/parent/subscriptions/__tests__/page.test.tsx` — chip shows/hides correctly.

**Docs:**
- `docs/features/admin.md` — Settings page gains the new toggle in its per-page spec.
- `docs/features/parent-portal.md` — Register wizard section documents the proration breakdown;
  Subscriptions page inventory row notes the new chip.

**Gate:** `cd frontend && TZ=UTC npm test` all green, `npx tsc --noEmit` clean, `npm run build`
clean before opening the PR.

## 6. Explicitly out of scope for this plan

- The sibling-discount "family slot" redesign discussed earlier in this session — paused by the
  owner, not part of this plan, not touched by it.
- Holiday/closure-aware day counting (D5).
- Retroactively migrating any already-active subscription's rolling `currentPeriodEnd` to a
  calendar-anchored one — this plan only changes the period shape for **new** registrations made
  while `prorationEnabled` is `true`. Existing subscriptions are untouched.
- Any change to `renewal.service.js` or the renewal cron's cadence/scheduling — noted as a future
  operational consideration (renewals will cluster around the 1st of the month once this is live at
  real volume), not addressed by code in this plan.
- Applying proration to private-lesson billing (already per-session, no monthly fee to prorate).

## 7. Final verification (both PRs)

- `TZ=UTC npm test` — backend and frontend, both green, real counts reported in the completion
  report.
- `npx tsc --noEmit` — 0 errors.
- `npm run build` (frontend) — clean.
- `git status --short` reviewed per PR — only the files this plan lists.
- Completion report: exact files touched per PR, real test counts, gates passed, and — critically —
  explicit confirmation that `prorationEnabled` defaults to `false` and was verified to leave
  today's behavior byte-identical when left off.
