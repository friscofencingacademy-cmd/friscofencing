# Testing Strategy Refresh — CI that gates, guards that bite, E2E that fails loudly

**Status:** READY-TO-EXECUTE (2026-10-26). Spec'd from a measured audit of this repo at `develop` @
`5391c8c` (both suites re-run that day: backend 82 suites / 1,091 tests, frontend 67 / 554, Playwright
`--list` 43 tests in 9 files incl. 2 known skips — all green) against CKQ's testing system
(`chesskq-workspace/docs/TESTING_STRATEGY.md` 995 lines, `TEST_COVERAGE.md`, 9 backend + 16 frontend
static guards, `scripts/check-route-existence.mjs`, `scripts/dead-negative-assertions.mjs`,
`.claude/skills/audit-tests`). Six PRs, sequential. Companion to
`docs/plans/payment-provider-port-plan.md` (whose PR 4/5 add the payment-specific guards and the
`payment-method.spec.ts` E2E; this plan does not duplicate them).

**Owner's ask (2026-10-26):** "Testing strategy md — make sure all layers are good and anything new
we need to add. Test coverage should be good and E2E tests should be there … whatever you can copy
[from CKQ] I want you to just copy that."

**Executor contract:** identical to the payment plan's §9 — this document decides, the executor
executes, STOP on anything unanticipated. Owner intends auto-mode execution.

---

## 0. Pre-reads (mandatory)

| Before touching… | Read |
|---|---|
| Anything | `CLAUDE.md` HARD RULES |
| Any test | `docs/TESTING_STRATEGY.md` (current — this plan's PR E rewrites it; until then it is the rule book) |
| CI | `.github/workflows/ci.yml` (whole file, incl. the header comment on secrets and required checks), `docs/plans/e2e-testing-plan.md` D6/D11 |
| E2E | `frontend/e2e/fixtures/{mock-api,auth}.ts`, `frontend/playwright.config.ts`, `docs/plans/e2e-testing-plan.md` |
| Reference material being copied (read-only) | `C:\Users\mages\chesskqwebsite\scripts\{check-route-existence.mjs,dead-negative-assertions.mjs}`, `C:\Users\mages\chesskqwebsite\websitepublic\website2.0\e2e\fixtures\auth.ts`, `…\website2.0\src\__test__\guards\{e2eCatchAllGuard,e2eMockLayerGuard,e2eWaitOrderGuard}.test.ts`, `…\backend\backend-2.0\src\__tests__\guards\realClockDateHelperGuard.test.js`, `C:\Users\mages\chesskqwebsite\.claude\skills\audit-tests\SKILL.md`, `C:\Users\mages\chesskqwebsite\docs\TESTING_STRATEGY.md` §"E2E Tests" and §"Static guards" |

---

## 1. Problem — measured at `5391c8c`

| # | Gap | Evidence | CKQ has |
|---|---|---|---|
| G1 | CI does not type-check | `.github/workflows/ci.yml` has three jobs (`backend-tests`, `frontend-tests`, `e2e-tests`), none runs `tsc --noEmit`; `frontend/tsconfig.json` **excludes** `e2e` and `playwright.config.ts`, so the E2E mocks are never type-checked anywhere | `Build & Type Check` job: `tsc --noEmit` over the whole project incl. tests and e2e |
| G2 | No lint of any kind | no `eslint` binary in `frontend/node_modules/.bin`; no lint deps in either `package.json` | ESLint + stylelint + custom lint ratchets |
| G3 | Coverage is measured by hand, never in CI | no `coverageThreshold`, no `collectCoverageFrom`, no coverage step; `docs/TEST_COVERAGE.md` numbers date from 2026-09-24 | documented policy, numbers re-run per PR |
| G4 | `TZ=UTC` is documented, not enforced | `backend/package.json` `"test": "jest"`, frontend same; CI sets `TZ: UTC` as job env, a local run on this Windows machine does not | same gap, tracked in their followups — Frisco closes it |
| G5 | Zero static guards | no `guards/` dir in either repo; nothing prevents `.only`, a bare `.skip`, a real-clock fixture, or a direct SDK import | 9 backend + 16 frontend guard tests |
| G6 | E2E unmocked endpoints do not fail the test | `mock-api.ts:440-441` → `console.warn` + 501; the spec keeps running and can pass on an empty state | 599 + teardown assertion listing every unmocked URL (`installApiMocks`/`assertNoUnmockedRequests`), `allowUnmocked` escape hatch, three Jest guards enforcing the pattern |
| G7 | E2E mocks are untyped | every `FIXTURE_*` in `mock-api.ts` is an unannotated literal; a backend shape change cannot break them at compile time | mocks typed with the real service-layer types; `tsc` covers `e2e/` |
| G8 | No phantom-route check | nothing verifies a frontend `api.get('/x')` has a backend route; CKQ shipped such a bug for 2 months | `check-route-existence.mjs` (live Express introspection, exit 2 on extraction failure) |
| G9 | Interaction rule not followed | `fireEvent` in 30 of the 49 interactive frontend test files (list in §4.D) vs the documented `userEvent.setup()` rule | `userEvent` everywhere, rule enforced in review |
| G10 | Real-clock fixtures | 13 backend test files call `todayAtMidnight()`/`todayDateOnly()`/`new Date()` with no frozen clock (list in §4.C) | `realClockDateHelperGuard` + rules |
| G11 | Chromium-only E2E; nothing checks phone widths | `playwright.config.ts` one project; the public site is mobile-first | 5 projects; 360 px overflow helpers |
| G12 | Doc drift | `docs/TEST_COVERAGE.md` says 41 active E2E tests; Playwright lists 43 (incl. 2 skips) | `/audit-tests` Phase 3 catches drift |
| G13 | CI is not a merge gate | header comment in `ci.yml`: required status checks were never enabled (owner-only GitHub setting) | required `CI Passed` umbrella job |

What is already right and is kept: real `mongodb-memory-server` per file; MSW at the network boundary;
real Stripe TEST mode; the three keyed Stripe lookups; the date rules and `dateShapes.js`/`billingDates.js`
gates; colocated frontend tests; the E2E layer existing at all with `page.clock` pinning; every route
suite has 4xx assertions (lowest: `student.routes.test.js` with 1).

---

## 2. Prior art

**Industry:** type-check + lint + unit + E2E as required checks; coverage thresholds as a floor
not a target; contract/consumer checks between frontend calls and backend routes; flaky-test
policy that forbids retries-as-fix. **Verdict: follows.**
**Internal:** every rule below already exists in Frisco's `docs/TESTING_STRATEGY.md` or CKQ's; this
plan adds enforcement, not new philosophy. Where CKQ's mechanism needs ESLint (G2) Frisco uses a
Jest static guard instead — the same choice CKQ made for its payment boundary when its backend
ESLint was broken. **Verdict: consistent.**
**Simplest option:** adding ESLint to both repos was considered and rejected for this plan — it is
a separate, large, opinion-heavy change (rules, autofix churn across 170+ files); guards cover the
specific failure modes we have seen. It stays a listed follow-up.

---

## 3. Decisions (resolved)

| # | Decision | Resolution |
|---|---|---|
| T1 | `TZ=UTC` enforced in the `test` scripts via `cross-env` (Windows dev machines) in both repos; CI keeps its env line too (belt and braces). |
| T2 | CI gains a `Type Check` step (`tsc --noEmit` + `tsc -p e2e/tsconfig.json --noEmit`) in `frontend-tests`, `--ci` on both Jest runs, a `coverage` job that is **reporting-only in PR A** (`continue-on-error: true`, coverage summary written to `$GITHUB_STEP_SUMMARY`) and **blocking in PR E** (threshold `statements: 80` global, both repos, `collectCoverageFrom` set so untested files count). |
| T3 | Route-existence guard ported to `scripts/check-route-existence.mjs` at the repo root (Node built-ins only), adapted to Frisco (`api.<method>(` from `frontend/lib/api.ts`; mounts introspected from `backend/src/app.js`; **also** scans `frontend/e2e/fixtures/mock-api.ts` `MockRule` literals so every E2E default route is a real route). Runs in the `backend-tests` CI job. Exit 2 on extraction failure must fail the job. |
| T4 | E2E loud-fail: unmocked `/api/v1/**` → HTTP 599 + recorded; a shared `test` fixture (`e2e/fixtures/test.ts`) asserts zero unmocked requests in teardown; `test.use({ allowUnmocked: [...] })` is the only escape hatch; all specs import `test`/`expect` from the fixture. Enforced by three Jest guards copied from CKQ. |
| T5 | E2E mocks typed with `frontend/lib/types.ts` types; `tsc -p e2e/tsconfig.json` runs in CI. A fixture whose response shape has no type gets the type added to `lib/types.ts`, derived from the backend service/controller that produces it (the file is named in the fixture's existing comment) — never `any`, never a loosened type. |
| T6 | A `mobile-chrome` Playwright project (`devices['Pixel 5']`, 393 px) runs a named subset (`public-site`, `login`, `calendar`, `kiosk`) plus a 360 px no-horizontal-overflow check on `/`, `/classes`, `/calendar`. Other specs join the mobile project in E2E Phase 2 (PR F) one at a time with their own fixes. |
| T7 | Static guards (Jest files that walk the tree and fail the build): backend `tests/guards/{noFocusedOrBareSkip,realClockDateHelper}.test.js`; frontend `lib/__tests__/guards/{noFocusedOrBareSkip,e2eCatchAll,e2eMockLayer,e2eWaitOrder}.test.ts`. Each fails loudly if it scans zero files. Allowlists start populated with today's offenders and are emptied by PR D; each entry carries a one-line reason. |
| T8 | `/audit-tests` skill and `scripts/dead-negative-assertions.mjs` ported (read-only tooling). |
| T9 | `fireEvent` → `userEvent.setup()` retrofit across the 30 files, file by file, each file's suite run alone after conversion. A file that cannot convert because `userEvent` + fake timers + MSW hangs keeps `fireEvent` with a `// fireEvent kept: <reason>` comment and is listed in the report (the register-page test documents exactly this interaction at its top). |
| T10 | Coverage policy: floor 80% statements (both repos), reported per directory; `src/services` branch % is the number that matters for business logic (today's `TEST_COVERAGE.md` reasoning stays). |
| T11 | E2E Phase 2 order (PR F): `subscriptions.spec.ts` (parent cancel/reactivate, admin change-schedule/cancel/Charge dialog), `register-private.spec.ts` (the wizard's buy-a-pack and use-a-credit paths), `billing.spec.ts` (`/parent/billing` rows, manual chip, invoice link), `spotlights-admin.spec.ts` (create/publish/delete with a mocked Blob upload). `payment-method.spec.ts` is the payment plan's PR 5. |
| T12 | Required status checks: owner-only GitHub setting; PR E's report ends with the exact clicks. Not automatable from this repo. |

---

## 4. File-by-file spec, per PR

Branches cut from `develop`; one PR at a time; never stacked.

---

### PR A — `feature/testing-ci-hardening` (G1, G3, G4, G8)

**A1 `backend/package.json`**: devDependency `"cross-env": "^7.0.3"`; scripts
`"test": "cross-env TZ=UTC jest --ci"`, `"test:watch": "cross-env TZ=UTC jest --watch"`,
`"test:coverage": "cross-env TZ=UTC jest --ci --coverage"`. NEW `backend/jest.config.js`:
```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', 'scripts/lib/**/*.js'],
  coverageReporters: ['text-summary', 'text', 'lcov'],
  // Floor, not target (docs/TESTING_STRATEGY.md "Coverage Expectations"). Enforced only when --coverage runs.
  coverageThreshold: { global: { statements: 80 } },
};
```
(Verify `jest` currently finds the same 82 suites via the default `testMatch`; the explicit pattern
must list the same 82 — `npx jest --listTests | wc -l` before and after.)

**A2 `frontend/package.json`**: devDependency `cross-env`; scripts `"test": "cross-env TZ=UTC jest --ci"`,
`"test:coverage": "cross-env TZ=UTC jest --ci --coverage"`,
`"typecheck": "tsc --noEmit && tsc -p e2e/tsconfig.json --noEmit"`. `frontend/jest.config.js`
`customJestConfig` gains `collectCoverageFrom: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', '!**/__tests__/**', '!**/*.d.ts']`
(layouts stay in — they are real code) and `coverageThreshold: { global: { statements: 80 } }`.

**A3 NEW `scripts/check-route-existence.mjs`** (repo root). Port of CKQ's file; keep its structure
(`parseArgs`, `normalizeSegs`, `segMatch`, `routeMatches`, `findPhantoms`, `makeCall`, `makeRoute`,
`--self-test` fixtures, markers, exit codes 0/1/2). Adaptations:
- Frontend scan roots: `frontend/app`, `frontend/lib` (skip `__tests__`, `node_modules`, `.next`).
  Call regex: `\bapi\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*(['"`])(\/[^'"`]*)\2` (the generic
  type argument is common here: `api.get<{ paymentMethod … }>('/payment-methods/mine')`). Template
  literals with `${…}` segments become wildcards as in CKQ.
- A second scan of `frontend/e2e/fixtures/mock-api.ts`: regex
  `method:\s*'(GET|POST|PUT|PATCH|DELETE)',\s*path:\s*'(\/[^']+)'` → calls with `:param` segments
  treated as wildcards.
- `ALLOWLIST`: `frontend/lib/services/parent.ts` — `invoiceDownloadUrl()` builds a string, not an
  `api.` call (reason: verified to resolve to `GET /registrations/:id/invoice`). Add others only
  with a verified reason.
- Backend introspection child process: `node -e` that sets `process.env.JWT_SECRET ||= 'route-scan'`,
  `require('<backend>/src/app.js')`, walks `app._router.stack`: a layer with `layer.route` →
  `{ path: layer.route.path, methods: Object.keys(layer.route.methods) }` (`/health`); a layer whose
  `handle.stack` exists is a mounted router → mount path from `layer.regexp` (CKQ's
  regexp-to-path conversion: strip `^`, `\\/?(?=\\/|$)`, `$`, unescape `\/`; the result for
  `app.use('/api/v1/levels', …)` must be exactly `/api/v1/levels`) + each `route.path`/`methods`
  in `handle.stack`; nested routers recurse. Output between the markers as JSON. `app.js` connects
  to nothing on require (verified: `server.js`/`api/index.js` own `connectDB`), so no DB is needed.
  Strip the `/api/v1` prefix on both sides before matching (frontend `api` has `baseURL: '/api/v1'`).
  Fewer than 20 backend routes extracted → exit 2.
- `--self-test` keeps CKQ's 7 fixtures.
- Output format: `route-existence: <F> frontend calls, <E> e2e mock routes, <B> backend routes, <P> phantoms` then one line per phantom `file:line  METHOD /path`.

**A4 `.github/workflows/ci.yml`**:
- `backend-tests`: after `npm test`, step `Route-existence guard`: `node scripts/check-route-existence.mjs --frontend frontend --backend backend` (working-directory repo root).
- `frontend-tests`: before `npm test`, step `Type check (app + e2e)`: `npm run typecheck`.
- NEW job `coverage` (needs nothing, parallel): checkout, setup-node for both dirs, `npm ci` both,
  `npm run test:coverage` in `backend` (env `STRIPE_SECRET_KEY` secret, `TZ: UTC`) and in
  `frontend`, each with `continue-on-error: true` (PR E removes), then
  `echo "## Coverage" >> $GITHUB_STEP_SUMMARY` + append the `text-summary` output of each
  (capture to a file with `| tee coverage-summary.txt`).
- Header comment: add the two new checks and that `coverage` is reporting-only until PR E.

**A5 Measure and record**: run `npm run test:coverage` in both repos locally; paste the four
percentages (statements/branches/functions/lines) and the per-directory branch table into
`docs/TEST_COVERAGE.md`'s table with the date, replacing the 2026-09-24 numbers and noting that
`collectCoverageFrom` now counts never-loaded files (so a drop vs 2026-09-24 is expected and
explained, not a regression). If either repo is below 80 statements, STOP and report the
per-directory table — the owner decides where tests are added before PR E flips the gate.

---

### PR B — `feature/testing-e2e-hardening` (G6, G7, G11)

**B1 `frontend/e2e/fixtures/mock-api.ts`**
- Type every fixture: `FIXTURE_LEVEL_A: Level`, `FIXTURE_LOCATION: Location`, `FIXTURE_GROUP_CLASS_A: GroupClass`,
  `FIXTURE_PRICE_A: Price`, `FIXTURE_SCHEDULE_A: GroupClassSchedule`, `FIXTURE_STUDENT: Student`,
  `FIXTURE_PAYMENT_METHOD: PaymentMethodInfo` (today's literal lacks `_id`, `cardExpMonth`, `cardExpYear` → add them),
  the private-lesson fixtures with the `PrivateClass*` types `lib/services/privateClass.ts` uses, the
  calendar fixtures with `lib/calendarView.ts`'s event type, `FIXTURE_KIOSK_STUDENTS` with
  `lib/services/kiosk.ts`'s type. Import from `'../../lib/types'` and the service files. Where a
  type is missing: T5.
- Replace the catch-all's `console.warn` + 501 with: record `${method} ${pathname}` into a
  per-page `unmocked: string[]` (kept in a module-level `WeakMap<Page, { rules: MockRule[]; unmocked: string[]; allow: (string|RegExp)[] }>`), fulfil
  `599` with body `{ message: 'Unmocked in E2E suite: …' }`. `isAllowed(url, allow)` as CKQ.
- `installApiMocks(page, allowUnmocked = [])` installs the single `**/api/v1/**` handler once per
  page and seeds `rules = [...DEFAULT_RULES]`; `mockApi(page, overrides)` **prepends** to that page's
  `rules` (no second `page.route` registration — Frisco's explicit priority list stays, which is
  simpler than CKQ's LIFO reasoning and documented in the file header). `assertNoUnmockedRequests(page)`
  throws with the list. `loginAs` keeps its signature and calls `mockApi`.
**B2 NEW `frontend/e2e/fixtures/test.ts`**:
```ts
import { test as base, expect } from '@playwright/test';
import { installApiMocks, assertNoUnmockedRequests } from './mock-api';

type Options = { allowUnmocked: (string | RegExp)[] };
export const test = base.extend<Options>({
  allowUnmocked: [[], { option: true }],
  page: async ({ page, allowUnmocked }, use) => {
    await installApiMocks(page, allowUnmocked);
    await use(page);
    assertNoUnmockedRequests(page);
  },
});
export { expect };
```
Every spec: `import { test, expect } from './fixtures/test';` (replacing the `@playwright/test`
value import; `type` imports from `@playwright/test` remain fine). Run the suite; for each spec
that now fails with an unmocked list, add the missing `MockRule` to `DEFAULT_RULES` if the
endpoint is fired by a shell/context on every page, else to that spec's overrides — never
`allowUnmocked` unless the test is deliberately exercising an unmocked path (today: none).
**B3 `frontend/playwright.config.ts`**: `projects` gains
`{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] }, testMatch: /(public-site|login|calendar|kiosk)\.spec\.ts/ }`.
NEW `frontend/e2e/helpers/layout.ts`: `expectNoHorizontalOverflow(page)` — asserts
`document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0` (CKQ's zero
tolerance). `public-site.spec.ts`: new test `renders without sideways scroll at 360 px` —
`page.setViewportSize({ width: 360, height: 740 })`, visit `/`, `/classes`, `/calendar`, assert after
`networkidle`. A failure here is a real product layout bug: STOP and report with a screenshot
(`page.screenshot`) path — do not widen the tolerance.
**B4 `frontend/e2e/tsconfig.json`**: no change needed for imports; confirm `npm run typecheck` passes.
**B5 `.github/workflows/ci.yml` e2e job**: unchanged command (`playwright test` now runs both projects); keep `workers: 1` in CI.
**B6 `docs/plans/e2e-testing-plan.md`**: append a dated addendum "Loud-fail + typed mocks + mobile project — see testing-strategy-refresh-plan.md PR B".

---

### PR C — `feature/testing-static-guards` (G5, G10, G12 tooling)

**C1 NEW `backend/tests/guards/noFocusedOrBareSkip.test.js`**: walks `backend/tests` (`*.test.js`,
excluding itself); fails on `\.(only)\(` anywhere; fails on `\b(describe|it|test)\.skip\(` unless
the same line or the previous non-blank line contains a `//` comment of ≥ 5 words (the reason);
asserts ≥ 80 files scanned.
**C2 NEW `backend/tests/guards/realClockDateHelperGuard.test.js`** (port of CKQ's): flagged
patterns `\btodayAtMidnight\(\)`, `\btodayDateOnly\(\)`; pinned patterns `useFakeTimers\(`,
`setSystemTime\(`, `freezeDate\(`; a flagged file without a pinned pattern fails unless in `EXEMPT`
(forward-slash-normalised relative paths — Windows). Initial `EXEMPT`, each with a reason, from the
2026-10-26 measurement filtered to the two helpers (the executor re-runs the grep
`grep -rlE "todayAtMidnight\(\)|todayDateOnly\(\)" backend/tests` and lists exactly those files
lacking a pin): candidates `tests/utils/billingDates.test.js` (tests the helpers' own real-today
behaviour — permanent exemption, shape-only assertions), and whichever of
`routes/kiosk.routes.test.js`, `scripts/lib/{backfillSessionInstants,backfillVisitService,migratePeriodMonth,migrateToUnifiedLedger,retireRecurringPrivateClasses}.test.js`,
`services/billing/registrationFee.service.test.js`, `services/invoice.service.test.js`,
`services/kiosk.service.test.js`, `services/renewal.previewAndCharge.test.js`,
`services/renewal.service.test.js`, `utils/dateShapes.test.js`, `utils/privateClassPricing.test.js`
match — reason `"PR D pins the clock"`. A test asserts every `EXEMPT` entry exists on disk.
**C3 NEW `frontend/lib/__tests__/guards/noFocusedOrBareSkip.test.ts`**: same as C1 over
`frontend/app`, `frontend/lib`, `frontend/e2e` (`*.test.ts(x)`, `*.spec.ts`). Today's two
`test.skip()`s in `public-site.spec.ts` have in-file comments — confirm they satisfy the rule.
**C4 NEW `frontend/lib/__tests__/guards/e2eCatchAllGuard.test.ts`**: no file under `e2e/` other
than `fixtures/mock-api.ts` contains `.route('**/api/v1/**'` or `.route("**/api/v1/**"`.
**C5 NEW `frontend/lib/__tests__/guards/e2eMockLayerGuard.test.ts`**: every `e2e/*.spec.ts` has
`from './fixtures/test'` (or `'../fixtures/test'` once subfolders exist) and does NOT have
`import { test` from `@playwright/test` (a `import type` is allowed).
**C6 NEW `frontend/lib/__tests__/guards/e2eWaitOrderGuard.test.ts`**: no `e2e/**/*.ts` line matches
`^\s*await\s+page\.waitFor(Response|Request)\(` (arm first, then trigger — CKQ rule 6) and none
contains `dispatchEvent(new Event('visibilitychange'`.
**C7 NEW `scripts/dead-negative-assertions.mjs`**: CKQ's file with `srcDir` → two roots
(`frontend/app`, `frontend/lib`), `isTest = /\.test\.tsx?$/`, `isSupport = /[\\/](__tests__|e2e[\\/]fixtures)[\\/]/ && !isTest`,
source = `.ts/.tsx/.json`. Run it; record the baseline in the skill (C8) as CKQ did.
**C8 NEW `.claude/skills/audit-tests/SKILL.md`**: CKQ's skill with Frisco paths (`backend/tests/{utils,services,routes,scripts,models,email,middlewares,config}`, `frontend/app`+`frontend/lib` `__tests__`, `frontend/e2e`), checks 1–13 kept (Check 11 counts `toBe\(2\d\d\)` vs `toBe\([45]\d\d\)` per `tests/routes/*.routes.test.js`; Check 13 runs C7), Phase 3 compares `docs/TEST_COVERAGE.md` headline counts with `npx jest --listTests | wc -l` × suites and `npx playwright test --list`. Read-only, "run all phases autonomously" header kept. No `docs/skills.md` is created; the skill is registered in `CLAUDE.md`'s Documentation Map (PR E).
**C9 `student.routes.test.js`**: read `backend/src/routes/student.routes.js`; for every route add
the missing negative cases (401 no cookie; 403 wrong role; 404 unknown id where applicable) so the
file's 4xx count is ≥ its route count. Pure additions.

---

### PR D — `feature/testing-retrofit` (G9, G10)

**D1 `fireEvent` → `userEvent`** in these 30 files (the exact 2026-10-26 list):
`app/admin/__tests__/layout.test.tsx`, `app/admin/{audits,classes,dashboard,holidays,levels,locations,prices,schedules,settings,spotlights,testimonials,users}/__tests__/page.test.tsx`,
`app/components/portal/__tests__/PaymentMethodCardForm.test.tsx` (becomes `components/payment/stripe/__tests__/StripeCardForm.test.tsx` if the payment plan's PR 3 has landed first — convert whichever exists),
`app/components/portal/{AddChildModal,flow,ParentPortalShell}/__tests__/*.test.tsx`,
`app/components/ui/{Button,LoadError}/__tests__/*.test.tsx`, `app/context/__tests__/ParentPortalContext.test.tsx`,
`app/kiosk/__tests__/page.test.tsx`, `app/login/__tests__/page.test.tsx`,
`app/parent/{book-trial,children,dashboard,payment-method,register,subscriptions}/__tests__/page.test.tsx`,
`app/register/__tests__/page.test.tsx`, `app/sessions/[id]/attendance/__tests__/page.test.tsx`.
Pattern (CKQ's): module-level `let user: ReturnType<typeof userEvent.setup>;`, `beforeEach(() => { user = userEvent.setup(); })`
(`userEvent.setup({ advanceTimers: jest.advanceTimersByTime })` when the file uses fake timers),
`await user.click(...)`, `await user.type(...)`, `await user.selectOptions(...)`,
`await user.clear(...)`. `fireEvent.change` for seeding a value with no cascade under test and
`fireEvent.submit` may stay (documented exceptions). One file at a time: convert → `npx jest <file>`
→ next. T9 governs a file that hangs.
**D2 Pin the clock** in every file C2 listed with reason `"PR D pins the clock"`: `jest.useFakeTimers({ now: <literal mid-month instant>, doNotFake: ['setTimeout','setInterval','setImmediate','nextTick','clearTimeout','clearInterval','clearImmediate'] })`
(the house pattern from `privateClassSession.service.test.js`; or `freezeDate()` from
`tests/testUtils/privateLessons.js` where that helper's Monday instant fits), `jest.useRealTimers()`
in `afterAll`. Choose the literal so every existing assertion still holds (mid-month, a weekday the
suite's seeded schedules do not depend on — verify by reading the file's fixtures first; a
`billingDates`-style helper test that deliberately exercises real "today" keeps its permanent
exemption). Remove each file from `EXEMPT` as it is fixed; `EXEMPT` ends as
`['utils/billingDates.test.js']` plus any file whose exemption is argued in its reason string.
**D3** Re-run `node scripts/dead-negative-assertions.mjs`; delete any candidate confirmed dead
(the deleting commit found with `git log -S"<text>" -- frontend/app`), keep composed-text
false positives, update the baseline line in the skill.

---

### PR E — `feature/testing-docs-and-gate` (G3 gate, G12, docs)

**E1 `docs/TESTING_STRATEGY.md`** rewritten to CKQ's structure, keeping every Frisco-specific rule
verbatim where it already exists: Overview (layers table, the three-layer strategy) → Backend
(stack, structure, commands incl. `test:coverage`, parallel/isolation, what to test per layer,
mocking table incl. the payment-provider row from the payment plan, naming, what NOT to test, the
date rules incl. "pin the clock, one instant per branch", **Static guards (backend)** listing C1,
C2 and the payment plan's `providerBoundaryGuard`) → Frontend (stack, `userEvent` rule with the
CKQ "symptom of the fireEvent bug" paragraph, structure, MSW pattern, typed fixtures incl.
`typedJson<T>()` guidance, error contract, **Static guards (frontend)** listing C3–C6 and the
payment plan's `paymentSdkBoundaryGuard`) → E2E (what belongs / does not, **Mocking rules** with
the loud-fail layer + `allowUnmocked` + type-locked mocks + `test.skip` policy, **Interaction
determinism** rules 1–6 adapted — settled ARIA state, redirects assert the destination, behaviour
changes update E2E in the same PR, recurring flakes root-caused from the trace never retried, arm
network waits before the trigger / drive polls with `page.clock`, no sideways scroll at 360 px —
projects table incl. `mobile-chrome`) → Cross-repo tooling (`check-route-existence.mjs`,
`dead-negative-assertions.mjs`, `/audit-tests`) → Coverage expectations (T10, the gate) → Isolation
rules → Live audits (unchanged). Delete the "Known gap … fireEvent" paragraph (closed by PR D).
**E2 `docs/TEST_COVERAGE.md`**: adopt CKQ's shape — bold headline counts per repo, a dated change
log (newest first) with one bullet per PR, the coverage table from PR A re-measured after PR D, the
E2E count from `npx playwright test --list` (per project), the honest gaps list refreshed.
**E3 `.github/workflows/ci.yml`**: remove `continue-on-error: true` from `coverage`; add a final
`ci-passed` job (`needs: [backend-tests, frontend-tests, e2e-tests, coverage]`, `runs-on: ubuntu-latest`,
one `run: echo ok`) — the single check the owner marks as required.
**E4 `CLAUDE.md`**: pre-read table rows: "Touch any test → `docs/TESTING_STRATEGY.md`" (exists), add
"Touch `frontend/e2e/**` → the E2E section's Mocking rules + Interaction determinism; run
`/audit-tests` before opening a testing PR"; Documentation Map rows for this plan and `/audit-tests`.
**E5** Report ends with the owner's one-time GitHub steps: Settings → Branches → add rule for
`develop` and `main` → "Require status checks to pass" → select `ci-passed`.

---

### PR F — `feature/testing-e2e-phase2` (T11) — four new specs

Each spec: `import { test, expect } from './fixtures/test'`, `loginAs(page, role, overrides)`,
clock pinned with `page.clock.install({ time })` + `setFixedTime` where any date renders, every
mutation's request body asserted exactly (`await request.postDataJSON()`), the destination
asserted after any redirect, one axe scan per new page (`new AxeBuilder({ page }).analyze()` →
zero `serious`/`critical`, same as `public-site.spec.ts`). Mirror the named Jest page test's cases
in the real browser:
- `subscriptions.spec.ts` ← `app/parent/subscriptions/__tests__/page.test.tsx` + `app/admin/subscriptions/__tests__/page.test.tsx`: parent cancel (PATCH body), reactivate; admin list filter, change-schedule (payload), cancel, Charge dialog preview text and confirm payload (superadmin).
- `register-private.spec.ts` ← `app/parent/register-private/__tests__/page.test.tsx`: buy a pack (quote → purchase payload with `packId` + `contractId`), use a credit (no charge copy), 409 slot-taken recovery.
- `billing.spec.ts` ← `app/parent/billing/__tests__/page.test.tsx`: rows across shapes, manual chip + note, failed row has no download link, invoice `<a href>` exact.
- `spotlights-admin.spec.ts` ← `app/admin/spotlights/__tests__/page.test.tsx`: create with a mocked `POST /spotlights` (file input via `setInputFiles` on a 1×1 PNG buffer), publish toggle payload, delete.
Mobile: add `subscriptions` and `billing` to the `mobile-chrome` `testMatch` and fix any 393 px
overflow found (`expectNoHorizontalOverflow`) — a product fix, reported, not a tolerance change.
`docs/TEST_COVERAGE.md` E2E section updated.

---

## 5. Test spec summary (each row is a file the PR creates or changes; mocking per `docs/TESTING_STRATEGY.md` headings)

| PR | File | Layer | Cases |
|---|---|---|---|
| A | `scripts/check-route-existence.mjs` | script, `--self-test` | CKQ's 7 fixtures pass; real run on this repo exits 0 with `P = 0` (any phantom found is reported, not allowlisted — STOP) |
| A | `backend/jest.config.js`, both `package.json` | config | `npx jest --listTests | wc -l` unchanged (82 / 67) |
| B | `e2e/fixtures/{mock-api,test}.ts`, every spec | E2E | whole suite green on both projects; a deliberate temporary removal of one `DEFAULT_RULES` entry makes the dependent spec fail with the 599 list (proof the loud-fail works — do it, observe, revert, note in the report) |
| B | `e2e/helpers/layout.ts`, `public-site.spec.ts` | E2E | 360 px overflow test |
| C | 6 guard tests + `student.routes.test.js` | static / route | each guard fails loudly on zero files (self-test with a bogus root), passes on the tree; `student.routes` 4xx ≥ route count |
| C | `scripts/dead-negative-assertions.mjs`, `/audit-tests` | tooling | script exits 0/1/2 correctly on the repo; the skill's first run output pasted into the report |
| D | 30 frontend test files, ≤ 13 backend test files | unit/service/route | same assertions, new interaction/clock mechanics; every file run alone, then full suites |
| E | docs, ci.yml | — | Hard Rule 4 docs exception; `ci-passed` appears in the PR's checks |
| F | 4 specs | E2E | per §4.F |

---

## 6. Verification — exact commands

```bash
# every PR
cd backend && npm test 2>&1 | tail -6                 # "Test Suites: N passed, N total" — N ≥ 82; 0 failed
cd ../frontend && npm test 2>&1 | tail -6             # N ≥ 67; 0 failed
npm run typecheck                                      # exit 0 (PR A+)
npm run build 2>&1 | tail -3                          # Compiled successfully
npx playwright test 2>&1 | tail -4                    # 0 failed; skipped = 2 (PR A) → 2 (PR B+, still only the visual baselines)
cd .. && node scripts/check-route-existence.mjs --self-test && node scripts/check-route-existence.mjs --frontend frontend --backend backend   # exit 0, "0 phantoms" (PR A+)
node scripts/dead-negative-assertions.mjs --frontend frontend ; echo "exit $?"   # 0 or 1 with the recorded baseline (PR C+)
# PR A / PR E
cd backend && npm run test:coverage 2>&1 | grep -A5 "Coverage summary"    # statements ≥ 80
cd ../frontend && npm run test:coverage 2>&1 | grep -A5 "Coverage summary"
```
Baselines at `5391c8c`: backend 82 / 1,091; frontend 67 / 554; Playwright `--list` 43 (chromium). After
PR B the list is 43 + the mobile-project copies of the 4 matched specs + 1 new test.

---

## 7. Execution protocol (binding; auto-mode intended)

Same seven rules as `docs/plans/payment-provider-port-plan.md` §9, with these specifics:
1. Order A → B → C → D → E → F; each merged to `develop` by the owner before the next starts.
2. A guard or script that finds a real defect in app code (a phantom route, a 360 px overflow, a dead assertion) is **reported, not fixed** in the testing PR — unless §4 names the fix (C9, D3). The owner decides where the fix lands.
3. PR D converts one file at a time and runs it alone; a hang → T9 (keep `fireEvent`, comment, report). Never add `{ timeout }` to a `findBy*`/`waitFor` to make a converted test pass (CKQ's documented anti-fix).
4. Report-back format: the payment plan's, with `Counts` extended by `coverage: backend S/B/F/L %, frontend S/B/F/L %` and `guards: <n> files scanned each`.

---

## 8. Follow-ups recorded, not built here
ESLint (+ `eslint-plugin-jest`, `no-restricted-imports` as defence in depth behind the Jest guards) in both repos; WebKit/Firefox projects; a central MSW handlers registry + both-registries guard (only worth it once a second global handlers file exists); visual-regression baselines generated inside the Playwright Docker image (the 2 standing skips); converting `audit/` to the loud-fail fixture.

---

## 9. As-built notes

### PR A (2026-10-26, `feature/testing-ci-hardening`)
- **Coverage is gated now, not after PR E (deviation from T2, an improvement).** Both repos already
  clear the floor with every file counted (backend 92.88% statements, frontend 90.18%), so the
  planned reporting-only `coverage` job — which would have run the backend suite, and its real
  Stripe TEST-mode calls, a second time on every PR — was not built. Each test job runs its suite
  once with `npm run test:coverage` and `coverageThreshold` fails it below 80%. PR E therefore only
  adds the `ci-passed` umbrella job.
- **Type-checking `e2e/` found a real defect, fixed here.** `@axe-core/playwright` declares
  `playwright-core` as a peer; nothing at the top level provided it, so npm installed
  `playwright-core@1.62.1` beside the runner's 1.47.2 and the accessibility scans ran on a second
  Playwright. `playwright-core` is now pinned exactly to the runner's version (one copy, deduped),
  and `frontend/lib/__tests__/guards/playwrightVersionGuard.test.ts` fails if `@playwright/test`,
  `playwright-core` and the CI image tag ever differ.
- **Route-existence guard** (`scripts/check-route-existence.mjs` + `scripts/route-introspect.cjs`):
  introspects the live Express app (117 routes, matching the 117 `router.<method>(` definitions);
  scans 110 frontend `api.<method>()` calls and 36 E2E `MockRule`s; zero phantoms. Stricter than
  CKQ's: an unparseable call site is an extraction failure (exit 2), not a warning, since every
  call site in this repo is a literal today. Planted phantoms in both an app file and the E2E mock
  registry were reported (exit 1). CI runs `--self-test` first.
- **Before PR A**, a separate fix shipped as PR #113: fonts are self-hosted (`next/font/local` over
  `@fontsource-variable/*`) because `next/font/google`'s build-time fetch failed the develop E2E
  build on 2026-09-30; `selfHostedFontsGuard.test.ts` prevents a regression.
### PR B (2026-10-26, `feature/testing-e2e-hardening`)
- **Loud-fail is live.** An unmocked `/api/v1/*` request is answered `599` and fails the test in
  teardown (`frontend/e2e/fixtures/test.ts` → `assertNoUnmockedRequests`). No spec uses
  `allowUnmocked`. Proven by a planted unmocked call, which went red with the request listed.
- **Mocks are type-locked to what the app reads (T5, extended).** `json<T = never>(route, status,
  body: NoInfer<T>)` will not compile without a named response type, and the body must match it.
  The envelopes (`{ levels: … }`, `{ user: … }`, …) were inline types in each service, so there was
  nothing to name. They now live once in the new `frontend/lib/apiResponses.ts`, used by both the
  services (and `AuthContext`) and the mocks. A body type stays in `lib/types.ts` when it is
  already a domain type. Typing the fixtures found drift that had been passing silently:
  - The public endpoints were mocked with admin shapes. `/levels/public` and `/locations/public`
    now use `FIXTURE_PUBLIC_LEVELS: PublicLevel[]` and `FIXTURE_PUBLIC_LOCATION: PublicLocation`.
  - Fields that were missing: the schedule's `students`, the location's `timezone`, the payment
    method's `_id`/`cardExpMonth`/`cardExpYear`, and the price preview's `monthlyFee`.
  - The register spec's 201 left out `registration`/`subscription`. It now sends the failed-ledger
    row plus the reserved subscription in dunning, as ADR 008 returns them on a decline.
  - The attendance PATCH mock sent `{ success: true }`, which the app never reads. It now sends
    `IgnoredBodyResponse` (`{}`).
- **Mobile project (T6).** `mobile-chrome` (Pixel 5) runs `public-site`, `login`, `calendar` and
  `kiosk`. Phones open `/calendar` in the List view on purpose (design-system "Calendar", C10), so
  the month-grid tests request `?view=month`. A new test pins 390 px and asserts the List default.
  At ≤ 600 px, `/classes` filters with a `<select>` instead of the pill row. The pill test pins
  1280 px, and a new test drives the `<select>` at 390 px. Every width-dependent test pins its
  width, so it runs on both projects, and nothing is skipped by device.
- **360 px overflow check** (`e2e/helpers/layout.ts`, zero tolerance). It covers `/`, `/classes`,
  `/coaches` (beyond T6's list) and `/calendar`. Instead of `networkidle` (discouraged by
  Playwright), it waits for a visible heading, and the clock is pinned so the month grid always
  shows the same month. No product layout bug was found. Proven by a planted wide element, which
  went red.
- **Result:** e2e and app `tsc` are clean; Jest 69 suites / 560 tests; Playwright 69 passed and
  4 skipped (the two un-baselined visual tests on each project).
- **Follow-up when payment PR 2 (#117) merges:** `FIXTURE_REGISTRATION` uses
  `stripePaymentIntentId` because develop still has that field. The rename will turn it into a
  type error in `tsc -p e2e`, which is exactly what this PR's typing is for.
