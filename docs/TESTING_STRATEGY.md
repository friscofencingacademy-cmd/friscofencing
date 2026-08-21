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
| E2E | Not yet built | Full browser flows (registration, attendance marking) — Playwright, once the frontend has flows worth covering end-to-end at that fidelity | Real backend + real (memory) DB |

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

## Interaction rule

New tests should drive user interaction with `userEvent.setup()`, not `fireEvent`, for anything a real user does (clicks, typing, selecting an option) — `userEvent` dispatches the fuller, more realistic event sequence a browser actually produces. **Known gap, logged honestly rather than silently ignored**: every test written before and during the CKQ UI adoption plan (Phases 0–5, ~30 frontend test files) uses `fireEvent` — the convention in place when they were written. This rule takes effect for new tests going forward; retrofitting the existing suite is out of scope for this docs/testing-organization phase and is tracked in `docs/TEST_COVERAGE.md`'s Improvement Plan, not silently deferred.

## Date rules

- **Never sample the real clock against a "today"-computing subject.** If a component/service computes anything relative to `new Date()` (e.g. book-trial's same-day session filter), freeze time with `jest.useFakeTimers({ now: fixedInstant })` (or `jest.useFakeTimers().setSystemTime(...)`) rather than asserting against whatever the wall clock happens to read when CI runs.
- **Fixture instants use midday UTC** (`T12:00:00Z`), not midnight — a midnight UTC instant renders as "yesterday" in every timezone west of UTC, which is exactly the class of flake this rule exists to prevent.
- **Run suites under `TZ=UTC`** to reproduce the CI runner: `TZ=UTC npm test` in both `backend/` and `frontend/`. A test that only fails in one timezone is a real bug, not a fluke.
- No time-bomb dates: use fixed historical/near-term instants, never "now + N days" logic that silently breaks on a future run (e.g. `ACTIVE_SUBSCRIPTION.currentPeriodEnd` fixtures use a literal `'2026-02-01T00:00:00.000Z'`, not `addDays(new Date(), 30)`).
- Every subscription-renewal test must explicitly cover the cancel-then-charge race: a subscription cancelled between snapshot and charge-time must never be charged. This is the exact bug class the in-house billing model (`docs/decisions/001-in-house-subscription-billing.md`) exists to prevent — it needs a regression test, not just a design doc.

## Typed fixtures

No `any` on domain data in tests. Every frontend fixture object (a `Location`, a `Student`, a `Subscription`, ...) must satisfy the real type from `frontend/lib/types.ts` — if a fixture doesn't type-check, either the fixture is wrong (fix the literal) or the type is wrong (fix the type against the real backend model/controller, never widen it to `any` to make the fixture compile). Backend test fixtures are plain Mongoose `.create()` calls against the real schema, so this is enforced structurally by Mongoose validation rather than by hand.

## Naming & placement conventions

- Backend: `<subject>.routes.test.js` for a route-integration suite, `<subject>.service.test.js` for a service-unit suite, mirroring `src/`'s directory shape one-for-one under `tests/`.
- Frontend: `__tests__/page.test.tsx` for a page, `__tests__/index.test.tsx` for a component whose file is `index.tsx`, `__tests__/<Name>.test.tsx` for a named component file, `__tests__/<name>.test.ts` for a hook or service module.
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
