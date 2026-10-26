# Testing Strategy — Frisco Fencing Academy

This file is the single source of truth for how tests are structured, mocked and written in this repo. Read it before writing or modifying any test. It follows CKQ's `docs/TESTING_STRATEGY.md` structure (restructured in `docs/plans/testing-strategy-refresh-plan.md` PR E), scaled to this repo. Tests are part of every feature PR, not a follow-up.

## Overview

| Layer | Location | What it tests | Real DB / network? |
|---|---|---|---|
| Backend unit | `backend/tests/utils/*.test.js`, `backend/tests/services/billing/*.test.js` | Pure functions — password hashing, JWT signing, discount math, date/period calculations | No |
| Backend service | `backend/tests/services/*.test.js` (e.g. `mail.service.test.js`, `renewal.service.test.js`) | A single service module's behavior, including its Mongoose model interactions | Yes — `mongodb-memory-server` |
| Backend route-integration | `backend/tests/routes/*.routes.test.js` | Full HTTP round-trip through Express (auth → controller → service → model) via Supertest, against a real ephemeral Mongo | Yes — `mongodb-memory-server` |
| Backend payment adapter | `backend/tests/payments/*.test.js` | The payment provider port and each adapter, against the provider's real TEST mode (one shared contract suite) | Real provider TEST mode |
| Frontend component | `frontend/app/**/__tests__/*.test.tsx` colocated with the component/page | A single component's/page's rendered behavior, including its network calls | Mocked — MSW (strict) |
| Frontend hook | `frontend/lib/hooks/__tests__/*.test.ts` | A hook's state machine in isolation (`@testing-library/react`'s `renderHook`) | No, or MSW if the hook itself fetches |
| Frontend service | `frontend/lib/services/__tests__/*.test.ts` | The query-throws / mutation-never-throws contract for one service file | Mocked — MSW (strict) |
| Static guards | `backend/tests/guards/`, `backend/tests/payments/providerBoundaryGuard.test.js`, `frontend/lib/__tests__/guards/` | Repo-wide rules a reviewer would otherwise have to remember (see each section's "Static guards") | No |
| E2E | `frontend/e2e/*.spec.ts` (`@playwright/test`) | Full browser flows through a real, locally-built Next.js server — login/role-redirect, the register wizard, the admin shell, coach attendance, the public site — real DOM/routing/hydration a mocked jsdom render can't exercise | Real Chromium, real Next.js server; network fully mocked (`page.route()`), no real backend/DB |
| Live audit | `audit/` | Real browser flows against **staging** — real backend, DB and Stripe TEST mode | Yes — staging (owner-triggered) |

Backend tests mirror `backend/src/`: `src/services/subscription.service.js` → `tests/services/subscription.service.test.js`. Frontend tests live colocated in `__tests__/` next to the component/page/hook/service they cover — never in a parallel top-level `tests/` tree.

**Three layers, three different jobs.** Jest/MSW is fast and deterministic and runs on every change. The E2E suite proves real DOM, routing and accessibility in a real browser, with the network mocked. The live audit is the only layer that talks to the real API, so it is the one that catches contract drift between the mocks and the backend (see "Live audits"). No layer's green result is evidence about another layer's job.

The current counts and coverage figures live in ONE place, `docs/TEST_COVERAGE.md` — this file states the policy, not the numbers.

---

## Backend

### Stack
- **Runner:** Jest (`backend/jest.config.js`, `testEnvironment: 'node'`, `testMatch: tests/**/*.test.js`)
- **HTTP testing:** Supertest against the real Express `app`
- **Database:** `mongodb-memory-server` — a real Mongo engine per test file (`tests/testUtils/db.js`)
- **Payments:** the provider's real TEST mode, reached only through `tests/testUtils/payments.js`

### Test structure
```
backend/tests/
  config/ email/ middlewares/ models/ utils/   unit tests (pure functions, schema rules)
  services/                                   service tests (real in-memory DB)
  routes/                                     route-integration tests (Supertest)
  scripts/                                    migration/backfill helpers (scripts/lib/*), real in-memory DB
  payments/                                   provider port + adapters + the shared contract suite
  guards/                                     static guards
  testUtils/                                  shared helpers: db, clock, sessions, payments, privateLessons, fakePaymentProvider
```

### Test commands
```bash
cd backend
npm test                 # cross-env TZ=UTC jest --ci
npm run test:coverage    # the same, with coverage and the 80% statements floor (what CI runs)
npm run test:watch
npx cross-env TZ=America/Chicago npx jest <file>   # hunt a timezone-only failure on purpose
```

### What to test at each layer
- **Unit** — input → output, no DB, no network. Date and money math are tested here with literal expected values.
- **Service** — business rules against a real in-memory DB: edge cases, not-found records, invariants (one active subscription per student, one ledger row per period).
- **Route-integration** — the full request: happy path plus, for **every** route, its negative paths: **401** without a session, **403** for each role the route refuses, **400** for invalid input, **404** for an unknown id. A negative test also asserts that nothing was written. `/audit-tests` Check 11 counts these: a route test file needs at least as many 4xx/5xx assertions as its route file has routes.

### Mocking rules

**Mock at the network boundary, never at the module/service boundary.**

| Dependency | Approach |
|---|---|
| MongoDB | Real `mongodb-memory-server` per test file, never `jest.mock('../models/...')`. Schema validation, indexes and Mongoose middleware all run for real. |
| Payment provider | **Not mocked** — the provider's TEST mode is hit for real (see below). Business and route tests reach it only through `tests/testUtils/payments.js`. |
| Payment port's own unit tests | `tests/testUtils/fakePaymentProvider.js` (`contract.test.js`, `index.test.js` only — never a business test) |
| `@vercel/blob` | `jest.mock('@vercel/blob')` — Blob has no test mode; a real call uploads to the live store |
| Email | Nodemailer's Ethereal fallback / the `APP_ENV` gate (`docs/modules/email.md`) — no real email is sent from a test |

- Real payment-provider TEST-mode calls on the backend (`registration.routes.test.js`, `paymentMethod.routes.test.js`, the renewal and private-lesson suites) are **not** mocked at all — providers explicitly design test mode to be hit for real, and mocking it risks drifting from the provider's actual API contract. Since the payment provider port ([ADR 013](./decisions/013-payment-provider-port.md)), business and route tests reach the provider **only** through `tests/testUtils/payments.js` and assert only normalized shapes (`{ id, status, amount (dollars), reference, customerId }`), so the same suites run against any provider. Provider objects are created directly only in `tests/payments/**` — the adapter suites, which all run one shared contract suite (`tests/payments/providerContract.shared.js`). `tests/testUtils/fakePaymentProvider.js` is for the port's own unit tests (`contract.test.js`, `index.test.js`), never for a business test. `tests/payments/providerBoundaryGuard.test.js` enforces all of this.
- `@vercel/blob`'s `put()` on the backend (`spotlight.routes.test.js`, `testimonial.routes.test.js`) — unlike Stripe, Blob has no separate test mode; calling it for real from a test would actually upload a file to the live store. `jest.mock('@vercel/blob')` is the exception here, not the Stripe-style "hit it for real" rule.

### Real payment provider in tests — never read the account as a whole

A provider's TEST account is **one account shared by every CI run and every developer machine at the same time**. A test must never read it account-wide: no "list the newest 10 payments" and pick-by-amount, no finding a customer by email. When CI runs overlap, which happens every time several PRs merge within a minute, another run's objects show up in those reads. This happened on 2026-09-24: three overlapping runs failed by picking up each other's Stripe PaymentIntents, and a before/after count of `list({ limit: 10 })` could never fail, because both lists were always 10. Use `tests/testUtils/payments.js` instead. Every lookup there is keyed to something only this test owns:

- **"Was this charged correctly?"**: `expectLedgerChargeSucceeded(ledgerRow, dollars)` fetches the exact payment the ledger row recorded, then asserts it succeeded, the amount matches, it carries the row's own id as its reference, and it belongs to that row's own parent. This proves the ledger-to-provider link, not merely that some charge of that amount exists somewhere.
- **"Was it charged exactly N times, or never?"**: `listCustomerPayments(userId)` returns every payment on that user's own provider customer. Each test parent gets a fresh customer, so the expected count is exact (`toHaveLength(0)` for "never charged").
- **"Which customer / which cards?"**: `customerIdOf(userId)` reads the id our code stored, from our own database; `listCustomerCards(userId)` lists the cards attached to that customer (proves a replaced card was detached, a declined one never attached).
- **Cards for a test**: `mintCardToken('success' | 'declineAtAttach')` mints a fresh browser-style token; `declineAtChargeCardId()` is a saved-card id that declines when charged; `successCardDetails()` is the brand/last4 a success card saves as. `retrievePayment(id)` and `signWebhook(payload)` cover the rest.

Production code follows the same principle: stale-pending recovery asks the provider for a payment by our own unique Registration id, never by amount. Note that a provider's search can be **eventually consistent** — Stripe's PaymentIntent search took 24 s to see a brand-new charge in the contract suite's first run (2026-10-26) — so a test that searches polls with a bounded wait (`providerContract.shared.js`'s `eventually`), and production recovery prefers the payment id recorded on the row (`docs/plans/payment-provider-port-plan.md` D4).

### Billing races

Every subscription-**charging** test — both `renewOne` (renewal) and `retryOne` (retry/dunning, `docs/plans/registration-ledger-plan.md` D6) — must explicitly cover the cancel-then-charge race: a subscription cancelled between snapshot and charge-time must never be charged. This is the exact bug class the in-house billing model (`docs/decisions/001-in-house-subscription-billing.md`) exists to prevent — it needs a regression test on EACH charging path, not just a design doc, and not just the first path that happened to exist when this rule was written.

### Naming & placement
- `<subject>.routes.test.js` for a route-integration suite, `<subject>.service.test.js` for a service-unit suite, mirroring `src/`'s directory shape one-for-one under `tests/`.
- Describe block: the route or function under test. Test label: plain English naming the scenario and outcome (`'returns 403 for a coach and creates nothing'`).
- A seed/helper function lives at the narrowest scope that contains **all** of its users: inside a `describe` only if that one block uses it, at **file scope** the moment a second `describe` needs it. (A helper first written inside one `describe` and later needed by a sibling fails with a `ReferenceError` — there is no linter in `backend/` to catch an out-of-scope name at write time, so this convention plus running the suite is the guard.)
- One `describe` per route/service; a nested `describe` for a named regression, so a reviewer can see which bug a test guards against.

### Error-handling contract — the backend side (`docs/plans/duplication-cleanup-plan.md` PR B)

Every backend error becomes an HTTP response in **one** place, `src/middlewares/errorHandler.js` (registered last in `app.js`); controllers only `catch (error) { return next(error); }`. Errors are built only through `src/utils/errors.js` (`notFoundError`, `badRequestError`, `unauthorizedError`, `forbiddenError`, `conflictError`, or `httpError(status, message)` for a one-off like the 402 card decline) — nothing hand-sets `error.status`. What a test can rely on:

- **A 4xx keeps its own message, byte for byte** — the status alone decides, so a legacy-shaped error (a `.status` and a message, no other flag) is still exposed.
- **A 5xx never carries the internal message** — the client gets the fixed `'Something went wrong'` and the real error is logged server-side. Assert a server failure with `expect(res.body).toEqual({ message: 'Something went wrong' })`, and (as `level.routes.test.js` does) that the secret text is absent; spy `console.error` to keep the log out of the output.
- **Mongoose `ValidationError` → 400** with the per-field messages joined; **`CastError` (a malformed id in a URL) → 400** `Invalid <path>`. A test that needs a "validation failed" case should assert `400` and the field's own message — never `500`.
- Only `.status` is read, never `.statusCode` (a Stripe SDK error carries a `statusCode` that must not be relayed to our clients).
- The `serviceCatalog` "service not seeded" error is deliberately a **500** (`serviceNotConfiguredError`) — it is a deployment defect, not a missing resource.

The admin *policy* has one home too: `src/utils/roles.js` (`ADMIN_ROLES`, `hasAdminRole`); role *names* stay in `User.ROLES`, and `tests/utils/roles.test.js` fails if the two drift apart.

### What NOT to test
- Don't test a third-party library's own behavior (Mongoose's `unique` index enforcement, Stripe SDK internals) — test that *our* code uses it correctly (e.g. that a 409 is a real duplicate-key outcome, via a route-integration test that actually triggers the collision).
- Don't add a test whose only assertion is "the mock was called" — it proves the code called a function, not that the feature works.

---

## Date rules (backend and frontend)

- **Never sample the real clock against a "today"-computing subject.** If a component/service computes anything relative to `new Date()` (e.g. book-trial's same-day session filter), freeze time at a literal instant rather than asserting against whatever the wall clock happens to read when CI runs.
- **Fixture instants use midday UTC** (`T12:00:00Z`), not midnight — a midnight UTC instant renders as "yesterday" in every timezone west of UTC, which is exactly the class of flake this rule exists to prevent.
- **Suites always run under `TZ=UTC`**, matching the CI runner and production: `npm test` sets it itself (`cross-env TZ=UTC jest --ci`) in both `backend/` and `frontend/`, so a local run on any machine reproduces CI. A test that only fails in one timezone is a real bug, not a fluke — to hunt for one, run `npx cross-env TZ=America/Chicago npx jest <file>` explicitly.
- **Never let a suite's result depend on the time of day it runs.** A schedule created through the real route (or `generateInitialSessions`) generates its first session from the real clock — on that schedule's own weekday, `sessions[0]` is *today's* occurrence, and once its start time has passed it is "started" (no new Visit, not bookable). So either freeze the clock BEFORE seeding (e.g. a Tuesday morning for a Wednesday class) or pick a session that is always weeks ahead (`sessions[sessions.length - 1]`), never `sessions[0]`, when the test needs an upcoming session.
- No time-bomb dates: use fixed historical/near-term instants under a pinned clock, never "now + N days" logic that silently breaks on a future run (e.g. `ACTIVE_SUBSCRIPTION.currentPeriodEnd` fixtures use a literal `'2026-02-01T00:00:00.000Z'`, not `addDays(new Date(), 30)`).

### Code that reads "now" — pin the clock, one instant per branch

When the code under test reads "now" and changes its answer by weekday, time of day or date, a test on the real clock exercises only the branch that matches the moment CI happens to run. It passes almost every run and fails in one narrow window, and re-runs make it look flaky though it is deterministic (this repo's own Wed/Tue-after-4pm-Central flake; CKQ's 2026-10-06 incident).

1. **Pin the clock** at a hardcoded literal instant, one test per branch (before/after a cut-off, on/off the target weekday). Backend: `tests/testUtils/clock.js`'s `freezeAt('<ISO instant>')` — it fakes **only** `Date` (the Mongo driver, supertest and the payment SDK need real timers, or the suite hangs) — and `jest.useRealTimers()` afterwards. Frontend: `jest.useFakeTimers({ now })` where MSW is not involved; where it is, swap `Date` alone (see `app/parent/register/__tests__/page.test.tsx`'s top comment — fake timers + MSW's XHR stack hang Testing Library's polling).
2. **Never derive the pinned instant from the real clock** (`new Date()`, `moment()`), and verify — don't assume — that the literal has the property the assertions need (weekday, days left in the month). Mid-month (the 10th–15th) is safe for "some sessions remain"; a boundary case pins its exact boundary.
3. **A bare `jest.useFakeTimers()` is not a pin** — it starts at the real time.
4. **Write expected values as literals.** Never compute the expected value with the code under test or the helper it calls.
5. **When a shared date rule changes, sweep its callers' tests in the same PR.**
6. **Check a pin at a second instant** when you choose it: a test that passes at one valid instant and fails at another depends on something the pin does not control.

`realClockDateHelperGuard.test.js` (below) fails the build when a backend test calls `todayAtMidnight()`/`todayDateOnly()` in a file that does not pin the clock.

### Timezone day-boundary math — use `todayAtMidnight`/`todayDateOnly`/`addOneDay`, never raw `setHours`/`setDate`/`setMonth` on a real instant

`backend/src/utils/billingDates.js` exports the tz-aware primitives (`docs/plans/timezone-consistency-plan.md`, added 2026-08-28 after CKQ's own `dateUtils.js` history — the same day-boundary bug shipped there four separate times before being centralized). Two distinct kinds of `Date` values flow through this codebase — which one a test's fixture represents determines which rule applies:

- **Real instants** (an actual point in time — `todayAtMidnight()`'s own output, `new Date()`): resolved via real IANA timezone math (`moment-timezone`, `DEFAULT_TIMEZONE` from `config/timezone.js`). Never compute a day boundary from one with raw `setHours(0,0,0,0)`/`setDate`/`setMonth` — those operate on the JS runtime's local calendar fields (UTC in this test runner and in production), which silently disagrees with the intended Central calendar day for part of every day (`billingDates.js`'s own docblock has the full explanation). `addOneDay()` is the one function in this file that adds to a real instant and needs genuine DST-safe math — see `tests/utils/billingDates.test.js` for the "prove the fix" pattern (assert against a real 2026 DST-transition instant, contrasted with what raw math would have produced).
- **Date-only sentinels** (a UTC-midnight `Date` representing a pure calendar day with no real timezone meaning, e.g. `new Date('2026-03-08')`, matching `GroupClassSession.date`'s own storage convention — `anchorDate`/`currentPeriodStart`/`currentPeriodEnd` are always this shape): use plain calendar-component arithmetic (`addOneMonth`/`addMonths`/`daysInMonth`/`endOfMonth`, unchanged, zero DST exposure by construction). **Do not** wrap these in `moment(date).tz(tz)...` — reinterpreting a date-only sentinel through a real timezone lens shifts it onto the wrong calendar day (a bug that shipped and was caught mid-implementation, not merely theorized — `docs/plans/timezone-consistency-plan.md` D9 has the worked example). If a new helper needs to add to a date-only value, it needs `moment.utc(date).add(...)`, not `moment(date).tz(tz).add(...)`.

**Mock fidelity matters here specifically** (same class of trap CKQ's own `dateUtils.js` docs flag): if a suite ever mocks `billingDates.js`/`config/timezone.js` wholesale, the mock must reflect real input/tz behavior, not a naive stub that ignores its arguments — a stub that always returns the same fixed value would make a test pass without exercising anything real.

**Sentinel/instant construction goes through `dateShapes.js`, never hand-rolled** (`docs/plans/utc-date-standard-plan.md`) — `backend/src/utils/dateShapes.js` is the gate for both shapes outside the billing domain: `dateOnlyUTC`/`addDaysToDateOnly`/`nextDateOnlyOnOrAfter` build/step calendar-day sentinels (`GroupClassSession.date`), `combineDayAndTimeInTZ` builds real instants from a wall-clock day+time (`PrivateClassSession.startDate`/`endDate`). A test that hand-builds a sentinel or instant any other way (raw `setHours`/`setDate` on an instant, `moment(sentinel).tz(tz)` on a sentinel) is testing the wrong contract even if it happens to pass under `TZ=UTC` — write fixtures the same way the gate would produce them. The frontend has the equivalent module, `frontend/lib/formatDate.ts` (`formatDateOnly`/`formatInstant` for rendering, `CalendarDay` helpers for date-only arithmetic like the register wizard's start-date window) — same two-shape contract, same rule against hand-rolled `toLocaleDateString`/local `Date` getters on a sentinel.

**"Has this group-class session started / is it upcoming?" is answered ONLY by `GroupClassSession.startsAt` vs a real `now`** (`startsAt: { $gt: now }` / `session.startsAt <= now`) — never by comparing `GroupClassSession.date` to `todayDateOnly()`. That is a day comparison and was the bug `docs/plans/session-start-time-cutoff-plan.md` fixed (a 4 pm class stayed bookable until midnight). The day comparison is legitimate only for genuinely *day*-granular questions (holidays, the unique index, a display window's far edge, and the attendance-open gate) — which shape answers which question, and why, is stated once in `docs/decisions/009-utc-date-storage-standard.md`'s addendum. Session fixtures build `startsAt`/`endsAt` through `tests/testUtils/sessions.js`'s `createSession`/`sessionFixture` (which call the production `sessionInstantsFor`), never by hand — the model requires both fields, so a raw `GroupClassSession.create({ scheduleId, date })` fails validation. A fixture session that a test needs to be *open for attendance* goes through the same file's `makeSessionAttendable(session, schedule)` (moves it to a fixed past day and recomputes the instants); a test that needs a *closed* one uses a session generated weeks ahead — never the real clock.

**Private-lesson bookings ([ADR 011](./decisions/011-private-per-session-booking.md)) use `tests/testUtils/privateLessons.js`**: `freezeDate()` fakes only `Date` at a fixed Monday morning (every timer stays real, so Mongo, supertest and the Stripe SDK work), `seedCoachWithRules` publishes availability through the real bulk endpoint, and `seedBooking` builds a booking's instants with the production `combineDayAndTimeInTZ`. "Has this private lesson started?" is `PrivateClassSession.startDate` vs a real `now` — an exact instant, never a day comparison. When a test moves the frozen clock forward, keep it within 7 days of login: the auth cookie's JWT expires after that, and the request fails with 401 rather than the behavior under test.

---

### Static guards (backend)

Jest tests stand in for a linter (`backend/` has no ESLint). Each has a matcher self-test and a "scanned enough files" floor, so a moved directory cannot silently disable it.

- **`tests/guards/noFocusedOrBareSkip.test.js`** — no `.only` / `fit` / `fdescribe`; every `.skip` / `xit` / `xdescribe` / `xtest` carries a `//` reason of at least five words on its line or in the comment block directly above.
- **`tests/guards/realClockDateHelperGuard.test.js`** — a test (or `testUtils/` helper) that calls `todayAtMidnight(` or `todayDateOnly(` must pin the clock in the same file (`freezeAt(`, `freezeDate(`, `jest.useFakeTimers({ … now … })` or `setSystemTime(`). Comment lines are ignored. The exemption list holds only the guard itself, and a "still needed" test fails once an exempted file pins its clock.
- **`tests/payments/providerBoundaryGuard.test.js`** — only an adapter (`src/payments/<provider>/`) and its SDK bootstrap may require a provider SDK; business code goes through `getPaymentProvider()`; nothing outside an adapter inspects a provider's error shape; tests reach a provider only through `testUtils/payments.js` and `tests/payments/**`. Empty allowlist.

---

## Frontend

### Stack
- **Runner:** Jest + `next/jest`, `jest-environment-jsdom` (`frontend/jest.config.js`, `jest.setup.js`)
- **Component testing:** React Testing Library
- **User interaction:** `@testing-library/user-event` v14 — always the setup API (rule below)
- **Network:** MSW v2 (`msw/node`), strict (rule below)
- **Navigation:** `jest.mock('next/navigation', ...)`

### Test commands
```bash
cd frontend
npm test                 # cross-env TZ=UTC jest --ci
npm run test:coverage    # with coverage and the 80% statements floor (what CI runs)
npm run typecheck        # tsc over the app AND e2e/ — Jest and next build type-check neither tests nor mocks
npm run test:watch
```

### `userEvent`, not `fireEvent`

Tests drive user interaction with `userEvent`, not `fireEvent`, for anything a real user does (clicks, typing, selecting an option, clearing a field). The suite was converted in `docs/plans/testing-strategy-refresh-plan.md` PR D.

**Why it matters in React 18:** `fireEvent.click` wraps state updates in a synchronous `act()`. It flushes synchronous state but cannot drain the promise microtask queue, so a component that runs `someService().then(setState)` after a click may not have updated by the time `fireEvent` returns. `await user.click()` uses an async `act()` and drains it. `userEvent` also behaves like a person: it types onto a field's existing value (two edit tests passed under `fireEvent.change`, which replaces the value, and failed once converted — an edit test must `user.clear()` first). **The symptom of the `fireEvent` bug is a `findBy*` timeout that goes away when you raise `{ timeout }`.** That is a patch, not a fix; the cause is a missing async flush.

```tsx
let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

await user.click(screen.getByRole('button', { name: /save/i }));
await user.clear(nameInput);
await user.type(nameInput, 'Beginner Foil Updated');
await user.selectOptions(screen.getByLabelText('Level'), 'level-1');
```

A file that installs fake timers part-way through uses `userEvent.setup({ delay: null })` (`app/kiosk/__tests__/page.test.tsx`), so `userEvent` never waits on a timer. `fireEvent` is allowed only as a documented exception, with a `// fireEvent kept: <reason>` comment on its line or the line above; `userEventGuard.test.ts` enforces this (none exist today).

### MSW pattern — strict

```tsx
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../test-utils/msw';

const server = setupServer(
  http.get('*/auth/me', () => new HttpResponse(null, { status: 401 }))
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

- **A request no handler matches fails the test that made it.** `frontend/test-utils/msw.ts` records it and `jest.setup.js` throws in `afterEach`, listing the requests. A component that tolerates a failed request would otherwise let the test pass while the page does something unplanned. The fix is a handler that says what the real backend answers, including its error answers (`register-private`'s "slot no longer offered" mirrors the backend's real 404). `mswStrictGuard.test.ts` enforces the `listen()`.
- Handlers use a wildcard host (`'*/levels'`), matching the axios base URL in any environment.
- The `setupServer(...)` call, its lifecycle triple, and any `jest.mock('next/navigation', ...)` live at the top of the file, above the `describe` blocks — never inside a single test.
- **Never `jest.mock('../../lib/services/parent')`** (or any other service file) to stub an HTTP call — that hides the exact bug class this layer exists to catch: a service function that silently drifts from what the backend returns.
- **Never assert "a service function was called with X."** Assert on the *rendered result* of a real (MSW-intercepted) round-trip; a request-payload assertion reads the body MSW's handler received (`await request.json()`).

**Named, narrow exceptions where module-level `jest.mock` IS the correct call:**

- `next/navigation` (`useRouter`, `usePathname`, `useSearchParams`, `useParams`, `redirect`) — there is no real Next.js router in a Jest/jsdom environment to exercise; mocking it is the only option, not a shortcut.
- A context provider, when the test's whole point is isolating one consumer component from the rest of that context's tree (rare — prefer rendering with the real provider + MSW, as every test in this repo does today).
- A payment provider's browser SDK — `@stripe/stripe-js`'s `loadStripe` and `@stripe/react-stripe-js`'s `CardElement`/`Elements`/`useStripe`/`useElements` (and, from payment PR 5, Square's Web Payments SDK through a `window.Square` stub) — the card field renders into a cross-origin iframe that jsdom cannot simulate at all; there is no way to "type a card number" into it in a test environment. This is an external-SDK exception, not our own service boundary — `GET /payments/config` and the `POST /payment-methods` call the form makes afterward still go through MSW like any other endpoint. Type an SDK stub from the real function (`jest.fn<ReturnType<typeof loadStripe>, Parameters<typeof loadStripe>>()`), never bare. Only `app/components/payment/` may import a provider SDK in production code (`lib/__tests__/guards/paymentSdkBoundaryGuard.test.ts`).

### Typed fixtures

No `any` on domain data in tests. Every frontend fixture object (a `Location`, a `Student`, a `Subscription`, ...) must satisfy the real type from `frontend/lib/types.ts` — if a fixture doesn't type-check, either the fixture is wrong (fix the literal) or the type is wrong (fix the type against the real backend model/controller, never widen it to `any` to make the fixture compile). A response *envelope* (`{ levels: [...] }`) is named once in `frontend/lib/apiResponses.ts` and used by both the service that reads it and any mock that fakes it. Backend test fixtures are plain Mongoose `.create()` calls against the real schema, so this is enforced structurally by Mongoose validation rather than by hand.

### Naming & placement
- `__tests__/page.test.tsx` for a page, `__tests__/index.test.tsx` for a component whose file is `index.tsx`, `__tests__/<Name>.test.tsx` for a named component file, `__tests__/<name>.test.ts` for a hook or service module.
- One `describe` block per component/page/service under test; a nested `describe` for a named regression (see `BookTrialPage wizard — same-day session regression (bug fix)` in `book-trial/__tests__/page.test.tsx`).
- Render helpers (`renderLocationsPage()`, `renderChildrenPage()`, ...) wrap the real provider tree the component needs in production (`AuthProvider`, `ParentPortalProvider`) — never a hand-rolled fake context value, so a context contract change is caught by every consumer's test. A test that asserts only on the first render waits for the provider's own load to settle (e.g. `app/register`'s `AuthSettled` probe), so the load never lands after the test, outside `act()`.

### Error-handling contract — the frontend side

**Queries throw, `LoadError` renders inline, mutations return a status object — never a modal for a load failure** (`docs/design-system.md`'s Anti-patterns).

- **Query functions** (`fetchX` in `lib/services/*.ts`) let a failed `axios` call's rejection propagate. Test: assert the returned promise **rejects** (`await expect(fetchX()).rejects.toBeTruthy()`), not that it resolves to `null`/`undefined`.
- **`useLoadState`** callers render `<LoadError message={getErrorMessage(error)} onRetry={retry} />` in place of the failed content. Test: MSW responds with an error status, assert `screen.getByRole('alert')` (or the `LoadError`-specific text) appears, then assert `retry()`'s "Try again" button re-fetches (swap the MSW handler to a success response first, then click).
- **Mutation functions** (`createX`/`updateX`/`deleteX`/`bookTrialClass`/`createRegistration`/...) never throw — they resolve to `{ status: 'success', data }` or `{ status: 'error', message }`. Test both branches explicitly: a success-path payload assertion, and an error-path assertion that the UI shows `result.message` (usually via an inline `<Alert variant="error">`) **without the component crashing** — this is the exact phrasing used throughout this repo's admin-CRUD and flow-wizard tests ("shows an inline error ... without crashing") because an uncaught mutation rejection reaching React is the regression this contract exists to prevent.

### What NOT to test
- Don't assert on a CSS Modules class name's literal hashed/scoped value or its exact string identity — assert on rendered text, ARIA roles/attributes (`role`, `aria-selected`, `aria-current`, `aria-checked`), and `href`/`disabled` attributes instead. It's what makes a CSS-only restyle not break a single existing test.
- Don't write a snapshot test for anything that changes shape often (a page with real content) — this repo has zero `.snap` files by design.
- Don't test `next/link`'s client-side routing or any other library internal.
- Don't assert that removed UI is absent once it is gone (`queryByText('<deleted label>')).not.toBeInTheDocument()` can never fail). `scripts/dead-negative-assertions.mjs` finds candidates.

### Static guards (frontend)

All in `frontend/lib/__tests__/guards/`, each with a matcher self-test and a scanned-files floor:

- **`noFocusedOrBareSkip.test.ts`** — the backend rule, over the Jest tests in `app/` and `lib/` and the Playwright specs in `e2e/` (plus Playwright's `test.fixme`, which is a skip).
- **`userEventGuard.test.ts`** — `fireEvent` only with a `// fireEvent kept: <reason>` comment.
- **`mswStrictGuard.test.ts`** — every `server.listen(` passes the strict `onUnhandledRequest` from `test-utils/msw`.
- **`e2eCatchAllGuard.test.ts`** — only `e2e/fixtures/mock-api.ts` may register a `**/api/v1/**` route.
- **`e2eMockLayerGuard.test.ts`** — every spec imports `test` from `fixtures/test`, never as a value from `@playwright/test`.
- **`e2eWaitOrderGuard.test.ts`** — no directly awaited `page.waitForResponse`/`waitForRequest`, no synthetic `visibilitychange`.
- **`paymentSdkBoundaryGuard.test.ts`** — in production code, only `app/components/payment/` loads or calls a payment provider's browser SDK (`@stripe/*`, and Square's CDN script or `window.Square` from payment PR 5); pages render `<PaymentMethodCollector>`. Tests may stub an SDK (`docs/decisions/013-payment-provider-port.md`).
- **`selfHostedFontsGuard.test.ts`** — no file loads fonts from Google; every font file `app/layout.tsx` points at exists (a `next/font/google` build-time fetch failed a develop build, 2026-09-30).
- **`playwrightVersionGuard.test.ts`** — `@playwright/test`, `playwright-core` and the CI Playwright image tag are the same version.
- **`portalTableWrapGuard.test.ts`** — every table styled with the portal's shared `.table` sits directly inside a `.tableWrap` (`overflow-x: auto`), so a wide table scrolls in its own box instead of the whole page on a phone.

---

## E2E (`frontend/e2e/`)

CI-gated Playwright suite against a real, locally-built Next.js server with every backend call mocked (`page.route()` — `frontend/e2e/fixtures/mock-api.ts`). Design: `docs/plans/e2e-testing-plan.md`; loud-fail, typed mocks and the phone project: `docs/plans/testing-strategy-refresh-plan.md` PR B.

### Commands
```bash
cd frontend
npx playwright install --with-deps chromium   # first time only
npm run test:e2e                              # both projects, headless
npx playwright test --project=mobile-chrome   # one project
npm run test:e2e:ui                           # interactive UI mode, for debugging
npx playwright test --list                    # the per-project count TEST_COVERAGE.md records
```

### What belongs in E2E — and what does not
- **Belongs:** login → navigate → act → outcome flows; multi-step wizards; anything that depends on real routing, redirects, cookies or hydration; accessibility scans; real layout (sideways scroll, what fits on a phone).
- **Does not:** anything a Jest/MSW test already covers; logic with no meaningful UI; the real API contract (that is the live audit's job — the E2E mocks are hand-written snapshots of the API's shape).

### Projects

| Project | Device | Specs |
|---|---|---|
| `chromium` | Desktop Chrome | every spec |
| `mobile-chrome` | Pixel 5 (393 px, touch) | `public-site`, `login`, `calendar`, `kiosk`, `billing`, `subscriptions` — the pages parents, students and staff mostly reach on a phone. A spec joins once it passes on a phone and any layout bug it finds is fixed in the product, never by relaxing the spec. |

### Specs

| Spec | Covers | Notes |
|---|---|---|
| `login.spec.ts` | Real login form + role-based redirect, for every role; a declined-login error message | The only spec that drives the real login UI — every other spec skips straight to a logged-in state via `fixtures/auth.ts`'s `loginAs()` |
| `public-site.spec.ts` | Logged-out `/`, `/classes`, `/coaches` render without a client error; the `/classes` level filter as a pill row (desktop) and a `<select>` (phone); no sideways scroll at 360 px on `/`, `/classes`, `/coaches`, `/calendar`; accessibility scans on `/` and `/classes` | Two visual-regression tests are skipped until a baseline is generated inside the CI container — see the in-file comment |
| `parent-register.spec.ts` | The register wizard end-to-end — both date-picker UI states (this-month pill row vs. "Enroll for next month", pinned via `page.clock`), plus a declined-charge-enters-retry case | Directly reproduces two real regressions found 2026-08-28 (a removed "Continue" button, a renamed date-picker group) as a standing check |
| `admin-shell.spec.ts` | Sidebar nav renders for admin/superadmin, a non-admin role is redirected away, an accessibility scan on the dashboard, a full Levels CRUD round-trip | |
| `coach-attendance.spec.ts` | Marking a student attended and saving, with an assertion on the exact PATCH payload | |
| `holiday-blocking.spec.ts` | Admin holiday CRUD; both wizards' pickers never offer a blocked date; coach attendance's blocked state; the admin sessions list's holiday row | `docs/plans/holiday-blocking-plan.md` |
| `calendar.spec.ts` | The public `/calendar`: a class and an open slot on the right days, filtering by coach (kept in the URL), a logged-out click landing on login with the wizard link in `next`, a parent's click opening the wizard with the date already picked, the List view by default on a phone, and zero-tolerance axe scans of both views | Clock pinned to `CALENDAR_NOW` (`fixtures/mock-api.ts`). Month-grid tests ask for `?view=month`, since a phone opens the List view by design. `docs/plans/calendar-view-plan.md` |
| `kiosk.spec.ts` | The front-desk sign-in tablet as the `kiosk` login: type → confirm → signed-in card → back to the search after 5 s (`page.clock`), the exact sign-in body; confirmation switched off; a 409 message inline with the search still usable | `docs/plans/kiosk-signin-plan.md` |
| `private-booking.spec.ts` | The public private-lesson listing into the booking wizard: a 10-session pack paid at the quoted total, a booking with an already-paid session, a slot taken mid-checkout (the server's 409 shown, nothing booked, dates refetched, back to the date step), and a coach marking a private lesson attended — exact request payloads asserted | ADR 011. Also the register-private wizard's coverage — there is no separate spec |
| `subscriptions.spec.ts` | Parent: cancel (no body, the row then cancels at period end). Admin: the status filter (asks the server, shows only its rows), Change Schedule (same-level options only, exact `{ newScheduleId }`), cancel and reactivate through their confirm dialogs, a superadmin Charge from the server's preview (exact `{ period: 'full' }`), and no Charge for a plain admin | Runs on the phone project too |
| `billing.spec.ts` | `/parent/billing`: rows across billing shapes, the Manual chip and note, a failed row with no download, the exact invoice `href`, no sideways scroll | Runs on the phone project too |
| `spotlights-admin.spec.ts` | Create with a real multipart image upload (a 1×1 PNG via `setInputFiles`) and the exact create body, publish (the exact PUT body), delete through the confirm dialog | |

### Mocking rules
- **Fully mocked, never a real backend, database or payment provider** — safe to run with zero setup, zero secrets, zero staging risk.
- **Unmocked requests fail loudly.** `installApiMocks` (installed by the shared `page` fixture in `e2e/fixtures/test.ts`) answers any `/api/v1/*` call no rule matches with HTTP **599**, and the test fails in teardown listing every such request. Endpoints a shell or context fires on every page get a typed default in `DEFAULT_RULES`; page-specific data goes in that spec's `mockApi(page, overrides)`. A test that deliberately exercises an unmocked path declares it with `test.use({ allowUnmocked: [pattern] })` (none do today).
- **Every spec imports `test` from `./fixtures/test`** — never as a value from `@playwright/test` (a type-only import is fine). Exactly one `**/api/v1/**` handler exists, in `mock-api.ts`.
- **Mocks are type-locked.** `json<T>(route, status, body)` requires a named response type and checks the body against it (`NoInfer<T>`): an envelope from `lib/apiResponses.ts` or a domain type from `lib/types.ts`. CI's `npm run typecheck` covers `e2e/`, so a backend shape change breaks a stale mock at compile time on the PR that causes it. Never `any`, `as any` or a loose `object` in `e2e/`.
- **Accessibility scans go through one helper**, `expectNoBlockingA11yViolations(page)` in `e2e/helpers/a11y.ts`: only serious/critical violations fail, and the one known finding below is ratcheted there by node.
- **The build is hermetic.** `playwright.config.ts` pins `NEXT_PUBLIC_API_URL` to empty, so a developer's `.env.local` cannot bake an absolute backend origin into the E2E bundle; local runs match CI and production (same-origin `/api/v1` proxy).
- **`test.skip` policy:** no bare skips. A skip carries a comment of at least five words stating the reason (`noFocusedOrBareSkip`). A test that applies only at one width pins that width (below) instead of skipping by device.

### Interaction determinism
1. **Assert settled state, not presence.** Before and after changing a toggle or selection, assert its ARIA state (`aria-checked`, `aria-pressed`, `aria-selected`, `toBeChecked()`). When a flow seeds a default selection, wait for it before touching it.
2. **A toggle without ARIA state is a product bug** — fix the component; never assert on CSS class names.
3. **Client-side redirects: assert the destination** with `expect(page).toHaveURL(...)` plus one element rendered there — never content on the page being redirected away from.
4. **Behaviour changes update E2E in the same PR.** A PR that changes routing, access, redirects or role-gating greps `e2e/` for the affected path (link names **and** `href` selectors) and updates every match; `CLAUDE.md`'s pre-read table lists the triggers.
5. **Recurring flakes are root-caused from the trace** (`trace: 'retain-on-failure'`; the CI job uploads `playwright-report/`). Retries, longer timeouts, `force: true` and skips are not fixes.
6. **Arm network waits before the trigger; drive time with `page.clock`.** `const saved = page.waitForResponse(...); await trigger(); await saved;` — never `await page.waitForResponse(...)` after the action. For polls and timers, `page.clock.install()` before `page.goto`, then `fastForward`; never a synthetic `visibilitychange`. Prefer a web-first assertion when the UI shows the change.
7. **No sideways page scroll.** Phone-width flows assert `expectNoHorizontalOverflow(page)` (`e2e/helpers/layout.ts`, zero tolerance) once the layout has settled. 393 px does not cover 360 px phones, so the public pages have an explicit 360 px check.
8. **A test that depends on width pins it** (`page.setViewportSize`). Every listed spec runs on both projects, and a responsive rule can swap or hide the element (the `/classes` filter is a `<select>` at ≤ 600 px; `/calendar` opens in List view below 768 px).

### Known, accepted accessibility findings

- Admin sidebar, every admin page (still ratcheted, by node, in `e2e/helpers/a11y.ts`): the sidebar's brand-role/section-label text (`admin/layout.module.css`'s `--sidebar-muted`, effectively `#787f86` on `--sidebar-bg`) — 4.28:1, needs 4.5:1 (a near-miss). Fixing it means picking a new color (`docs/design-system.md` has its own pre-read requirement for touching styling), a real design decision out of scope here. The exact known finding is allowlisted; any other violation on that page still fails.
- Home page (fully fixed, ratchet removed): `LevelGrid`'s price text was gold `#c8a000` on white (2.47:1); the WP-alignment rebrand replaced gold with crimson `#b51726` (~6.7:1). Fixing it unmasked Hero's photo placeholder (4.07:1), because the old ratchet allowlisted the whole `color-contrast` rule id rather than the node — also fixed. Lesson: ratchet a specific node, never a rule id.

### CI
- `.github/workflows/ci.yml` runs this on every PR and every push to `develop`/`main`, inside the official Playwright Docker image pinned to the same version as `@playwright/test` (`playwrightVersionGuard`) — screenshot baselines are only trustworthy from that environment.
- **The `ci-passed` job is the one required check** (it fails unless every test job succeeded). Making it block a merge is a one-time GitHub setting only the owner can make: Settings → Branches → a rule for `develop` and `main` → "Require status checks to pass" → `ci-passed`.

---

## Cross-repo tooling
- **`scripts/check-route-existence.mjs`** (CI, backend job) — every frontend `api.<method>()` call and every E2E `MockRule` (the default registry and every spec's overrides; a non-literal path is an extraction failure) must match a route the live Express app registers (exit 1 on a phantom route, exit 2 on any extraction failure). `--self-test` runs first.
- **`scripts/dead-negative-assertions.mjs --frontend frontend`** — candidate assertions that something absent stays absent, for text no code renders any more. Candidates need triage (`/audit-tests` Check 13 records the baseline).
- **`/audit-tests`** (`.claude/skills/audit-tests/SKILL.md`) — read-only quality audit: pyramid health, 13 anti-pattern checks, `TEST_COVERAGE.md` drift. Run it before opening a testing PR.

---

## Coverage expectations

Minimum targets (CKQ's own numbers) — not goals to game with trivial tests. The current figures live in `docs/TEST_COVERAGE.md` (re-measured on every PR that adds or moves tests).

**Gated in CI since 2026-10-26** (`docs/plans/testing-strategy-refresh-plan.md` PR A): both test jobs run their suite once with coverage and fail below **80% statements** (`coverageThreshold` in each `jest.config.js`). `collectCoverageFrom` counts every source file — a file no test loads shows as 0%, never as absent. A PR that lowers coverage below the floor adds tests; it never lowers the threshold.

### Branch coverage — read the breakdown, not just the aggregate

A single aggregate branch number hides where the branches are. Read the per-directory table (`--coverageReporters=text`; the figures are in `docs/TEST_COVERAGE.md`). `src/services` is the number that reflects business logic. `src/controllers` used to drag the aggregate down because every controller repeated an untestable `error.status || 500` / `error.message || 'Failed to ...'` fallback; since `docs/plans/duplication-cleanup-plan.md` PR B those blocks are a one-line `return next(error)` and the fallback logic lives once, in `src/middlewares/errorHandler.js`, where it has direct tests (`tests/middlewares/errorHandler.test.js`) — so a low controller-branch number is now a real signal, not noise.

### vs. CKQ

Checked directly against CKQ's own `docs/TEST_COVERAGE.md`, not assumed: **CKQ doesn't track backend % coverage at all** — their backend section is entirely test/route counts, no istanbul statement/branch numbers. Their only % figure is frontend, dated 2026-05-27. CKQ's real edge is scale and breadth, not tighter coverage discipline. This repo gates the floor in CI; CKQ does not.

---

## Isolation rules (all layers)

1. A test never depends on another test or on execution order.
2. Backend: `afterEach` calls `clearTestDB()` (drops every collection), so one test's seeded documents can never leak into the next.
3. Frontend: `afterEach` resets MSW handlers (`server.resetHandlers()`) and any local mutable fixture state (a `let postPayload` capture variable, a mutable `mockPathname`/`mockSearchParams`).
4. **Concurrent requests — only in a race test.** Fire supertest requests at the same time (`Promise.all`) only when simultaneity is the thing under test: two parents buying the last slot, two registrations racing past a pre-check (`privateClassEnrollment.routes.test.js`, `privateClassSession.routes.test.js`, `registration.routes.test.js`). Everything else awaits its requests one at a time. Each supertest call against `app` spins up its own short-lived server, and a burst of them on a loaded CI runner can drop a connection (`read ECONNRESET`) — a failure that has nothing to do with the code under test. It happened once (kiosk PR #111: an 8-request `Promise.all` in a lock-down test that never needed concurrency); a many-endpoint check is an `it.each` table instead, which also names the exact endpoint when one fails.
5. No real external effect from a test: no real email, no real Blob upload, and the payment provider only in TEST mode, keyed to the test's own customer.
6. `TZ=UTC` is enforced by every `test` script, not assumed from the runner.

---

## Live audits

Live audits complement the Jest/MSW and E2E layers by running real browser flows against **staging** — exercising the real backend, real database, and real Stripe TEST-mode charges, which mocked tests cannot do. Adapted from CKQ's own "Live Audit Skills" (`docs/plans/audit-system-plan.md` has the full design + the corrections made porting it, notably: no MCP browser tool is available in this environment, so this uses a real installed `playwright` package driving an unattended script, not an agent steering a browser interactively).

**What the E2E layer does NOT catch — stated explicitly, not left implicit:** its mocks are hand-written snapshots of the API's current shape. If the real backend's response shape changes — a renamed field, a removed status, a 500 from a missing seed step — the E2E suite's mocks keep returning the old shape and every spec keeps passing (type-locked mocks narrow this to changes the frontend types have not caught up with). That class of contract drift stays the live audit's job, since it talks to the real API.

### Available scripts

| Script | Flow | Accounts |
|---|---|---|
| `audit/run-registration-audit.js` (`/audit-live-registration`) | Trial booking → add-card + group registration → sibling discount, own-fee case (live preview vs. real charge) → card-save decline path → sibling discount, bridge case → registration-charge decline enters retry | Fixed, seeded via `backend/scripts/audit-seed.js`: `audit-parent-1`, `audit-sibling-parent` (2 children), `audit-decline-parent`, `audit-bridge-parent` (2 children), `audit-retry-parent` |

### Rules

- **Staging only** — `https://friscofencing-git-develop-frisco-fencing.vercel.app`. Never production. Hard-enforced (`audit/lib/staging-guard.js` exits non-zero), not just documented.
- **Not CI-gated, no cron** — run manually, same "audits are on-demand events" philosophy CKQ's own skills document. `docs/plans/audit-system-plan.md`'s D7 explains the tradeoff.
- **Mutates staging** — every scenario creates a real document or completes/declines a real Stripe TEST-mode charge. `backend/scripts/audit-reset.js` (`/reset-audit-data`) resets it, and is never invoked automatically by the audit script itself.
- **Reports non-fatally** to `/admin/audits` (superadmin-only) — a reporting failure never changes the audit's own pass/fail verdict or gets retried.
