# Per-Level Registration Fee Plan

**Status:** BUILT 2026-08-29, pending owner local testing + review (see Completion Notes at the end)
**Branch:** `feature/per-level-registration-fee` → PR to `develop`
**Scope:** One PR. Backend + admin frontend + tests + doc close-outs.

---

## 0. Executor instructions — read this first

This plan is written to be executed by a separate Claude session. Non-negotiables:

1. **Follow `CLAUDE.md`'s HARD RULES exactly.** In particular: discuss anything ambiguous
   before writing code; the word `write` from the owner is the only implementation trigger;
   write tests before considering any step complete; **never auto-commit** — the owner tests
   locally first; never auto-fix a test failure (show summary + root cause + fix plan, stop);
   no `any` on domain data; no `console.log`; stage files explicitly (never `git add .`).
2. **Pre-reads before touching code** (per `CLAUDE.md`'s pre-read table):
   - `docs/decisions/001-in-house-subscription-billing.md` — this touches billing.
   - `docs/TESTING_STRATEGY.md` — before writing/modifying ANY test. §5 below was written
     to be consistent with it; if the two ever disagree, TESTING_STRATEGY.md wins.
   - `docs/features/admin.md` — before touching the admin Prices/Settings pages.
   - `DATABASE_SCHEMA_DOCUMENTATION.md` — a DB field is being added.
3. **Read every file before editing it** — the line numbers in this plan are from
   2026-08-29 and may have drifted; treat them as pointers, not gospel.
4. Backend stays the **single source of truth for billing math** (Hard Rule 7). The frontend
   never computes, compares, or falls back between the two fee sources — it only displays
   what the backend resolved.

---

## 1. Problem & goal

The one-time registration fee is currently a **single academy-wide number** on the `Setting`
singleton (`backend/src/models/setting.model.js`, field `registrationFee`), resolved by
`resolveRegistrationFee(studentId)` in
`backend/src/services/billing/registrationFee.service.js` and charged/previewed at exactly
two call sites in `backend/src/services/registration.service.js` (`create()` ~line 209,
`previewChargeAmount()` ~line 451).

The academy actually charges **different registration fees per level**: regular levels
**$145**, Beginner **$100**. The system needs a per-level fee.

## 2. Decision (owner-confirmed 2026-08-29)

Add an **optional `registrationFee` to the `Price` model** — the model already keyed
one-per-level (`levelId` unique) that holds `monthlyFee`. Resolution order per registration:

1. **Level fee wins** when the level's Price row has `registrationFee` set — including an
   explicit `0`, which means "this level charges no registration fee."
2. **Academy-wide fallback**: only when the level's fee is unset (`null`/absent) does
   `Setting.registrationFee` apply.
3. Neither set → no fee charged (today's behavior, unchanged).

Explicitly confirmed semantics: **`0` and blank are different.** Level fee `0` = free for
this level; blank = inherit the academy-wide default.

The returning-student grace-period **waiver is unchanged** and runs *after* resolution —
whichever amount wins is what gets waived (and what `standardAmount` reports for the
Family Scorecard "you saved $X" line).

Why not alternatives considered:
- *Required per-level fee + deprecate the Setting field*: forces a migration/backfill on
  every existing Price doc and makes a newly created level silently fee-less until someone
  remembers to set it. The fallback design is zero-migration and fail-safe.
- *A per-level map on Setting*: duplicates the level keying that Price already owns.

No new ADR — this extends the existing registration-fee behavior without changing the
billing model; this plan doc + updated model comments are the record.

Rollout target: academy-wide default **$145**, Beginner's Price row **$100**, all other
levels blank (§7).

## 3. Backend changes

### 3a. `backend/src/models/price.model.js`

Add:

```js
// One-time registration fee for THIS level, overriding the academy-wide
// Setting.registrationFee when set. null (the default) means "inherit the
// academy-wide fee"; an explicit 0 means "this level charges no
// registration fee" — the two are deliberately distinct.
registrationFee: {
  type: Number,
  default: null,
  min: 0,
},
```

No migration needed — existing Price docs simply lack the field and fall back.

### 3b. `backend/src/services/billing/registrationFee.service.js`

Change the signature to `resolveRegistrationFee(studentId, levelId)`:

- Look up `Price.findOne({ levelId })` fresh each call (same live-read discipline as
  `resolveCurrentFee()` in `calculateChargeAmount.service.js` — never cached, never passed
  a stale doc).
- The configured fee becomes:
  `price?.registrationFee ?? setting.registrationFee` — nullish coalescing, NOT `||`,
  so an explicit level-fee of `0` is honored as free rather than falling through.
- A missing Price doc falls back to the global fee (both call sites 404 earlier when
  Price is missing, so this branch is defensive only — but it must not crash).
- Everything downstream (the `<= 0` no-charge early return, prior-cancelled-subscription
  lookup, grace-period waiver, `standardAmount`) operates on the **resolved** fee and is
  otherwise unchanged. Update the module docblock to describe the two-source resolution.

### 3c. `backend/src/services/registration.service.js` — both call sites

`create()` (~line 209) and `previewChargeAmount()` (~line 451) both already have
`groupClass.levelId` in scope. Change both to
`resolveRegistrationFee(studentId, groupClass.levelId)`. Nothing else in either function
changes — `totalChargeAmount`, the `savings` breakdown, and the response fields all
consume the resolved amounts exactly as today.

`renewal.service.js` is **untouched** — renewals never charge the registration fee.
Email templates are untouched — they render amounts passed in from charge results.

### 3d. `backend/src/models/setting.model.js`

Update the `registrationFee` comment only (no schema change): it is now the
**academy-wide default**, overridden per level by `Price.registrationFee`.

### 3e. Price CRUD plumbing

- `backend/src/services/price.service.js` passes `data` through to
  `Price.create`/`findByIdAndUpdate` with `runValidators: true` — verify (don't assume)
  that `price.controller.js` doesn't whitelist body fields; if it does, add
  `registrationFee`. The `min: 0` validator plus Mongoose's cast-to-Number are the
  validation; `null` must be accepted to clear an override back to "inherit".

## 4. Frontend changes (admin only)

Backend-first note: the parent register wizard needs **no change** — it already renders
`registrationFeeCharged`/`savings` straight from the preview response (Hard Rule 7), and
those fields keep their exact shape.

### 4a. `frontend/lib/types.ts`

`Price` gains `registrationFee?: number | null`.

### 4b. `frontend/app/admin/prices/page.tsx`

Pattern A CRUD dialog (per `docs/features/admin.md` — pre-read it):

- `PriceForm` gains `registrationFee: string` (empty string = inherit). `openEdit` maps
  `null`/`undefined` → `''`, a number → `String(n)`.
- Dialog gains an optional "Registration Fee" number input (`min={0}`, NOT `required`)
  with helper text making the semantics unmissable, e.g.
  *"Leave blank to use the academy-wide default. Enter 0 for no fee at this level."*
- `handleSave` payload: blank/whitespace → `registrationFee: null` (explicitly, so an
  edit can CLEAR an override); otherwise `Number(...)` with the same NaN/negative
  validation shape as `monthlyFee` (but only when non-blank).
- Table gains a "Registration Fee" column: the number when set (including `0`), an
  explicit inherit marker like `Default` when unset — never a bare blank cell, so an
  admin can tell overridden levels apart at a glance.

### 4c. `frontend/app/admin/settings/page.tsx`

Label/helper-text change only: the fee field reads as the **"Default Registration Fee
(academy-wide)"** with helper text noting per-level overrides live on the Prices page.
No behavior change.

## 5. Tests — written to match `docs/TESTING_STRATEGY.md`

Re-read TESTING_STRATEGY.md before writing any of these. Conventions that bind here:
mock at the network boundary only (real `mongodb-memory-server` on the backend, MSW on
the frontend — never `jest.mock` a service file); **new frontend interactions use
`userEvent.setup()`, not `fireEvent`**; typed fixtures (no `any` — update the `Price`
type first so fixtures compile); assert rendered results and MSW-received payloads,
never "the mock was called"; mutations never throw (test both `status` branches);
`afterEach` → `clearTestDB()` / `server.resetHandlers()`; no time-bomb dates.

### 5a. `backend/tests/services/billing/registrationFee.service.test.js` (service layer, real ephemeral Mongo)

Existing suite calls `resolveRegistrationFee(student._id)` with no level — every existing
test must be updated to the new signature. Add a seeded Level + Price to the shared
fixture helpers (a `seedLevelAndPrice({ registrationFee })` helper mirroring the existing
`seedParentAndStudent`/`seedCancelledSubscription` style, plain Mongoose `.create()`
against the real schema).

Keep every existing behavior test green (they now exercise the fallback path when the
seeded Price has no `registrationFee`), and add a nested `describe('per-level override
(per-level registration fee plan)')` — the named-regression convention — covering:

1. Level fee set (e.g. 100) + global set (145) → level wins: `amount: 100`,
   `standardAmount: 100`.
2. Level fee unset (`null`) + global 145 → fallback: `amount: 145`.
3. **Level fee explicitly `0` + global 145 → `amount: 0`, no charge** — the
   `??`-not-`||` regression guard; this is the single most important new test.
4. No Price doc for the level at all + global set → falls back, doesn't crash
   (defensive branch, §3b).
5. Level fee set + global **unset/0** → level fee still charges (override doesn't
   depend on a global being configured).
6. Grace-period waiver against a level-fee student: `amount: 0`, `waived: true`,
   `standardAmount` = the LEVEL fee (100, not the global 145) — this is what the
   Family Scorecard savings line reads.

Date rule reminder: the existing suite's relative-date seeding (`setMonth(-2)` on `new
Date()`) predates the fake-timers rule; don't copy that pattern into the *new* tests if a
new test computes "today"-relative state — freeze time per TESTING_STRATEGY.md's Date
rules instead. (Retrofitting the existing tests is out of scope.)

### 5b. `backend/tests/routes/registration.routes.test.js` (route-integration, real Stripe TEST mode)

Extend the existing preview coverage (don't duplicate its setup): with a Beginner-style
level Price carrying `registrationFee: 100` and a Setting of 145, `POST
/registrations/preview` returns `registrationFeeCharged: 100` and a `totalChargeAmount`
that includes it; a second level with no override returns 145. One case, not a matrix —
the resolution matrix lives in 5a; this layer proves the HTTP wiring passes `levelId`
through.

### 5c. `backend/tests/routes/price.routes.test.js` (or wherever Price CRUD route tests live — locate, don't assume)

- Create/update a Price WITH `registrationFee` → persisted and returned.
- Update with `registrationFee: null` → override cleared (returns null, not the old value).
- `registrationFee: -5` → 400/validation failure via the real Mongoose validator
  (route-level trigger, per the "test that OUR code uses the library correctly" rule).

### 5d. `frontend/app/admin/prices/__tests__/page.test.tsx` (component layer, MSW)

New tests use `userEvent.setup()`. Assert via MSW handler payload capture
(`await request.json()`) + rendered table text:

1. Table renders the override value for a Price fixture with `registrationFee: 100`,
   and the inherit marker (`Default`) for one with `null`.
2. Create with the field blank → MSW-received payload has `registrationFee: null`;
   dialog closes; list refreshes (success branch).
3. Edit setting the field to `0` → payload `registrationFee: 0` (the blank-vs-zero
   distinction, asserted at the network boundary).
4. Error branch: MSW returns an error → inline `<Alert variant="error">` shows
   `result.message` **without the component crashing** (mutations-never-throw contract).

Update existing `Price` fixtures to satisfy the widened type (typed-fixtures rule).

### 5e. `frontend/app/admin/settings/__tests__/page.test.tsx`

Update any label assertions to the new "Default Registration Fee" wording. No new
behavior tests — nothing behavioral changed.

### 5f. E2E (`frontend/e2e/`) — check, likely no change

The pre-read table triggers on the register wizard. This change alters no wizard DOM and
no preview response *shape* — verify `frontend/e2e/fixtures/mock-api.ts`'s preview mock
still matches the real response shape (it does; fields are unchanged) and state that
verification in the PR description. Only if a mocked field is renamed/removed (it isn't,
per this design) would `parent-register.spec.ts` need updating. TESTING_STRATEGY.md is
explicit that E2E mocks don't catch contract drift — the live audit remains the layer
that proves the real fee resolution end-to-end.

### 5g. Run before handing back to the owner

`TZ=UTC npm test` in `backend/` and `frontend/` (per TESTING_STRATEGY.md). Known
pre-existing failure baseline: check the current count on `develop` first and report
against it — do not chase unrelated pre-existing failures (Hard Rule 6).

## 6. Doc close-outs (same PR)

- `DATABASE_SCHEMA_DOCUMENTATION.md` — add `registrationFee` to the Price entry
  (nullable, semantics of null vs 0 vs the Setting fallback); amend the Setting entry's
  `registrationFee` description to "academy-wide default".
- `docs/features/admin.md` — Prices page spec: new field/column + inherit semantics;
  Settings page: relabel.
- `CLAUDE.md` Documentation Map — flip this plan's row to SHIPPED with the date.
- This file — append a completion-notes section (what was built, test counts, anything
  found mid-build), matching the repo's other shipped plans.

## 7. Rollout (owner-operated, after merge + deploy — NOT a code step)

Staging (`develop`) first, then production (`main`, owner-approved merge only):

1. Superadmin → Settings: set Default Registration Fee = **145**.
2. Admin → Prices: set Beginner's Registration Fee = **100**. Leave every other level
   blank (inherits 145).
3. Verify via the register wizard preview: a Beginner-level class quotes a $100 fee,
   any other level quotes $145, and a returning student within the grace window shows
   the waiver against the correct per-level amount.

No data migration, no seed-script change (`Service`/`Price` seeding is untouched — but
note the standing memory that staging/production `Service` seeding is manual; unrelated
to this plan, just don't be confused by it).

---

## Completion notes (2026-08-29)

Built exactly as designed in §3–§6, on `feature/per-level-registration-fee`. Nothing
diverged from the plan mid-build; no new gap was found.

**Backend:**
- `Price.registrationFee` added (`min: 0`, `default: null`).
- `resolveRegistrationFee(studentId, levelId)` — level's `Price.registrationFee ??
  Setting.registrationFee`, per §3b exactly (nullish coalescing, not `||`).
- Both `registration.service.js` call sites (`create()`, `previewChargeAmount()`) updated
  to pass `groupClass.levelId`.
- `price.controller.js`/`price.service.js` needed **no changes** — `req.body` already
  passes through untouched to `Price.create`/`findByIdAndUpdate`, confirming §3e's
  "verify, don't assume" note.

**Frontend:** `Price` type widened; `createPrice`/`updatePrice` signatures widened; Prices
page dialog field (blank → `null`, distinct from `0`) + table column (`Default` marker for
unset); Settings page relabeled "Default Registration Fee ($)" with a cross-reference
helper line. Found mid-build: the plan's placeholder class name `styles.helperText`
doesn't exist in `admin.module.css` — the real class is `styles.formHint` (confirmed
against its existing usage in `coach-contracts/page.tsx`, `users/page.tsx`, and this same
Settings page); used the real class name.

**Tests — all new/updated suites run, full suites re-run clean:**
- `registrationFee.service.test.js`: added a `seedLevelAndPrice()` fixture helper, updated
  every existing call to the new 2-arg signature, added a 6-case `describe('per-level
  override ...')` block per §5a (level-wins, fallback-when-unset, the `0`-vs-fallback
  regression guard, missing-Price-doc fallback, override-with-no-global-set, and the
  waiver reading the level's own `standardAmount`). **15/15 passed.**
- `registration.routes.test.js`: one real-Stripe-charge test (`one-time registration fee`
  block) and two preview-only tests (override + fallback) added per §5b/§5c's "one case,
  not a matrix" guidance — the resolution matrix already lives in the service-unit suite.
  **40/40 passed** (real Stripe TEST-mode charges included).
- `price.routes.test.js`: create-with-override, default-null-when-omitted, clear-to-null,
  explicit-`0`, and negative-rejection (documented as a real, pre-existing 500 from the
  controller's generic error handler — not a regression, see the in-file comment).
  **11/11 passed.**
- `prices/__tests__/page.test.tsx`: updated 2 existing payload assertions (now include
  `registrationFee: null`) and 1 prefill assertion; added a `describe('registrationFee
  override')` block (table rendering, blank→null create via `userEvent`, explicit-`0` via
  `userEvent`, and the mutation-error-doesn't-crash branch) per §5d. **New tests use
  `userEvent.setup()`** per the strategy's new-test rule; untouched pre-existing tests
  keep `fireEvent`, per the "retrofitting is out of scope" note.
- `settings/__tests__/page.test.tsx`: label text updated to "Default Registration Fee
  ($)" everywhere it's queried; no behavior changed, per §5e.
- E2E (§5f): verified, not edited — `frontend/e2e/fixtures/mock-api.ts`'s preview mock
  fields (`registrationFeeCharged`, `registrationFeeWaived`, `savings`) are unchanged; no
  wizard DOM changed.

**Full-suite run** (§5g), `TZ=UTC npm test` in both repos:
- Backend: **564/564 passed** — notably the plan's documented baseline of "2 pre-existing
  unrelated proration failures" no longer reproduces; the full suite is fully green now
  (that bug appears to have been fixed independently since the baseline was recorded).
- Frontend: **308/308 passed.**
- `npx tsc --noEmit` (frontend): clean, no type errors from the widened `Price` type.

**Not done, by design (per Hard Rules):** nothing has been committed. The branch
`feature/per-level-registration-fee` exists locally with the working-tree changes only,
staged for the owner to test locally first (Hard Rule 5) before any commit.

**§7 rollout (setting the real $145/$100 values in the admin UI) has NOT been done** —
that's owner-operated, post-merge-and-deploy, not a code step; still pending.
