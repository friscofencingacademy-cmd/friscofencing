# Testing Strategy — Frisco Fencing Academy

Adapted from CKQ's testing conventions (`docs/plans/ckq-ui-adoption-plan.md` Phase 6), scaled down for this MVP's size. This file is the single source of truth for how tests are structured, mocked, and written in this repo — read it before writing or modifying any test.

## Layers

| Layer | Location | What it tests | Real DB / network? |
|---|---|---|---|
| Backend unit | `backend/tests/utils/*.test.js`, `backend/tests/services/billing/*.test.js` | Pure functions — password hashing, JWT signing, discount math, date/period calculations | No |
| Backend service | `backend/tests/services/*.test.js` (e.g. `mail.service.test.js`, `renewal.service.test.js`) | A single service module's behavior, including its Mongoose model interactions | Yes — `mongodb-memory-server` |
| Backend route-integration | `backend/tests/routes/*.routes.test.js` | Full HTTP round-trip through Express (auth → controller → service → model) via Supertest, against a real ephemeral Mongo | Yes — `mongodb-memory-server` |
| Frontend component | `frontend/app/**/__tests__/*.test.tsx` colocated with the component/page | A single component's/page's rendered behavior, including its network calls | Mocked — MSW |
| Frontend hook | `frontend/lib/hooks/__tests__/*.test.ts` | A hook's state machine in isolation (`@testing-library/react`'s `renderHook`) | No, or MSW if the hook itself fetches |
| Frontend service | `frontend/lib/services/__tests__/*.test.ts` | The query-throws / mutation-never-throws contract for one service file | Mocked — MSW |
| E2E | `frontend/e2e/*.spec.ts` (`@playwright/test`) | Full browser flows through a real, locally-built Next.js server — login/role-redirect, the register wizard, the admin shell, coach attendance, the public site — real DOM/routing/hydration a mocked jsdom render can't exercise | Real Chromium, real Next.js server; network fully mocked (`page.route()`), no real backend/DB |

Backend tests mirror `backend/src/`: `src/services/subscription.service.js` → `tests/services/subscription.service.test.js`. Frontend tests live colocated in `__tests__/` next to the component/page/hook/service they cover — never in a parallel top-level `tests/` tree.

## Mocking rules

**Mock at the network boundary, never at the module/service boundary.**

- Backend: a real ephemeral MongoDB (`mongodb-memory-server`) per test file, never `jest.mock('../models/...')`. This is a real Mongo engine, not a stub, so schema validation, indexes, and Mongoose middleware all run for real.
- Frontend: MSW (`setupServer` + `http.get/post/put/patch/delete`) intercepts the actual `axios` calls a component/page/service makes. **Never `jest.mock('../../lib/services/parent')` (or any other service file) to stub out an HTTP call** — that hides the exact bug class this rule exists to catch: a service function that silently drifts from what the backend actually returns.
- **Never assert "a service function was called with X."** Assert on the *rendered result* of a real (MSW-intercepted) network round-trip instead — a request-payload assertion reads the body MSW's handler received (`await request.json()`), not a mock's call args.

**Named, narrow exceptions where module-level `jest.mock` IS the correct call:**

- `next/navigation` (`useRouter`, `usePathname`, `useSearchParams`, `useParams`, `redirect`) — there is no real Next.js router in a Jest/jsdom environment to exercise; mocking it is the only option, not a shortcut.
- A context provider, when the test's whole point is isolating one consumer component from the rest of that context's tree (rare — prefer rendering with the real provider + MSW, as every test in this repo does today).
- `@stripe/react-stripe-js`'s `CardElement`/`Elements`/`useStripe`/`useElements` — `CardElement` renders into a cross-origin iframe that jsdom cannot simulate at all; there is no way to "type a card number" into it in a test environment. This is an external-SDK exception, not our own service boundary — the real `POST /payment-methods` call the page makes afterward still goes through MSW like any other endpoint.
- Real Stripe TEST-mode API calls on the backend (`registration.routes.test.js`, `paymentMethod.routes.test.js`) are **not** mocked at all — Stripe explicitly designs test mode to be hit for real, and mocking it risks drifting from Stripe's actual API contract.
- `@vercel/blob`'s `put()` on the backend (`spotlight.routes.test.js`) — unlike Stripe, Blob has no separate test mode; calling it for real from a test would actually upload a file to the live store. `jest.mock('@vercel/blob')` is the exception here, not the Stripe-style "hit it for real" rule.

### Real Stripe in tests — never read the account as a whole

The Stripe TEST account is **one account shared by every CI run and every developer machine at the same time**. A test must never read Stripe account-wide: no `stripe.paymentIntents.list({ limit: 10 })` and pick-by-amount, no finding a customer by email. When CI runs overlap, which happens every time several PRs merge within a minute, another run's objects show up in those reads. This happened on 2026-09-24: three overlapping runs failed by picking up each other's PaymentIntents, and a before/after count of `list({ limit: 10 })` could never fail, because both lists were always 10. Use `tests/testUtils/stripe.js` instead. Every lookup there is keyed to something only this test owns:

- **"Was this charged correctly?"**: `expectLedgerChargeSucceeded(ledgerRow, dollars)` fetches the exact PaymentIntent the ledger row recorded, then asserts it succeeded, the amount matches, and it belongs to that row's own parent. This proves the ledger-to-Stripe link, not merely that some charge of that amount exists somewhere.
- **"Was it charged exactly N times, or never?"**: `listCustomerPaymentIntents(userId)` returns every PaymentIntent on that user's own Stripe customer. Each test parent gets a fresh customer, so the expected count is exact (`toHaveLength(0)` for "never charged").
- **"Which customer?"**: `stripeCustomerIdOf(userId)` reads the id our code stored, from our own database.

Production code follows the same principle: stale-pending recovery searches PaymentIntents by the unique `registrationId` metadata, never by amount.

## Interaction rule

New tests should drive user interaction with `userEvent.setup()`, not `fireEvent`, for anything a real user does (clicks, typing, selecting an option) — `userEvent` dispatches the fuller, more realistic event sequence a browser actually produces. **Known gap, logged honestly rather than silently ignored**: every test written before and during the CKQ UI adoption plan (Phases 0–5, ~30 frontend test files) uses `fireEvent` — the convention in place when they were written. This rule takes effect for new tests going forward; retrofitting the existing suite is out of scope for this docs/testing-organization phase and is tracked in `docs/TEST_COVERAGE.md`'s Improvement Plan, not silently deferred.

## Date rules

- **Never sample the real clock against a "today"-computing subject.** If a component/service computes anything relative to `new Date()` (e.g. book-trial's same-day session filter), freeze time with `jest.useFakeTimers({ now: fixedInstant })` (or `jest.useFakeTimers().setSystemTime(...)`) rather than asserting against whatever the wall clock happens to read when CI runs.
- **Fixture instants use midday UTC** (`T12:00:00Z`), not midnight — a midnight UTC instant renders as "yesterday" in every timezone west of UTC, which is exactly the class of flake this rule exists to prevent.
- **Run suites under `TZ=UTC`** to reproduce the CI runner: `TZ=UTC npm test` in both `backend/` and `frontend/`. A test that only fails in one timezone is a real bug, not a fluke.
- **Never let a suite's result depend on the time of day it runs.** A schedule created through the real route (or `generateInitialSessions`) generates its first session from the real clock — on that schedule's own weekday, `sessions[0]` is *today's* occurrence, and once its start time has passed it is "started" (no new Visit, not bookable). So either freeze the clock BEFORE seeding (`jest.useFakeTimers({ now, doNotFake: [...] })` — e.g. a Tuesday morning for a Wednesday class) or pick a session that is always weeks ahead (`sessions[sessions.length - 1]`), never `sessions[0]`, when the test needs an upcoming session.
- No time-bomb dates: use fixed historical/near-term instants, never "now + N days" logic that silently breaks on a future run (e.g. `ACTIVE_SUBSCRIPTION.currentPeriodEnd` fixtures use a literal `'2026-02-01T00:00:00.000Z'`, not `addDays(new Date(), 30)`).
- Every subscription-**charging** test — both `renewOne` (renewal) and `retryOne` (retry/dunning, `docs/plans/registration-ledger-plan.md` D6) — must explicitly cover the cancel-then-charge race: a subscription cancelled between snapshot and charge-time must never be charged. This is the exact bug class the in-house billing model (`docs/decisions/001-in-house-subscription-billing.md`) exists to prevent — it needs a regression test on EACH charging path, not just a design doc, and not just the first path that happened to exist when this rule was written.

### Timezone day-boundary math — use `todayAtMidnight`/`todayDateOnly`/`addOneDay`, never raw `setHours`/`setDate`/`setMonth` on a real instant

`backend/src/utils/billingDates.js` exports the tz-aware primitives (`docs/plans/timezone-consistency-plan.md`, added 2026-08-28 after CKQ's own `dateUtils.js` history — the same day-boundary bug shipped there four separate times before being centralized). Two distinct kinds of `Date` values flow through this codebase — which one a test's fixture represents determines which rule applies:

- **Real instants** (an actual point in time — `todayAtMidnight()`'s own output, `new Date()`): resolved via real IANA timezone math (`moment-timezone`, `DEFAULT_TIMEZONE` from `config/timezone.js`). Never compute a day boundary from one with raw `setHours(0,0,0,0)`/`setDate`/`setMonth` — those operate on the JS runtime's local calendar fields (UTC in this test runner and in production), which silently disagrees with the intended Central calendar day for part of every day (`billingDates.js`'s own docblock has the full explanation). `addOneDay()` is the one function in this file that adds to a real instant and needs genuine DST-safe math — see `tests/utils/billingDates.test.js` for the "prove the fix" pattern (assert against a real 2026 DST-transition instant, contrasted with what raw math would have produced).
- **Date-only sentinels** (a UTC-midnight `Date` representing a pure calendar day with no real timezone meaning, e.g. `new Date('2026-03-08')`, matching `GroupClassSession.date`'s own storage convention — `anchorDate`/`currentPeriodStart`/`currentPeriodEnd` are always this shape): use plain calendar-component arithmetic (`addOneMonth`/`addMonths`/`daysInMonth`/`endOfMonth`, unchanged, zero DST exposure by construction). **Do not** wrap these in `moment(date).tz(tz)...` — reinterpreting a date-only sentinel through a real timezone lens shifts it onto the wrong calendar day (a bug that shipped and was caught mid-implementation, not merely theorized — `docs/plans/timezone-consistency-plan.md` D9 has the worked example). If a new helper needs to add to a date-only value, it needs `moment.utc(date).add(...)`, not `moment(date).tz(tz).add(...)`.

**Mock fidelity matters here specifically** (same class of trap CKQ's own `dateUtils.js` docs flag): if a suite ever mocks `billingDates.js`/`config/timezone.js` wholesale, the mock must reflect real input/tz behavior, not a naive stub that ignores its arguments — a stub that always returns the same fixed value would make a test pass without exercising anything real.

**Sentinel/instant construction goes through `dateShapes.js`, never hand-rolled** (`docs/plans/utc-date-standard-plan.md`) — `backend/src/utils/dateShapes.js` is the gate for both shapes outside the billing domain: `dateOnlyUTC`/`addDaysToDateOnly`/`nextDateOnlyOnOrAfter` build/step calendar-day sentinels (`GroupClassSession.date`), `combineDayAndTimeInTZ` builds real instants from a wall-clock day+time (`PrivateClassSession.startDate`/`endDate`). A test that hand-builds a sentinel or instant any other way (raw `setHours`/`setDate` on an instant, `moment(sentinel).tz(tz)` on a sentinel) is testing the wrong contract even if it happens to pass under `TZ=UTC` — write fixtures the same way the gate would produce them. The frontend has the equivalent module, `frontend/lib/formatDate.ts` (`formatDateOnly`/`formatInstant` for rendering, `CalendarDay` helpers for date-only arithmetic like the register wizard's start-date window) — same two-shape contract, same rule against hand-rolled `toLocaleDateString`/local `Date` getters on a sentinel.

**"Has this group-class session started / is it upcoming?" is answered ONLY by `GroupClassSession.startsAt` vs a real `now`** (`startsAt: { $gt: now }` / `session.startsAt <= now`) — never by comparing `GroupClassSession.date` to `todayDateOnly()`. That is a day comparison and was the bug `docs/plans/session-start-time-cutoff-plan.md` fixed (a 4 pm class stayed bookable until midnight). The day comparison is legitimate only for genuinely *day*-granular questions (holidays, the unique index, a display window's far edge, and the attendance-open gate) — which shape answers which question, and why, is stated once in `docs/decisions/009-utc-date-storage-standard.md`'s addendum. Session fixtures build `startsAt`/`endsAt` through `tests/testUtils/sessions.js`'s `createSession`/`sessionFixture` (which call the production `sessionInstantsFor`), never by hand — the model requires both fields, so a raw `GroupClassSession.create({ scheduleId, date })` fails validation. A fixture session that a test needs to be *open for attendance* goes through the same file's `makeSessionAttendable(session, schedule)` (moves it to a fixed past day and recomputes the instants); a test that needs a *closed* one uses a session generated weeks ahead — never the real clock.

**Private-lesson bookings ([ADR 011](./decisions/011-private-per-session-booking.md)) use `tests/testUtils/privateLessons.js`**: `freezeDate()` fakes only `Date` at a fixed Monday morning (every timer stays real, so Mongo, supertest and the Stripe SDK work), `seedCoachWithRules` publishes availability through the real bulk endpoint, and `seedBooking` builds a booking's instants with the production `combineDayAndTimeInTZ`. "Has this private lesson started?" is `PrivateClassSession.startDate` vs a real `now` — an exact instant, never a day comparison. When a test moves the frozen clock forward, keep it within 7 days of login: the auth cookie's JWT expires after that, and the request fails with 401 rather than the behavior under test.

## Typed fixtures

No `any` on domain data in tests. Every frontend fixture object (a `Location`, a `Student`, a `Subscription`, ...) must satisfy the real type from `frontend/lib/types.ts` — if a fixture doesn't type-check, either the fixture is wrong (fix the literal) or the type is wrong (fix the type against the real backend model/controller, never widen it to `any` to make the fixture compile). Backend test fixtures are plain Mongoose `.create()` calls against the real schema, so this is enforced structurally by Mongoose validation rather than by hand.

## Naming & placement conventions

- Backend: `<subject>.routes.test.js` for a route-integration suite, `<subject>.service.test.js` for a service-unit suite, mirroring `src/`'s directory shape one-for-one under `tests/`.
- Frontend: `__tests__/page.test.tsx` for a page, `__tests__/index.test.tsx` for a component whose file is `index.tsx`, `__tests__/<Name>.test.tsx` for a named component file, `__tests__/<name>.test.ts` for a hook or service module.
- A seed/helper function lives at the narrowest scope that contains **all** of its users: inside a `describe` only if that one block uses it, at **file scope** the moment a second `describe` needs it. (A helper first written inside one `describe` and later needed by a sibling fails with a `ReferenceError` — there is no linter in `backend/` to catch an out-of-scope name at write time, so this convention plus running the suite is the guard.)
- One `describe` block per component/page/service under test; a nested `describe` for a named regression (see `BookTrialPage wizard — same-day session regression (bug fix)` in `book-trial/__tests__/page.test.tsx`) so a `git blame`/PR reviewer can see immediately which bug a test guards against.
- The MSW `setupServer(...)` call, its `beforeAll(() => server.listen())` / `afterEach(() => server.resetHandlers())` / `afterAll(() => server.close())` triple, and any `jest.mock('next/navigation', ...)` all live at the top of the file, above the `describe` blocks — never inside a single test.

## Isolation rules

- `afterEach` always resets MSW handlers (`server.resetHandlers()`) and any local mutable fixture state (a `let postPayload` capture variable, a mutable `mockPathname`/`mockSearchParams`) — a test must never depend on execution order.
- Backend: `afterEach` always calls `clearTestDB()` (drops every collection) so one test's seeded documents can never leak into the next.
- Render helpers (`renderLocationsPage()`, `renderChildrenPage()`, ...) wrap the real provider tree the component needs in production (`AuthProvider`, `ParentPortalProvider`) — never a hand-rolled fake context value, so a context contract change is caught by every consumer's test, not just the context's own test file.

## What NOT to test

- Don't test a third-party library's own behavior (Mongoose's `unique` index enforcement, Stripe SDK internals, `next/link`'s client-side routing) — test that *our* code uses it correctly (e.g. that a 409 is a real duplicate-key outcome, via a route-integration test that actually triggers the collision).
- Don't assert on a CSS Modules class name's literal hashed/scoped value or its exact string identity — assert on rendered text, ARIA roles/attributes (`role`, `aria-selected`, `aria-current`, `aria-checked`), and `href`/`disabled` attributes instead. Every test in this repo already follows this; it's what makes a CSS-only restyle (like the Phase 1–5 shell adoption) not break a single existing test.
- Don't write a snapshot test for anything that changes shape often (a page with real content) — this repo has zero `.snap` files by design.
- Don't add a test whose only assertion is "the mock was called" (see Mocking rules above) — it proves the code called a function, not that the feature works.

## Error-handling contract, and how to test each side

Per `docs/decisions/frontend-005`-style rule (adapted for this project's scale, see `docs/design-system.md`'s Anti-patterns): **queries throw, `LoadError` renders inline, mutations return a status object — never a modal for a load failure.**

- **Query functions** (`fetchX` in `lib/services/*.ts`) let a failed `axios` call's rejection propagate. Test: assert the returned promise **rejects** (`await expect(fetchX()).rejects.toBeTruthy()`), not that it resolves to `null`/`undefined`.
- **`useLoadState`** callers render `<LoadError message={getErrorMessage(error)} onRetry={retry} />` in place of the failed content. Test: MSW responds with an error status, assert `screen.getByRole('alert')` (or the `LoadError`-specific text) appears, then assert `retry()`'s "Try again" button re-fetches (swap the MSW handler to a success response first, then click).
- **Mutation functions** (`createX`/`updateX`/`deleteX`/`bookTrialClass`/`createRegistration`/...) never throw — they resolve to `{ status: 'success', data }` or `{ status: 'error', message }`. Test both branches explicitly: a success-path payload assertion, and an error-path assertion that the UI shows `result.message` (usually via an inline `<Alert variant="error">`) **without the component crashing** — this is the exact phrasing used throughout this repo's admin-CRUD and flow-wizard tests ("shows an inline error ... without crashing") because an uncaught mutation rejection reaching React is the regression this contract exists to prevent.

### The backend side of the contract (`docs/plans/duplication-cleanup-plan.md` PR B)

Every backend error becomes an HTTP response in **one** place, `src/middlewares/errorHandler.js` (registered last in `app.js`); controllers only `catch (error) { return next(error); }`. Errors are built only through `src/utils/errors.js` (`notFoundError`, `badRequestError`, `unauthorizedError`, `forbiddenError`, `conflictError`, or `httpError(status, message)` for a one-off like the 402 card decline) — nothing hand-sets `error.status`. What a test can rely on:

- **A 4xx keeps its own message, byte for byte** — the status alone decides, so a legacy-shaped error (a `.status` and a message, no other flag) is still exposed.
- **A 5xx never carries the internal message** — the client gets the fixed `'Something went wrong'` and the real error is logged server-side. Assert a server failure with `expect(res.body).toEqual({ message: 'Something went wrong' })`, and (as `level.routes.test.js` does) that the secret text is absent; spy `console.error` to keep the log out of the output.
- **Mongoose `ValidationError` → 400** with the per-field messages joined; **`CastError` (a malformed id in a URL) → 400** `Invalid <path>`. A test that needs a "validation failed" case should assert `400` and the field's own message — never `500`.
- Only `.status` is read, never `.statusCode` (a Stripe SDK error carries a `statusCode` that must not be relayed to our clients).
- The `serviceCatalog` "service not seeded" error is deliberately a **500** (`serviceNotConfiguredError`) — it is a deployment defect, not a missing resource.

The admin *policy* has one home too: `src/utils/roles.js` (`ADMIN_ROLES`, `hasAdminRole`); role *names* stay in `User.ROLES`, and `tests/utils/roles.test.js` fails if the two drift apart.

## Live Audit Scripts

Live audits complement the Jest/MSW layer above by running real browser flows against **staging**
— exercising the real backend, real database, and real Stripe TEST-mode charges, which mocked
Jest tests cannot do. Adapted from CKQ's own "Live Audit Skills" (`docs/plans/audit-system-plan.md`
has the full design + the corrections made porting it, notably: no MCP browser tool is available
in this environment, so this uses a real installed `playwright` package driving an unattended
script, not an agent steering a browser interactively).

### Three-layer strategy

| Layer | Tool | Target | Data | Purpose |
|---|---|---|---|---|
| Jest/MSW (this doc, above) | `jest` | jsdom / `mongodb-memory-server` | Fully mocked/in-memory | Fast, deterministic, runs on every change |
| **E2E (`frontend/e2e/`)** | `@playwright/test`, real Chromium | Real, locally-built Next.js server | Fully mocked (`page.route()`) — no real DB/Stripe | Gates every PR/push to `develop`/`main` (`.github/workflows/ci.yml`) — catches real DOM/routing/accessibility regressions a mocked jsdom render structurally cannot, without the cost or blast radius of talking to real staging |
| Live audit (`audit/`) | Real `playwright` package, headless Chromium | `develop` staging | Real staging DB + real Stripe TEST-mode | Integration truth: real auth, real Stripe behavior, real cross-service wiring — owner-triggered only |

Built 2026-08-28 (`docs/plans/e2e-testing-plan.md`) — this is CKQ's own third layer (a CI-gated
`@playwright/test` suite against a mocked `localhost`), previously deferred by owner decision.
Triggered directly by this repo's own experience: the same day this suite's design was reviewed,
the live audit above caught two frontend commits that had silently broken the register wizard's
DOM days earlier — nothing had run it in the meantime. The E2E layer exists to catch that class of
break within minutes, on every PR, rather than whenever someone next happens to run the live audit.

**What the E2E layer does NOT catch — stated explicitly, not left implicit:** its mocks are
hand-written snapshots of the API's current shape. If the real backend's response shape changes —
a renamed field, a removed status, a 500 from a missing seed step — the E2E suite's mocks keep
returning the old shape and every spec keeps passing. That class of contract drift stays the live
audit's job, since it talks to the real API. Neither layer's green result should be read as proof
the other kind of regression didn't happen.

### Available scripts

| Script | Flow | Accounts |
|---|---|---|
| `audit/run-registration-audit.js` (`/audit-live-registration`) | Trial booking → add-card + group registration → sibling discount, own-fee case (live preview vs. real charge) → card-save decline path → sibling discount, bridge case → registration-charge decline enters retry | Fixed, seeded via `backend/scripts/audit-seed.js`: `audit-parent-1`, `audit-sibling-parent` (2 children), `audit-decline-parent`, `audit-bridge-parent` (2 children), `audit-retry-parent` |

### Rules

- **Staging only** — `https://friscofencing-git-develop-frisco-fencing.vercel.app`. Never
  production. Hard-enforced (`audit/lib/staging-guard.js` exits non-zero), not just documented.
- **Not CI-gated, no cron** — run manually, same "audits are on-demand events" philosophy CKQ's
  own skills document. `docs/plans/audit-system-plan.md`'s D7 explains the tradeoff.
- **Mutates staging** — every scenario creates a real document or completes/declines a real
  Stripe TEST-mode charge. `backend/scripts/audit-reset.js` (`/reset-audit-data`) resets it, and
  is never invoked automatically by the audit script itself.
- **Reports non-fatally** to `/admin/audits` (superadmin-only) — a reporting failure never
  changes the audit's own pass/fail verdict or gets retried.

## E2E Suite (`frontend/e2e/`)

CI-gated Playwright suite against a real, locally-built Next.js server with every backend call
mocked (`page.route()` — `frontend/e2e/fixtures/mock-api.ts`). See `docs/plans/e2e-testing-plan.md`
for the full design; **Phase 1**, plus the private-lesson booking chain (`private-booking.spec.ts`,
2026-09-24) — subscriptions management and spotlight admin remain uncovered, tracked as a future Phase 2.

### Specs

| Spec | Covers | Notes |
|---|---|---|
| `login.spec.ts` | Real login form + role-based redirect, for all 5 roles; a declined-login error message | The only spec that drives the real login UI — every other spec skips straight to a logged-in state via `fixtures/auth.ts`'s `loginAs()` |
| `public-site.spec.ts` | Logged-out `/`, `/classes`, `/coaches` render without a client error; accessibility scans on `/` and `/classes` | Two visual-regression tests are `test.skip()`ed — see the in-file comment: a trustworthy screenshot baseline has to be generated inside the exact CI environment (the Playwright Docker container), which this suite's initial build had no way to do from a Windows dev machine |
| `parent-register.spec.ts` | The register wizard end-to-end — both date-picker UI states (this-month pill row vs. "Enroll for next month", pinned via `page.clock`, never left to whatever day it happens to run), plus a declined-charge-enters-retry case | Directly reproduces two real regressions found 2026-08-28 (a removed "Continue" button, a renamed date-picker group) as a standing check — see the file's D9 cross-reference comment |
| `admin-shell.spec.ts` | Sidebar nav renders for admin/superadmin, a non-admin role is redirected away, an accessibility scan on the dashboard, a full Levels CRUD (create/edit/delete) round-trip | |
| `coach-attendance.spec.ts` | Marking a student attended and saving, with an assertion on the exact PATCH payload | |
| `private-booking.spec.ts` | The public private-lesson listing into the booking wizard: a 10-session pack paid at the quoted total, a booking with an already-paid session, and a coach marking a private lesson attended — exact request payloads asserted | ADR 011 |

### Known, accepted accessibility findings

Both axe-core scans found real, pre-existing WCAG AA color-contrast violations on their first-ever
run — genuine bugs in the app's current CSS, not anything introduced by this suite. One is fixed;
one remains ratcheted (not ignored) in its spec file: the exact known `color-contrast` finding is
allowlisted so the suite ships green, but any OTHER/NEW violation on that page still fails the build.

- Admin dashboard (still ratcheted): the sidebar's brand-role/section-label text
  (`admin/layout.module.css`'s `--sidebar-muted`, effectively `#787f86` on `--sidebar-bg`) —
  4.28:1, needs 4.5:1 (a near-miss). Fixing it means picking a new color (`docs/design-system.md`
  has its own pre-read requirement for touching styling), a real design decision out of scope here.
  **Unchanged by the 2026-08-29 WP-alignment rebrand** (`docs/plans/wordpress-ui-alignment-plan.md`,
  Phase 1) — `--sidebar-bg` moved from `#1b1a17` to `#0e1b2a`, but the two are similarly dark
  (verified, not assumed), so the ratio is still ~4.28:1.
- Home page (fully fixed, ratchet removed): `LevelGrid`'s price text (`.levelFee`) was gold
  `#c8a000` on white (2.47:1); Phase 1 replaced gold with crimson `#b51726` (~6.7:1), which passes.
  Fixing that one unmasked a second, previously-hidden finding on Hero's then-temporary photo
  placeholder (`.photoPlaceholder`, muted `#6b6b63` on border-gray `#e2e0db` — 4.07:1) — the
  original ratchet allowlisted the whole `color-contrast` rule id rather than the specific
  violating node, so it was silently permitting this one too. Phase 1 fixed the underlying CSS
  (`.photoPlaceholder`'s background, ~5:1 now — still used by `SpotlightCard` for a coach/student
  with no uploaded photo) and Phase 2 made it unreachable on this specific page besides (Hero no
  longer renders that element — see `Hero.tsx`). `public-site.spec.ts`'s ratchet is removed
  entirely; the check is back to zero-tolerance.

### Run it

```bash
cd frontend
npx playwright install --with-deps chromium   # first time only
npm run test:e2e                              # headless
npm run test:e2e:ui                           # Playwright's interactive UI mode, for debugging
```

### Rules

- **Fully mocked, never talks to a real backend, database, or Stripe** — safe to run with zero
  setup, zero secrets, zero staging risk.
- **CI-gated**: `.github/workflows/ci.yml` runs this on every PR and every push to `develop`/
  `main`, inside the official Playwright Docker image pinned to the exact same version as
  `frontend/package.json`'s `@playwright/test` — screenshot baselines are only trustworthy when
  generated from that same environment (see the skipped visual tests above).
- **The workflow file alone does not block a merge** — making a red run an actual required check
  needs a one-time GitHub Settings → Branches change only the repo owner can make. See
  `docs/plans/e2e-testing-plan.md`'s D6/§3 for the exact steps.
- **If you touch a flow one of these specs covers, update the matching spec in the same PR** —
  `CLAUDE.md`'s pre-read table has the exact trigger list.

## Coverage Expectations

Minimum targets (CKQ's own numbers) — not goals to game with trivial tests. Both repos already
clear the statements target as of the last real measurement below.

The current numbers live in ONE place, `docs/TEST_COVERAGE.md` (re-measured on every PR that adds or moves tests) — this file states the policy, not the figures, so the two can never disagree.

Re-measure with `TZ=UTC npm test -- --coverage` in each repo (confirmed working, zero new tooling
needed — pass `--` before the flag so it isn't swallowed as a test-path-pattern argument). Not
gated on every PR, but a real regression should be flagged, same as CKQ's own policy.

### vs. CKQ

Checked directly against CKQ's own `docs/TEST_COVERAGE.md`, not assumed: **CKQ doesn't track
backend % coverage at all** — their backend section is entirely test/route counts (264 files,
6,331 tests), no istanbul statement/branch numbers anywhere. The only % figure in their whole
doc is frontend, dated 2026-05-27 (stale — their codebase has grown enormously since): Statements
92.59% / Branches 76.48% / Functions 62.00% / Lines 92.59%. Frisco's frontend branch and function
coverage (79.48% / 89.03%) already beat that recorded number. CKQ's real edge is scale and
breadth (6,331 tests vs. this repo's much smaller surface area), not necessarily tighter coverage
discipline — they don't measure the metric this section tracks for their main backend at all.

### Branch coverage — read the breakdown, not just the aggregate

A single aggregate branch number hides where the branches are. Read the per-directory table
(`--coverageReporters=text`; the figures are in `docs/TEST_COVERAGE.md`). `src/services` is the
number that reflects business logic. `src/controllers` used to drag the aggregate down because every
controller repeated an untestable `error.status || 500` / `error.message || 'Failed to ...'`
fallback; since `docs/plans/duplication-cleanup-plan.md` PR B those blocks are a one-line
`return next(error)` and the fallback logic lives once, in `src/middlewares/errorHandler.js`, where it
has direct tests (`tests/middlewares/errorHandler.test.js`) — so a low controller-branch number is now a
real signal, not noise.
