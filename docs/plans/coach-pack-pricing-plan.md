# Coach Pack Pricing Plan — private-lesson packs move to the coach contract

**Status:** BOTH PRs MERGED TO `develop` 2026-09-25 (#102 backend, #103 frontend); the owner is testing on staging; production not promoted. §4's read-only checks passed on staging and production before the merge. §7 lists every as-built divergence. Spec'd 2026-09-24 from the current code (every file named below was
checked against the tree, not assumed); owner decisions D7 and D8 settled 2026-09-24. Reviewed the
same day against the tree, `docs/TESTING_STRATEGY.md`, `docs/design-system.md`,
`docs/features/admin.md` and `docs/features/parent-portal.md`; the 13 findings are folded in below
and listed in §6.

**Goal:** Private-lesson packs become each coach's own offer, priced as a **fixed total** ("10 ×
30-minute lessons for $300"), set on the coach's contract — replacing today's academy-wide,
percent-off pack list in Admin → Settings. The contract already decides what a parent pays (its
hourly rate × the lesson length); packs belong on the same record.

**Builds on:** `docs/plans/private-class-per-session-booking-plan.md` (ADR 011). Read
`docs/features/private-class.md` first — this plan changes only how a purchase is *priced*, not how
it is booked, charged, or cancelled.

**Builder pre-reads (CLAUDE.md):** `docs/features/private-class.md`, `docs/features/admin.md`
(Coach Contracts page), `docs/decisions/001-in-house-subscription-billing.md` + ADR 011 (billing),
`docs/TESTING_STRATEGY.md` (incl. "Real Stripe in tests" and the E2E section — the wizard and the
admin nav are covered by `frontend/e2e/private-booking.spec.ts`), `docs/design-system.md`,
`DATABASE_SCHEMA_DOCUMENTATION.md`, `docs/modules/email.md`.

---

## §0 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Packs live on `CoachContract`**, as a list: `{ _id, sessionDurationMinutes, quantity, price }`. | The contract is already the one source of what a parent pays for that coach. Different coaches price packs differently. |
| D2 | **A pack has a fixed total `price`** — no percent, no "dollars off". | A fixed price expresses any discount a coach wants, and it is the exact number the parent sees and pays. One pricing style, one formula. |
| D3 | **A pack is for one lesson length.** It is offered only on slots of that length. | A fixed price only means something for a known length (Chris offers 30- and 60-minute slots). Credits already work this way — a 30-minute credit cannot book a 60-minute slot — so a pack and the credits it buys always agree. |
| D4 | **The parent's request carries a `packId`, never a price.** No `packId` means a single session at the contract's normal rate. The backend looks the pack up on the coach's *active* contract, checks it matches the slot's length, and charges its price. | Hard Rule 7: a price from the browser could be edited. Today's request already sends a choice (`quantity`), not an amount; `packId` replaces it. |
| D5 | **The money lives only on the `Registration` row.** It keeps `quantity`, `unitPrice` (the single-session price at purchase) and `amount` (what was charged = the pack price). **`discountPercent` is removed** from both `Registration` (`per_session`) and `PrivateClassEnrollment`; the enrollment gets **no** price field. | `Registration` is the single money record (ADR 004/011). The enrollment is the credit balance and must not repeat the price. |
| D6 | **Savings are computed, never stored:** `quantity × unitPrice − amount`, by one function in `utils/privateClassPricing.js`, used by the quote, the parent's purchase list, the admin list, the invoice and the email. | A stored savings figure could disagree with what was charged. Derived from the immutable ledger fields, it cannot. |
| D7 | **Packs are editable on the active contract** (`PUT /coach-contracts/:id/packs`) without creating a new contract. The rate stays immutable (a rate change is still a new contract, which carries the packs over unless the admin changes them). **A pack keeps its `_id` only when nothing about it changed**: `updatePacks` preserves an incoming `_id` only if the stored pack with that id has the same length, quantity and price; any edited pack gets a new id. *Owner-confirmed 2026-09-24; id rule added in review.* | Changing one pack price should not mean re-entering the whole contract. Past purchases are safe either way: each one's price is pinned on its `Registration` row. The id rule is what makes D11 hold for an *edited* pack — without it, a parent quoted $300 could pay $310 because the id still resolved. |
| D8 | **Pack validation (backend only):** `quantity` a whole number ≥ 2; `sessionDurationMinutes` ≥ 15; `price` a whole number of cents (`$300.005` is refused); no two packs with the same length and quantity; and the **price band**, defined to the cent so the preview and the save can never disagree — with `subtotal = quantity × single price` (the single price is already whole cents, `computeSessionPrice` rounds): `min = ceilToCents(subtotal × PACK_PRICE_FLOOR_RATIO)`, `max = subtotal − 0.01`, valid iff `min ≤ price ≤ max`. `PACK_PRICE_FLOOR_RATIO = 0.5`. Above `max` overcharges the parent for choosing a pack (**ceiling**); below `min` almost certainly is a typo — e.g. the single price entered as the pack price — and undercharges the academy (**floor**). Either violation is a 400 naming the pack and the allowed range (`"10 × 30 min: price must be between $162.50 and $324.99"`). *Owner-confirmed 2026-09-24; cent rules added in review.* | Both mistakes are silent money errors: one against the family, one against the academy. The rule runs where the rate is known — on the contract. The 50% floor is one named constant in `utils/privateClassPricing.js`, changed in one place if the academy ever wants deeper packs. `ceilToCents` on `min` matters: a $65/hr coach's 45-minute 3-pack has a $146.25 subtotal, so half is $73.125 — the rule "at least half" must read $73.13, and the message must show the same number the check uses. |
| D9 | **A rate change can invalidate a pack.** When a new contract is created, each carried-over pack is re-checked against D8's band; a pack now outside it is refused (400) and the admin adjusts it in the same form. The **create dialog prefills its pack rows from the coach's current active contract and always sends the list explicitly**; the API's own carry-over (when `privateLessonPacks` is omitted from the request) is the default for a caller that sends none, not a path the dialog relies on. | Keeps D8 true for the life of every pack, not only at first save. Naming the prefill avoids a dead carry-over branch that the UI never exercises. |
| D9a | **The pack editor previews every pack as the admin types**: per-lesson price, savings in dollars and percent, and — when the price is outside D8's band — the reason it would be refused, with the allowed range. The figures come from the backend (`POST /coach-contracts/pack-quotes`, D8's own validation and the one savings formula), never from arithmetic in the form. **If the preview call fails**, the affected rows show a compact inline error ("Preview unavailable") and **Save stays enabled** — the preview is guidance; the backend's 400 on save is the rule, and it is shown verbatim in the dialog. *Owner-confirmed 2026-09-24; failure state added in review.* | A typo is visible before saving, and the preview can never disagree with what saving (or a parent's purchase) will actually do. Hard Rule 7 keeps pricing math off the frontend. A failed query renders inline, never blocks (`docs/design-system.md`). |
| D10 | **`Setting.privateClassPackages` and its Settings-page editor are removed.** | One home for pack terms. Nobody has saved packs anywhere yet (§4 verifies), so no data moves. |
| D11 | **The purchase endpoint rejects a pack that no longer exists or no longer matches** (edited or removed between the quote and the purchase — with D7's id rule, "edited" always means "the id is gone") with 409 "This pack is no longer offered — please review the prices". The wizard handles it through its **existing submit-error path** — the inline error with the "Pick another date" action, which already refetches the open dates and the quote — exactly as it handles a 402 decline or a slot-taken 409 today. No new step navigation. | The parent must never be charged a price other than the one they were shown. One submit-error recovery, not two (`docs/features/parent-portal.md`, "Book a Private Lesson"). |
| D12 | **Out of scope:** per-coach single-session prices other than the hourly rate, pack expiry, packs usable across coaches, coupons. | Each is additive on this model. |
| D13 | **Who sets packs widens from superadmin to admin + superadmin.** Today packs live on `/admin/settings` (superadmin-only, `setting.routes.js`). On the contract they are edited through `POST /coach-contracts`, `PUT /coach-contracts/:id/packs` and previewed through `POST /coach-contracts/pack-quotes`, all `ADMIN_ROLES` like every other contract route. *Added in review — an explicit decision, not a side effect.* | An admin already sets the hourly rate on the same record, which decides what a family pays per lesson; a pack price is the same class of number. Keeping packs superadmin-only while the rate is admin-editable would protect nothing. |
| D14 | **One home for each new thing** (the repo's single-source-of-truth rule, `docs/plans/duplication-cleanup-plan.md`): (a) `validatePacks` is built on `describePack` — one band check, one message; (b) `describePack` takes its savings from `quotePurchase` — one savings formula; (c) the figure `quantity × single price` has one name, `subtotal`, everywhere (never `singlesTotal`); (d) a pack offer has **one shape** — `purchaseOptionsFor`'s output is returned unchanged by both the quote and the public listing, typed once on the frontend as `PrivatePurchaseOption`; (e) one `PackEditor` component owns the rows, the debounce, the preview call and the per-row error, rendered by both the create dialog and the Edit-packs dialog; (f) one `useDebouncedValue` hook in `lib/hooks/`, used by the editor and swapped into the one existing inline debounce (`/admin/subscriptions`' search box) in the same PR; (g) every new pack display string lives in `lib/privateLessons.ts`; (h) the email's and the invoice's purchase lines come from one `purchaseBreakdown(row)`. | Each of these would otherwise be a second copy of something that already has, or is about to get, one home. |

---

## §1 PR 1 — Backend (`feature/coach-pack-pricing-backend`)

### 1.1 `backend/src/models/coachContract.model.js`

```js
privateLessonPacks: {
  type: [{
    sessionDurationMinutes: { type: Number, required: true, min: 15 },
    quantity: { type: Number, required: true, min: 2 },
    price: { type: Number, required: true, min: 0.01 },
  }],
  default: [],
},
```

Each pack keeps Mongoose's default `_id` — that is the `packId` the parent's request carries.
Validation beyond the schema lives in the pricing util (1.3), called by the contract service.

### 1.2 `backend/src/services/coachContract.service.js`

- `create({ ..., privateLessonPacks })` — validates packs against the new contract's rate via
  `validatePacks` (1.3). D9: if `privateLessonPacks` is omitted, the coach's previous active
  contract's packs carry over and are validated against the new rate (the dialog always sends the
  list; this is the API default). Carried-over packs are new subdocuments with new ids.
- **New** `updatePacks(contractId, packs)` — active contract only (409 `conflictError` on an
  inactive one); replaces the list after `validatePacks`. **Id rule (D7):** for each incoming pack
  that carries an `_id`, the id is kept only if the stored pack with that id has the same
  `sessionDurationMinutes`, `quantity` and `price`; otherwise the `_id` is dropped and Mongoose
  mints a new one. An unchanged pack therefore keeps its id (an in-progress quote stays valid); an
  edited one gets a new id (an in-progress quote fails D11 instead of charging the new price).
- **New route** `PUT /coach-contracts/:id/packs` (`ADMIN_ROLES`, D13) + controller
  (`next(error)` like every controller since PR B).
- **New** `quotePacks({ studentBillingRate, packs })` + route `POST /coach-contracts/pack-quotes`
  (`ADMIN_ROLES`, D9a/D13) — writes nothing, is a plain `describePack` per submitted pack (1.3).
  Returns, per pack, `{ sessionDurationMinutes, quantity, price, perLessonPrice, subtotal, savings,
  savingsPercent, allowedRange: { min, max }, error }` (`error` null when the pack is valid, else
  the exact message a save would return — same function, so it cannot differ). The editor calls it
  (debounced) as the admin types; it takes the rate from the form so it also works while creating
  a contract.
- Every error here goes through `utils/errors.js` (`badRequestError` for a D8 violation,
  `conflictError` for an inactive contract) — the pricing util throws plain `Error`s and the
  service wraps them, the same split `setting.service.js` uses today.

### 1.3 `backend/src/utils/privateClassPricing.js` — the one home of pack rules

Replace the percent functions (`computePackSubtotal`, `computePackTotal`, `computePackQuote`,
`normalizePackageOffers`, `resolvePackOptions`, `MAX_PACK_DISCOUNT_PERCENT`) with:

Built bottom-up so each rule exists once (D14 a–c, h):

- `computeSessionPrice(hourlyRate, durationMinutes)` — unchanged. `roundToCents` stays; add
  `ceilToCents` and `isWholeCents` beside it.
- `PACK_PRICE_FLOOR_RATIO = 0.5` — D8's floor, the only place it is defined.
- `quotePurchase(unitPrice, { quantity, price })` → `{ quantity, unitPrice, subtotal, savings,
  total }` — `total` is the pack price (or `unitPrice` for a single session); `subtotal = quantity ×
  unitPrice`; `savings = subtotal − total`. **The only savings formula (D6)** — everything below
  calls it.
- `packPriceBand(hourlyRate, { sessionDurationMinutes, quantity })` → `{ subtotal, min, max }` per
  D8 (`min = ceilToCents(subtotal × PACK_PRICE_FLOOR_RATIO)`, `max = subtotal − 0.01`) — the one
  definition of the allowed range.
- `describePack(hourlyRate, pack)` → the D9a preview fields for one pack: `packPriceBand` for the
  range, `quotePurchase` for `subtotal`/`savings`, plus `perLessonPrice` and `savingsPercent`
  (rounded to a whole percent). Never throws — the D8 checks (quantity, length, whole cents, band)
  produce `error`, a string naming the pack and its allowed range, or `null`. **This is the one
  band check.**
- `validatePacks(packs, hourlyRate)` — maps every pack through `describePack`, throws the first
  `error` (plain `Error`), also rejects a duplicate length+quantity, and returns the normalized list
  (sorted by length, then quantity). No arithmetic of its own.
- `purchaseOptionsFor(contract, durationMinutes)` → the single session, then the contract's packs
  of that length, each as `{ packId, ...quotePurchase(...) }` (`packId: null` for the single).
  **The one shape of a pack offer** (D14 d): the quote and the public listing both return it
  unchanged.
- `purchaseBreakdown(row)` → from a `per_session` ledger row's `quantity`, `unitPrice`, `amount`:
  `{ quantity, unitPrice, subtotal, savings, total: row.amount }` via `quotePurchase`. The email
  and the invoice both render from it (1.7) — one place builds the lines.

### 1.4 Purchase flow — `privateClassEnrollment.service.js`

- `resolvePurchaseTerms(schedule)` → uses `purchaseOptionsFor(contract, schedule.durationMinutes)`
  instead of the Settings list.
- `quote()` → `options` gain `packId`; `discountPercent` → `savings` on each option.
- `purchaseAndBook({ studentId, scheduleId, day, packId })` → `packId` absent = single session;
  otherwise the option with that id or 409 (D11). The ledger row gets `quantity`, `unitPrice`,
  `amount: option.total`; the enrollment gets `quantity` (no price, no discount).
- `withPaymentsAndBookings()` → `payment` exposes `savings` (computed, D6) instead of
  `discountPercent`.
- Controller: body `packId` replaces `quantity`.

### 1.5 Models losing `discountPercent`

- `backend/src/models/privateClassEnrollment.model.js` — remove `discountPercent`.
- `backend/src/models/registration.model.js` (`perSessionSchema`) — remove `discountPercent`;
  comment updated: `amount` is the pack price, savings are derived.
- `backend/src/models/setting.model.js` + `setting.service.js` — remove `privateClassPackages`
  (D10).

### 1.6 Public listing — `privateClassSchedule.service.js` `listPublic()`

Each slot gains `options` — `purchaseOptionsFor(contract, slot.durationMinutes)` returned
**unchanged**: the same name, shape and source as the quote's `options` (single session first,
then that coach's packs for that length), so the frontend has one `PrivatePurchaseOption` type for
both (D14 d). Not a stripped-down `{ packId, quantity, total, savings }` copy. The top-level
`packageOffers` is removed.

### 1.7 Emails and invoice

- `mail.service.js` `purchaseLines(row)` → "10 sessions × $32.50", "Subtotal $325.00", "Pack
  savings −$25.00" (only when savings > 0), "Charged to your card $300.00" — every figure from
  `purchaseBreakdown(row)`; the charged total is still `row.amount`.
- `invoice.service.js` `buildPerSessionData(row)` → the same `purchaseBreakdown(row)`: the
  subtotal line, then a negative "Pack savings" line when savings > 0; `total` still `row.amount`.
  Neither file calls `quotePurchase` directly (D14 h).
- `src/email/templates.js` + `sampleData.js` → label "Pack savings" replaces "Pack discount".

### 1.8 Backend tests

| Suite | Coverage |
|---|---|
| `tests/utils/privateClassPricing.test.js` | `packPriceBand` (10 × $32.50: `{ subtotal: 325, min: 162.5, max: 324.99 }`) **and a half-cent case** ($65/hr, 45 min, 3-pack: subtotal $146.25, `min` $73.13 — proves `ceilToCents`, and that the message shows the same number the check uses); `describePack` — the band's edges exactly: $325 → `error` (ceiling), $324.99 ok, $162.50 ok, $162.49 → `error` (floor), $300.005 → `error` (whole cents), quantity < 2 → `error`, each message naming the pack and range, and `savingsPercent` rounds 25/325 to 8; `validatePacks` throws `describePack`'s exact message for the same inputs (assert the strings are equal — one check, D14 a), rejects a duplicate length+quantity, returns a sorted list; `quotePurchase` (savings = subtotal − total, single session 0); `purchaseOptionsFor` (only the slot's length, single first); `purchaseBreakdown` (a ledger row → the same figures `quotePurchase` gives). |
| `tests/routes/coachContract.routes.test.js` | Create with packs; a pack outside the band → 400 and no contract; carry-over on a new contract (D9) incl. a pack the new rate pushes outside the band → 400; `PUT /:id/packs` replaces the list, **keeps the id of a pack sent back unchanged, mints a new id for a pack sent back with a changed price** (D7), 409 on an inactive contract, 403 for a coach/parent, 200 for a plain `admin` (D13); `POST /pack-quotes` returns per-pack preview figures and the same error text a save would (assert equality against the `PUT`'s 400 body), writes nothing (contract unchanged after the call), 403 for a coach/parent. |
| `tests/routes/privateClassEnrollment.routes.test.js` (real Stripe) | Quote lists the coach's own packs for the slot's length with `packId` + `savings`; buying a pack charges exactly the pack price (`expectLedgerChargeSucceeded`), the enrollment has the pack's quantity and no price field; a pack for another length is not offered and its id is refused; a pack **removed** between quote and purchase → 409, nothing charged (`listCustomerPaymentIntents` = 0); a pack **edited** between quote and purchase (price changed via `PUT /:id/packs`, old id sent) → the same 409, nothing charged; no `packId` → single session at the rate. |
| `tests/routes/privateClassSchedule.routes.test.js` | Public slots carry `options` in the quote's exact shape (deep-equal a slot's `options` to the quote's `options` for the same slot — one shape, D14 d); another coach's packs never appear. |
| `tests/services/invoice.service.test.js`, `tests/services/mail.service.test.js` | Pack lines + savings from `purchaseBreakdown`; no savings line for a single session. |
| `tests/routes/setting.routes.test.js` | Pack tests removed; the settings shape no longer includes `privateClassPackages`. |
| `tests/testUtils/privateLessons.js` | Contract seeding accepts `privateLessonPacks`; `seedActiveEnrollment` drops `discountPercent`. |

### 1.9 Docs (same PR)

ADR 011 addendum (packs on the contract, fixed price, savings derived, D13's role change);
`docs/features/private-class.md` (single-sources table, routes, purchase pipeline);
`DATABASE_SCHEMA_DOCUMENTATION.md` (CoachContract, PrivateClassEnrollment, Registration
`per_session`, Setting); `docs/modules/email.md` (purchase lines);
`docs/plans/private-class-per-session-booking-plan.md` §5 note pointing here;
`docs/TEST_COVERAGE.md` re-measured (`TZ=UTC npm test -- --coverage`) — the strategy requires it
on every PR that adds tests.

---

## §2 PR 2 — Frontend (`feature/coach-pack-pricing-frontend`)

- **`lib/types.ts`** — `CoachContract.privateLessonPacks: PrivateLessonPack[]` (`{ _id,
  sessionDurationMinutes, quantity, price }`) and a `PrivateLessonPackDraft` for editor rows and the
  `pack-quotes` request (`_id?`, the same three fields); `PrivatePurchaseOption` gains `packId:
  string | null`, `savings` replaces `discountPercent`/`discountAmount`, and is **the one type** for a
  pack offer — `PublicPrivateClassSlot.options: PrivatePurchaseOption[]` uses it too (D14 d);
  `PackQuoteRow` for the preview response; `PrivatePurchasePayment.savings` replaces
  `discountPercent`; `PrivateClassEnrollmentRow` loses `discountPercent`; `Setting` loses
  `privateClassPackages`; `PublicPrivateLessons` loses `packageOffers`; **`PrivatePackageOffer` is
  deleted** (nothing is left to type with it).
- **`lib/services/coachContracts.ts`** — `updateCoachContractPacks(id, packs)` (mutation, never
  throws), `fetchPackQuotes({ studentBillingRate, packs })` (query, throws) (D9a); create accepts
  packs.
- **`lib/services/privateClass.ts`** — `purchasePrivateLessons({ studentId, scheduleId, day, packId? })`.
- **`lib/hooks/useDebouncedValue.ts`** (D14 f) — `useDebouncedValue(value, ms)`; the `PackEditor`
  uses it, and `/admin/subscriptions`' inline `setTimeout` search debounce (its `page.tsx`, the only
  debounce in the app today) is swapped to it in the same PR — no behavior change there, its tests
  stay as they are.
- **`lib/privateLessons.ts`** (D14 g) — every new pack string, formatted from server fields only:
  `packOfferLabel(option)` → "Buy 10 sessions · $300.00 · save $25.00" (wizard) / "10 lessons for
  $300.00" (public listing, a `variant`), `packSavingsLabel(savings)` → "Saved $25.00",
  `packPreviewLabel(row)` → "$30.00 per lesson · saves $25.00 (8%)". Pages import these; none
  builds the string itself. `formatMoney` remains the one dollar formatter underneath.
- **`app/components/admin/PackEditor/`** (D14 e) — **the one pack editor**: `{ studentBillingRate,
  packs: PrivateLessonPackDraft[], onChange, disabled? }`. Owns the rows (lesson length, sessions,
  price, Add pack / Remove), the debounced `fetchPackQuotes` call (D9a), the per-row preview line
  or refusal reason, the failed-preview state (compact inline error, D9a), and exposes
  `hasErrors` (any row with a preview `error`) so the parent dialog can disable Save. No arithmetic.
- **`/admin/coach-contracts`** — the create dialog renders `PackEditor` **prefilled from the
  coach's current active contract** (D9) and always sends the list; an "Edit packs" action on the
  active contract opens a second shared `Modal` around the same `PackEditor`. Save is disabled while
  `hasErrors`; the backend's 400 on save is shown verbatim in the dialog `Alert` (the preview is
  guidance; the save is the rule). `docs/features/admin.md`'s "Pattern A minus edit" line for this
  page becomes "minus edit, plus Edit packs".
- **`/parent/register-private`** — options keyed by `packId`; each pack row reads
  `packOfferLabel(option)`; the summary's discount line becomes "Pack savings"; the purchase posts
  `packId`; a D11 409 goes through the **existing** `submitError` path — inline error + "Pick another
  date", which already refetches dates and the quote — no new step navigation.
- **`/private-classes`** — each slot shows its own packs from `slot.options` (`packOfferLabel`,
  listing variant); the academy-wide packs line goes away.
- **`/parent/subscriptions`, `/admin/private-classes`** — `packSavingsLabel(payment.savings)`.
- **`/admin/settings`** — pack editor removed.
- **Tests** (`docs/TESTING_STRATEGY.md`: MSW at the network boundary, `userEvent.setup()` for every
  new interaction, typed fixtures, request bodies read from the MSW handler):
  - `app/components/admin/PackEditor/__tests__/PackEditor.test.tsx` — the preview rendered
    **verbatim** from a `pack-quotes` MSW response whose figures deliberately don't add up (the
    same server-verbatim guard the wizard uses, design-system anti-pattern 10); `hasErrors` on an
    out-of-band row; the failed-preview state renders inline and does not set `hasErrors`. The
    debounce is exercised with `jest.useFakeTimers()` + `act(() => jest.advanceTimersByTime(ms))`
    (or `findBy*` waits) — never a real-clock sleep.
  - `admin/coach-contracts/__tests__/page.test.tsx` — create posts `privateLessonPacks` (body read
    from MSW); the create dialog is prefilled from the active contract; Edit packs posts to
    `PUT /coach-contracts/:id/packs` with ids for kept rows; Save disabled while a row has an error;
    **a 400 on save "shows an inline error … without crashing"** (the pre-merge checklist's required
    mutation test).
  - `parent/register-private/__tests__/page.test.tsx` — the existing server-verbatim guard with
    `packId`; the posted body carries `packId`; a D11 409 renders inline with "Pick another date"
    and refetches (the same shape as the existing 402 test).
  - `private-classes`, `parent/subscriptions`, `admin/private-classes`, `admin/settings` page tests
    updated; `lib/services/__tests__/privateClass.test.ts` updated; **new
    `lib/services/__tests__/coachContracts.test.ts`** (query throws / mutation never throws, for all
    five functions); `lib/hooks/__tests__/useDebouncedValue.test.ts`.
  - `e2e/private-booking.spec.ts` + `e2e/fixtures/mock-api.ts` — a pack chosen by id, the posted
    body asserted (`packId`, no `quantity`); the public listing mock carries `options` per slot.
  - `docs/TEST_COVERAGE.md` re-measured for this PR too.
- **Docs** — `docs/features/admin.md` (Coach Contracts, Settings), `docs/features/parent-portal.md`
  (wizard), `docs/features/private-class.md` (pages), `docs/design-system.md` (components inventory:
  `PackEditor`, `useDebouncedValue`, the new `lib/privateLessons.ts` strings).

---

## §3 Files touched (measured 2026-09-24)

Backend: `models/{coachContract,privateClassEnrollment,registration,setting}.model.js`;
`services/{coachContract,privateClassEnrollment,privateClassSchedule,setting,invoice,mail}.service.js`;
`controllers/{coachContract,privateClassEnrollment,privateClassSchedule}.controller.js`;
`routes/coachContract.routes.js`; `utils/privateClassPricing.js`; `email/{templates,sampleData}.js`.
Frontend: `lib/types.ts`, `lib/services/{privateClass,coachContracts}.ts`, `lib/privateLessons.ts`,
new `lib/hooks/useDebouncedValue.ts` and `app/components/admin/PackEditor/`, `admin/subscriptions/
page.tsx` (debounce swap only), and the pages above.

Every current reference to `privateClassPackages`, `packageOffers`, `resolvePackOptions`,
`computePackQuote` and `discountPercent` is either rewritten or deleted — none may remain. Measured
2026-09-24 (corrected in review — the first draft said 24 + 28, which no filter reproduces):

```
grep -rlE "privateClassPackages|packageOffers|resolvePackOptions|computePackQuote|discountPercent" \
  . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
```

| Scope | Files |
|---|---|
| `backend/` (10 `src`, 7 `tests`) | 17 |
| `frontend/` (5 pages, 5 page tests, `lib/types.ts`, `lib/services/__tests__/privateClass.test.ts`, `e2e/fixtures/mock-api.ts`) | 12 |
| docs (`CLAUDE.md`, `DATABASE_SCHEMA_DOCUMENTATION.md`, ADR 011, `docs/features/private-class.md`, this plan, the booking plan) | 6 |

The builder re-runs the command at the end of each PR; the only permitted survivors are this plan
and the booking plan's historical D13 row (which gains a note pointing here, 1.9).

---

## §4 Rollout

No data migration. Before merging PR 1, verify on staging and production (read-only):

- no `PrivateClassEnrollment` and no `per_session` `Registration` has `discountPercent > 0`;
- `Setting.privateClassPackages` is empty or absent.

Staging already satisfies both (0 purchases since the 2026-09-24 cutover). If either check finds
data, stop and decide with the owner before merging. After deploy: the admin adds each coach's packs
on Admin → Coach Contracts.

PR 1 and PR 2 merge back to back (the backend changes the purchase request), one at a time, each
only after its own CI is green.

---

## §5 Owner decisions (settled 2026-09-24)

1. **D7** — packs are editable on the active contract.
2. **D8** — a pack must be priced below buying its sessions singly (ceiling, protects families) and
   at least half of that (floor, `PACK_PRICE_FLOOR_RATIO = 0.5`, catches a typo that would undercharge
   the academy).
3. **D9a** — the editor previews per-lesson price and savings from the backend while typing.
4. **D13** — packs become admin-editable (not superadmin-only) because they move onto the contract,
   which admins already own. *Surfaced in review; the owner approved folding it in by asking for
   every review finding to be written into the plan (2026-09-24).*

---

## §6 Review log (2026-09-24, before any code)

The plan was checked against the tree and the four rule docs it cites. Every finding below is
already applied in the sections above; this list exists so a reviewer can see what changed and why.

| # | Finding | Where it landed |
|---|---|---|
| 1 | An edited pack that kept its `_id` would charge a parent a price they were never shown — D11 only fired when the id was gone. | D7 id rule; 1.2 `updatePacks`; 1.8 tests (contract routes + enrollment routes "edited" case). |
| 2 | The "measured" reference count (24 + 28) was wrong; the real count is 17 + 12 + 6 docs. | §3, with the command. |
| 3 | Moving packs from Settings (superadmin) to contracts (admin) widens who sets prices — it was a side effect, not a decision. | D13; §5. |
| 4 | The band's `min` is a half-cent for many real rates; `max` was "just under"; nothing required whole-cent prices. | D8 (cent rules); 1.3 `ceilToCents`/`isWholeCents`; 1.8 half-cent test. |
| 5 | `PrivatePackageOffer` was left behind; D9's carry-over branch was dead unless the dialog omitted the list. | §2 types; D9 prefill rule. |
| 6 | The D11 409 recovery ("return to the Sessions step") invented a second submit-error path. | D11; §2 wizard bullet — the existing inline error + "Pick another date". |
| 7 | No service-contract test for `coachContracts.ts`'s two new functions. | §2 tests — `coachContracts.test.ts`. |
| 8 | The failed-preview state was undefined (a query failure must render inline, never block). | D9a; `PackEditor`. |
| 9 | "Debounced" without a pattern or a test approach; the app has one inline debounce already. | D14 f; `useDebouncedValue`; §2 tests (fake timers). |
| 10 | `docs/TEST_COVERAGE.md` must be re-measured on every PR that adds tests; new pack strings belong in `lib/privateLessons.ts`; new tests use `userEvent.setup()` and a failed save needs the "inline error without crashing" assertion. | 1.9, §2 docs/tests; D14 g. |
| 11 | `validatePacks` and `describePack` read as two band checks with "the same message"; `singlesTotal` and `subtotal` named one figure twice. | D14 a–c; 1.3 (validatePacks built on describePack; `subtotal` everywhere); 1.8 string-equality test. |
| 12 | The quote option and the public slot's pack were two shapes (and two types) for one thing. | D14 d; 1.6 (`options`, unchanged `purchaseOptionsFor` output); §2 one type; 1.8 deep-equal test. |
| 13 | Two inline pack editors (create dialog + Edit packs), two debounces, and email/invoice each building the same purchase lines. | D14 e, f, h; `PackEditor`; `useDebouncedValue`; 1.3 `purchaseBreakdown`. |

---

## §7 As built (2026-09-24) — where the build diverged from this spec

Both PRs were built in one working tree and split at commit time: PR 1 (#102) is `backend/` plus the
backend docs, PR 2 (#103) is `frontend/` plus the frontend docs. The owner chose to test on staging
rather than locally.

1. **Wizard strings are two functions, not one.** The booking wizard's `PillRow` shows a label and a
   sub-line, so `packOfferLabel(option)` became `purchaseOptionLabel` ("Buy 10 sessions") and
   `purchaseOptionPrice` ("$300.00 · save $25.00"). The listing string is `packListingLabel`, the
   purchase-list string `packSavingsLabel`, the editor line `packPreviewLabel`. All live in
   `lib/privateLessons.ts` (D14 g holds).
2. **Public slots keep `sessionPrice`**, now read from `options[0].unitPrice` rather than computed a
   second time. Removing it was not in the plan and would have changed a public API field.
3. **The pricing util reuses `money` from `src/email/layout.js`** for its error messages instead of
   adding a fourth copy of `$x.toFixed(2)`. The backend already has three identical formatters
   (`email/layout.js`, `mail.service.js`, `invoice.service.js`) — pre-existing duplication, left for
   a follow-up, not widened.
4. **`PackEditor` reports `onCanSaveChange`, not `hasErrors`.** Save is blocked while a row is
   incomplete, while its preview is in flight, or while the backend refuses it. A failed preview
   does not block (D9a).
5. **Any `packId` that is not an offered option is the D11 409**, including an unknown id. The old
   400 "quantity must be one of" is gone.
6. **Rate validation is explicit.** `POST /coach-contracts` and `POST /coach-contracts/pack-quotes`
   400 with "studentBillingRate must be a number >= 0" before any pack check. At a $0 rate every
   pack is refused ("a pack needs a positive session price"), since the band would be empty.
7. **Lesson length must be a whole number of minutes ≥ 15** in `describePack`, matching how slots are
   published.
8. **A new contract's packs are validated before the old contract is deactivated**, so a refused pack
   leaves the coach's current contract active and untouched (tested).
9. **The coach contracts table gained a Packs column**, one line per pack.
10. **The debounce test fakes only `setTimeout`/`clearTimeout`.** Faking every timer stalled MSW and
    the finder's polling (the run hung past Jest's own timeout). The narrow fake is deterministic and
    returns to real timers before awaiting the network.
11. **`docs/plans/private-class-per-session-booking-plan.md`'s D13 row is marked superseded** in place,
    and its §5 carries a pointer here.

**Reference sweep at the end of the build** (§3's command plus `normalizePackageOffers`): the only
remaining matches are this plan, the booking plan's superseded D13 row and §5 pointer, the ADR 011
addendum, the schema doc's removal notes, the `setting.model.js` removal comment, and backend tests
that assert the fields are absent.

---

## §8 Follow-up — an editable contract, kept as versions (owner decision 2026-09-25)

After testing on staging, the owner asked for one editable contract with the packs inside it,
instead of an uneditable contract plus a separate "Edit packs" action. Decided 2026-09-25:

| # | Decision | Why |
|---|---|---|
| V1 | **The current contract has two actions: Edit and Deactivate.** Edit opens one form with a Rates section (rate billed to parents, coach pay, default lesson length) and a Packs section. The separate "Edit packs" action and `PUT /coach-contracts/:id/packs` are removed. | Packs are already stored inside the contract; the split was only a side effect of the contract being uneditable. |
| V2 | **Every save of an edit creates a new version** (`POST /coach-contracts/:id/revisions`): the current contract gets `isActive: false`, `effectiveTo` = now and `endReason: 'revised'`, and a new contract starts with `effectiveFrom` = now. Old versions stay in the table, read-only, showing "Replaced on {date}". Deactivate sets `effectiveTo` and `endReason: 'deactivated'` ("Ended on {date}") without a new version. | Keeps the exact rate history — including coach pay, for any future payroll — while the owner sees one contract to edit. Past purchases are untouched either way: each one pins its rate and points at the version it was bought under. |
| V3 | **A save that changes nothing is refused** (400 "Nothing changed"). | Keeps the history free of duplicate lines. |
| V4 | **Add Contract is only for a coach with no current contract**; the backend refuses a second active contract with 409 "This coach already has a contract — edit it instead". Create no longer carries packs over from a previous contract. | One way to change a contract (Edit), one to start one (Add). |
| V5 | **A purchase names the contract version it was quoted from** (`contractId`, now on the quote). If that version is no longer current the purchase is a 409 "Prices have changed — please review them" and nothing is charged. This covers single sessions too, closing the gap where a rate change between quote and payment charged a single session at the new rate. The request still never carries a price. | One guard for every stale price. Replaces D7's keep-the-pack-id rule: every version's packs are new subdocuments with new ids. |
| V6 | **Rates stay hourly.** The editor shows the resulting lesson prices under the rate ("30 min $30.00 · 60 min $60.00"), from the backend: `POST /coach-contracts/preview` (renamed from `pack-quotes`) returns `sessionPrices` for the default length, every pack length and every length the coach currently publishes, plus the per-pack quotes. | Owner choice between hourly and per-lesson was left to the recommendation; one hourly rate keeps 30- and 60-minute prices consistent. Hard Rule 7: the form still computes nothing. |
| V7 | **The editor's preview moves into one hook**, `useContractPreview`, shared by the create and edit dialogs; `PackEditor` becomes presentational (rows + the status the hook gives each row). | One home for the debounce, the fetch and the Save gate now that the preview also feeds the Rates section. |

Two PRs again (backend, frontend), shipped to `develop` for staging testing. No data migration:
existing contracts simply have no `effectiveTo` until they are next edited or deactivated.

### §8 as built (2026-09-25)

Built exactly as decided above, with these specifics:

1. **The revise endpoint is `POST /coach-contracts/:id/revisions`** and returns `{ contract, previous }`.
   A field left out of the request keeps its current value. The new version is fully validated before
   the current one is ended, and a failed insert puts the current version back, so a refused edit
   never leaves a coach without a contract. The end step is guarded on `isActive`, so two
   simultaneous edits cannot both succeed.
2. **A purchase without `contractId` is a 400**, checked after ownership, so a stranger still gets
   403. An old `packId` sent with the *current* `contractId` is still refused by D11's 409.
3. **The Edit dialog also disables Save while nothing has changed**, on top of the backend's own
   "Nothing changed" 400.
4. **The pack-row helpers moved into `lib/hooks/useContractPreview.ts`** along with the preview.
   `PackEditor`'s tests now cover only rendering and editing; the preview tests (verbatim figures,
   refusal, failure, incomplete row, fake-timer debounce) live with the hook.
5. **The table shows every version**, each coach's together, newest first, with Status (Current /
   Replaced / Ended; "Inactive" for versions that ended before `endReason` existed) and Since/Until.
