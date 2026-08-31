# Booking Flow Sequential UX + Quote-Panel Consolidation Plan

**Status:** READY TO EXECUTE — not started
**Owner request date:** 2026-08-31
**Branches:** PR 1 `feature/preview-sibling-breakdown` (backend), PR 2 `feature/booking-flow-sequential` (frontend). PR 2 depends on PR 1's response shape but degrades gracefully without it (new fields are optional), so the PRs can be reviewed independently.

---

## 0. Executor pre-reads (mandatory, before touching anything)

Per `CLAUDE.md`'s pre-read table:

| Read | Because this plan touches |
|---|---|
| `docs/features/parent-portal.md` | Both parent-portal wizards + the flow kit |
| `docs/TESTING_STRATEGY.md` | Every test change below, **including its E2E section** — the register wizard and book-trial are on the "update the matching `frontend/e2e/*.spec.ts` in the same PR" trigger list |
| `docs/design-system.md` | The CTA-color change + flow.module.css edits |
| `docs/decisions/001-in-house-subscription-billing.md` + `docs/decisions/006-sibling-discount-family-rule.md` | The backend preview addition (PR 1) |

Hard rules that bite specifically here:

- **Hard Rule 7 — the backend is the source of truth for billing.** Every dollar figure, discount base, and sibling fee rendered in PR 2 must come verbatim from the API response. PR 2 adds ZERO arithmetic — that's exactly why PR 1 exists.
- **Hard Rule 8 — no `any` on domain data.** The new preview fields get real types in `frontend/lib/types.ts`.
- Stage files explicitly by name, never `git add .`.
- Write tests before the commit; wait for the owner to test locally before committing.

---

## 1. Owner's request (verbatim intent, 5 points)

1. **Trial flow sequential.** Today, picking a child hides the child picker (step 0 → step 1 replaces the left column) and requires a "Continue" click on the right. Wanted: click student name → level picker appears below → pick level → date picker appears below → the ONLY thing on the right is the final "confirm and book trial" action. Also: the CTA button on the right is currently "not a clear color" — fix it.
2. **Register flow: same sequential treatment.** Only the last step (Register & Pay) lives on the right; everything else stacks sequentially on the left.
3. **Kill the left-side proration sentence.** The "`X of Y class days remain this month — $Z/day → $A due today...`" paragraph on the left duplicates the right panel. Move the per-day amount into the right panel's Prorated row and delete the left paragraph entirely.
4. **Sibling discount transparency.** The right-hand payment preview ("the one card on the right") should list BOTH students with their amounts, and the discount line item should show the 10% against the lower purchase, so it's clear where the calculation comes from. The quote panel should carry every line item a parent needs.
5. **Footnote.** Add a small `*` footnote to the quote panel explaining the sibling-discount rule, e.g.: *"\* The 10% sibling discount always applies to the lower-priced plan in your family — the higher-priced plan is billed in full."*

---

## 2. Current state (verified against source 2026-08-31)

### The CTA color bug (point 1)
`frontend/app/components/portal/flow/OrderSummary.tsx:76` renders the CTA as `<Button fullWidth ...>` — the default `primary` variant = `--color-ink` (dark navy) — sitting inside `.summary`, which is `background: var(--color-navy-deep)` (`#00142f`, `flow.module.css:174-179`). Navy button on navy panel. The Button kit already has an `accent` variant (`Button.module.css:94-102`): solid crimson `#b51726`, the WP site's own CTA color, with a defined hover (`--color-accent-hover`). **Fix = pass `variant="accent"` on the OrderSummary CTA.** This also changes `register-private`'s CTA (third consumer of OrderSummary) — intentional, consistent.

### The step-split problem (points 1–2)
- `frontend/app/parent/book-trial/page.tsx` — `STEPS = ['Who', 'Pick a Level', 'Confirmation']`; `step` state 0/1/2. Step 0 renders only `ChildPickerCards`; the summary CTA reads "Continue" (`onCta = () => setStep(1)`). Step 1 replaces the left column with the level `<select>` + session `PillRow` + a "Back" button.
- `frontend/app/parent/register/page.tsx` — same shape, `STEPS = ['Who', 'Level', 'Done']`, except picking a child auto-advances (`handleStudentSelect` calls `setStep(1)`), which is what makes the child's name "vanish". The `?child=` deep link also calls `setStep(1)`.

### The duplicated left-side money copy (points 3–4)
`register/page.tsx` lines ~572–585, inside the "Choose your start date" `FlowSection`:
- a sibling-discount paragraph (`10% sibling discount applied — $X/month`) or the `siblingDiscountReason` sentence,
- a next-month full-price sentence,
- the proration sentence (`X of Y class days remain this month — $Z/day → $A due today. Full price starts <date>.`).

All of these are already represented (or belong) in the right-hand `OrderSummary` quote panel. They all get deleted from the left.

### What the preview API can't say yet (point 4)
`GET /registrations/preview` (`backend/src/services/registration.service.js` → `previewChargeAmount`, lines ~465–542) returns only this child's `siblingDiscountAmount` + a `siblingDiscountReason` sentence. It does **not** return the siblings' names or fees, so the frontend cannot list both students. `calculateChargeAmount` (`backend/src/services/billing/calculateChargeAmount.service.js`) already loads each sibling's full `User` doc inside `gatherSiblingFees()` and already computes the discount base (`base = Math.min(feeNow, topSiblingFee)`, line ~130) — the data exists server-side; it just isn't returned.

Key subtlety the executor must preserve: in the preview/registration path, `feeNow` passed to `calculateChargeAmount` is `prorationInfo.proratedAmount` — the discount base can therefore be the *prorated* amount, not the sticker monthly fee. Display it verbatim; never re-derive it.

---

## 3. Design decisions

- **D1 — Sequential = derived visibility, not step navigation.** Both wizards drop the internal 0/1 step split. The left column always renders every applicable section, each one appearing only once its prerequisite selection exists (plain conditional rendering, exactly how the "Choose your start date" section already appears only when `levelId` is set). The `step` state variable goes away; the confirmation screen is gated on the existing `booked`/`registered` state being non-null. The `FlowStepper` stays, with `current` **derived**: `0` while no child is selected, `1` once a child is selected, `2` on the confirmation screen. `STEPS` labels unchanged.
- **D2 — Section order.** Trial: Child → Level (`<select>`, unchanged control) → Session pills. Register: Child → Level cards → Start date → Payment method (still gated on `sessionId`, unchanged). The child picker never disappears; the selected card stays highlighted (`.childCardSelected` already handles this).
- **D3 — One CTA, on the right, always the final action.** Trial: `Book Trial Class`, disabled until `sessionId`. Register: `Register & Pay`, disabled until `!sessionId || !selectedPrice || !paymentMethod` (unchanged condition from today's step-1 branch). No "Continue" CTA anywhere; the "Back" buttons are deleted (changing your mind = clicking a different card/pill — selections are all still on screen).
- **D4 — CTA color.** `OrderSummary` renders its CTA with `variant="accent"`. Shared-component change, applies to all three flows (trial, register, register-private) — intentional.
- **D5 — Deep link.** `?child=<id>` still just sets `studentId` (delete the `setStep(1)` call in register). The derived stepper then shows step 1 automatically.
- **D6 — Changing the child mid-flow keeps level/date selections.** The preview effect already re-fires on `studentId` change and refreshes the quote for the new child. No reset logic added. (Changing the *level* still clears `sessionId`, unchanged.)
- **D7 — Backend sibling breakdown is additive and display-only.** `calculateChargeAmount` (registration mode only) additionally returns `siblingComparison` (each counted sibling's name + current monthly fee) and `discountBase` (the exact `base` the 10% was taken from — already computed). Renewal mode is untouched; existing callers destructure named fields and ignore extras. `previewChargeAmount` passes both through. `create()` (the real charge) is NOT changed — the confirmation screen keeps its existing lines; this breakdown is for the pre-payment quote panel only. Zero change to any dollar computation anywhere.
- **D8 — The quote panel shows the family math.** When `siblingComparison` is non-empty and a discount applies, the panel lists each sibling (`<Name> — current plan` / `$<fee>/mo`), and the discount row's label becomes `Sibling Discount (10% of $<discountBase>)*`. In the bridge case (new child is the higher payer) this reads e.g. `(10% of $150)` while the new child's own fee is $200 — the math source is visible without explanation. The existing `siblingDiscountReason` note line stays as-is.
- **D9 — Prorated row carries the rate.** The right panel's Prorated row value becomes `"<remaining> of <total> class days · $<dailyRate>/day"` (all three values straight from the preview). Still suppressed for a next-month enrollment (existing `isNextMonthEnrollment` logic, unchanged).
- **D10 — Footnote.** When the sibling-discount row is shown, pass OrderSummary's existing `note` prop: `* The 10% sibling discount always applies to the lower-priced plan in your family — the higher-priced plan is billed in full.` The `note` slot already renders as small muted text at the panel's bottom (`.summaryNote`); no new component or CSS needed.

---

## 4. PR 1 — backend: sibling breakdown in the registration preview

**Branch:** `feature/preview-sibling-breakdown`

### 4.1 `backend/src/services/billing/calculateChargeAmount.service.js`

1. `gatherSiblingFees(student)` — each entry gains the sibling's display name. The sibling `User` doc is already in scope in the loop; add `firstName`/`lastName` (or a single `name: \`${sibling.firstName} ${sibling.lastName}\``) to the pushed entry. Keep `studentId`, `fee`, `createdAt` untouched.
2. Registration-mode return (the `mode === 'registration'` block) gains two additive fields:
   - `siblingComparison`: array of `{ studentId, studentName, monthlyFee }` — one row per counted sibling entry (i.e. the same entries that drove the discount; do not re-query).
   - `discountBase`: the existing `base` local (`Math.min(feeNow, topSiblingFee)`).
3. The no-siblings early return and the renewal-mode returns are **unchanged** (they may omit the new fields entirely — callers must treat them as optional).
4. Do NOT touch any amount math, rounding, tiebreak, or reason string.

### 4.2 `backend/src/services/registration.service.js` — `previewChargeAmount` only

Destructure the two new fields from the `calculateChargeAmount` result and add them to the returned preview object:

```js
siblingComparison: siblingComparison ?? [],
discountBase: discountBase ?? null,
```

`create()` and everything else in this file: untouched.

### 4.3 PR 1 tests

Per `docs/TESTING_STRATEGY.md` (real ephemeral Mongo, never model mocks; fixtures via real `.create()`):

- `backend/tests/services/billing/calculateChargeAmount.service.test.js` — extend the existing registration-mode describe blocks:
  - normal case (registering child has the lower fee): `siblingComparison` lists the sibling with the correct name + monthly fee; `discountBase` equals the registering child's own fee.
  - bridge case (registering child is the new top payer): `discountBase` equals the sibling's lower fee; comparison row still correct.
  - no active siblings: the new fields are absent/empty and the return is otherwise identical to before (regression guard that the early return didn't change).
  - renewal mode: assert the result does NOT need the new fields (existing renewal tests keep passing unmodified — if any renewal test breaks, the change leaked out of registration mode).
- `backend/tests/routes/registration.routes.test.js` — the existing `GET /registrations/preview` assertions gain `siblingComparison`/`discountBase` checks on a sibling-discount fixture family (route-level proof the fields survive the controller). **Note:** this suite hits real Stripe TEST mode by design (do not mock it) and has a documented pre-existing failure block unrelated to this work (see `CLAUDE.md`'s manual-charge row) — verify any red test is pre-existing via `git stash`, exactly as prior plans did.
- Date rules apply: run under `TZ=UTC`; no real-clock sampling against "today"-relative fixtures without fake timers.

### 4.4 PR 1 verification

```bash
cd backend && TZ=UTC npm test
```

Full suite green (modulo the documented pre-existing registration-routes failures, independently reverified via `git stash`).

---

## 5. PR 2 — frontend: sequential wizards + consolidated quote panel

**Branch:** `feature/booking-flow-sequential`

### 5.1 `frontend/lib/types.ts`

`RegistrationPricePreview` gains (optional, so the wizard renders fine against a backend that predates PR 1):

```ts
export interface SiblingComparisonEntry {
  studentId: string;
  studentName: string;
  monthlyFee: number;
}
// on RegistrationPricePreview:
siblingComparison?: SiblingComparisonEntry[];
discountBase?: number | null;
```

### 5.2 `frontend/app/components/portal/flow/OrderSummary.tsx`

One-line change: the CTA `Button` gets `variant="accent"` (D4). Nothing else.

### 5.3 `frontend/app/parent/book-trial/page.tsx` (D1–D3, D5)

- Delete the `step` state and both `setStep` call sites for 0/1. Confirmation screen renders when `booked !== null` (it's already only set on success).
- Left column (always, top to bottom): the "Who is this trial for?" `FlowSection` with `ChildPickerCards`; then, when `studentId` is set, the "Choose a level" `FlowSection`; then, when `levelId` is set, the "Choose a session" `FlowSection` (existing loading/empty/PillRow states unchanged). Delete the "Back" button.
- Summary: lines unchanged (Child / Session); CTA is always `Book Trial Class`, `ctaDisabled={!sessionId}`, `onCta={handleSubmit}`.
- Stepper: `current` derived — `booked ? 2 : studentId ? 1 : 0`.

### 5.4 `frontend/app/parent/register/page.tsx` (D1–D3, D5–D10)

- Same de-stepping: delete `step` state, `handleStudentSelect`'s auto-advance becomes plain `setStudentId`, the `?child=` effect drops `setStep(1)`, confirmation gates on `registered !== null`, "Back" button deleted. Stepper `current` = `registered ? 2 : studentId ? 1 : 0`.
- Left column order: Who → Choose your level → Choose your start date (gated on `levelId`) → Payment method (gated on `sessionId`) — all existing section internals unchanged.
- **Delete** the three left-side money paragraphs inside the start-date section (the sibling-discount `<p>`s and the next-month/proration `<p>`s, currently lines ~572–585). The "First class: ..." / "Next month's schedule isn't posted yet" helper text under the Enroll-for-next-month button stays — it's scheduling info, not money.
- Summary lines (`summaryLines`) changes, all verbatim from `pricePreview`:
  - When `pricePreview?.siblingDiscountApplied` and `siblingComparison` has entries, insert one row per sibling **above** the discount row: label `` `${entry.studentName} — current plan` ``, value `` `$${entry.monthlyFee}/mo` ``. (The registering child's own fee is already the `Monthly Fee` row.)
  - Discount row label becomes `` `Sibling Discount (10% of $${...discountBase...})*` `` when `discountBase` is present, falling back to today's plain `Sibling Discount` label when it isn't (backend not yet updated). Value unchanged (`-$X`, `kind: 'discount'`).
  - Prorated row value becomes `` `${remainingClassDays} of ${totalClassDays} class days · $${dailyRate.toFixed(2)}/day` `` when `dailyRate` is non-null (D9).
  - Pass `note={SIBLING_NOTE}` to `OrderSummary` only when the discount row rendered, where `SIBLING_NOTE = '* The 10% sibling discount always applies to the lower-priced plan in your family — the higher-priced plan is billed in full.'` (D10).
- CTA: always `Register & Pay`, `ctaDisabled={!sessionId || !selectedPrice || !paymentMethod}`, `onCta={handleSubmit}`.
- Confirmation screen: unchanged (D7).

### 5.5 PR 2 unit tests (Jest + MSW, per `docs/TESTING_STRATEGY.md`)

Mock at the network boundary only (MSW); `userEvent.setup()` for all new interactions; typed fixtures against `lib/types.ts`; assert rendered text/ARIA, never class names or "mock was called".

`frontend/app/parent/book-trial/__tests__/page.test.tsx`:
- Rewrite the walk-through test: no "Continue" click — pick child, level select appears; pick level, session pills appear; CTA enables; submit posts `{ studentId, sessionId }` (assert via MSW-captured body).
- Replace "back-navigation preserves the selected child" with the sequential equivalent: after picking level + session, the child card is still on screen and still `aria-checked` — and clicking a *different* child keeps the flow (sections still visible).
- New: CTA reads "Book Trial Class" from the start and is disabled until a session is picked (no "Continue" ever rendered — regression guard, `queryByRole('button', { name: 'Continue' })` is null).
- `?child=` deep-link test: child preselected AND the level section already visible.
- Keep: level-name regression block, inline-error-without-crashing (assert the flow stays on the form, not "same step").

`frontend/app/parent/register/__tests__/page.test.tsx`:
- Same de-stepping rewrites: the auto-advance test becomes "selecting a child reveals the Level section below, child picker still visible"; the deep-link test asserts the same; the back-navigation test is replaced as in book-trial; the CTA-disabled test now also asserts the CTA label is `Register & Pay` from the start and no "Continue" exists.
- "never shows the payment-method section before a start date is chosen" — keep, still true by D2.
- New, in the sibling-discount describe: with a preview response carrying `siblingComparison: [{ studentName: 'Ethan Doe', monthlyFee: 200, ... }]` and `discountBase: 150`, assert the panel renders `Ethan Doe — current plan`, `$200/mo`, a discount row labeled `Sibling Discount (10% of $150)*`, and the footnote text — and that NONE of the deleted left-side paragraphs render (e.g. `queryByText(/10% sibling discount applied/)` is null).
- New: preview without the new fields (backend predates PR 1) still renders the plain `Sibling Discount` row — no crash, no `undefined` in the label.
- Proration describe: the summary-row assertion becomes `17 of 22 class days · $19.09/day` (fixture-matched), and the old left-side `$/day → $ due today` sentence is asserted absent.
- The server-verbatim quote regression guard test: extend its fixture with the new fields so it keeps proving zero client-side recomputation.
- `frontend/app/components/portal/flow/__tests__/flow.test.tsx`: no color assertion (never assert variant class names) — but if it asserts the CTA renders/fires, it must keep passing unchanged.

### 5.6 PR 2 E2E updates (same PR — mandatory per the pre-read table)

- `frontend/e2e/parent-register.spec.ts` — this spec exists precisely because a removed "Continue" button once broke the wizard silently (its D9 comment). Update the walk: pick child (no auto-advance assertion), pick level, pick date, assert `Register & Pay` enabled state, submit. Both date-picker states (`page.clock`-pinned) and the declined-charge case keep their substance; only the navigation steps change. Update the D9 comment to note the flow became sequential by design in this plan (so a future reader doesn't "fix" the missing Continue).
- `frontend/e2e/holiday-blocking.spec.ts` — lines ~119–120 click `Continue` in the trial wizard; replace with the sequential interaction. Both wizard-picker holiday assertions keep their substance.
- Mock fixtures (`frontend/e2e/fixtures/mock-api.ts`): the preview mock gains `siblingComparison`/`discountBase` if any spec renders a discount case (keep shape in sync with PR 1's real response).
- No changes needed to `login/admin-shell/coach-attendance/public-site` specs.

### 5.7 PR 2 verification

```bash
cd frontend
npx tsc --noEmit
TZ=UTC npm test
npm run build
npm run test:e2e
```

All green before handing to the owner for local testing. **Do not commit until the owner has tested locally and said so** (Hard Rule 5).

---

## 6. Docs close-out (with PR 2, or a follow-up docs commit)

- `docs/features/parent-portal.md` — the flow-kit / wizard sections: describe the sequential (derived-visibility) pattern, the single final CTA, and the quote panel's family breakdown + footnote.
- `docs/design-system.md` — if it documents OrderSummary/the flow kit, note the CTA is the `accent` variant on the navy panel.
- `CLAUDE.md` — add/replace the Documentation Map row for this plan with its outcome status.
- This file — flip **Status** and add per-PR completion notes (what was built, suite counts, anything found mid-build), matching the repo's established plan-close-out style.

## 7. Explicitly out of scope

- Any change to charge math, proration math, discount math, or the real-charge (`create()`) response.
- The confirmation screens' line items (unchanged).
- `register-private`'s flow structure (it only inherits the CTA color via OrderSummary).
- The admin side, emails, and the live-audit scripts (`audit/` drives the real staging DOM — if the owner later reports the audit script failing on the new DOM, that's a known consequence to fix in `audit/run-registration-audit.js`, not a regression in this work).
