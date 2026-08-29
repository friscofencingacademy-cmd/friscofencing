# Implementation plan: CI-gated end-to-end testing (closing the third testing layer)

**Status:** DRAFT — for owner review, not yet built. No code has been touched for this plan.
**Triggered by:** a 2026-08-28 session assessment (`docs/TESTING_STRATEGY.md`, `docs/TEST_COVERAGE.md`)
found real Jest/MSW coverage (88–90% statements, both layers) but **no real-browser coverage that
gates a merge** — the only Playwright in the repo is `audit/`, an owner-triggered, real-Stripe,
real-staging tool with 6 scenarios scoped to registration/billing, never run automatically. The
same session's audit-skills-refresh work hit this gap directly: two frontend commits
(`9608fdf`, `e3403d4`) silently broke the register wizard's DOM structure, and nothing caught it
until someone manually ran `audit/` days later.
**Scope decided by owner:** close the gap — build the third layer `docs/TESTING_STRATEGY.md`
already documents as deliberately deferred: a CI-gated `@playwright/test` suite against a locally
running frontend with fully mocked API responses, modeled on the pattern CKQ already uses.

---

## 0. What this is and isn't

This is **not** a replacement for either existing layer:

| Layer | Tool | Target | Data | Catches |
|---|---|---|---|---|
| Jest/MSW | `jest` | jsdom | Fully mocked | Fast, deterministic, component/route logic — runs on every change today |
| **NEW: E2E** | `@playwright/test` | Real Chromium, real Next.js server (`localhost`) | Fully mocked (`page.route()`) | Real DOM structure, real client-side routing/hydration, real accessible-name/selector regressions — **the exact class of bug this session's audit refresh hit twice** |
| Live audit (`audit/`) | Raw `playwright` | `develop` staging | Real DB + real Stripe TEST-mode | Integration truth: real auth, real Stripe behavior, real cross-service wiring — owner-triggered only |

The new layer sits **between** the other two: heavier than Jest (real browser, real routing) but
far cheaper than the live audit (no database, no Stripe, no staging, no manual trigger — it runs
on every PR like Jest already does). It cannot and should not prove a real charge succeeds — that
stays `audit/`'s job. It proves the DOM a user actually interacts with matches what every
scenario's `page.route()` mock and Playwright's real accessibility tree agree it should.

**What this layer explicitly does NOT catch — stated up front, not left to be assumed:** a
`page.route()` mock is a fixture someone wrote by hand. If the real backend's response shape
changes — a renamed field, a removed status value, a 500 from a missing seed step — this suite's
mocks keep dutifully returning the old shape and every spec keeps passing, green, while the real
app is broken. That is a real, distinct failure mode from what this plan is built to catch, and
this session hit both kinds in the same afternoon: the register-wizard "Continue" button removal
(a pure frontend DOM change — **this suite catches it**) and the unseeded `Service` registry
500 (a real backend/environment gap — **this suite would NOT catch it**, since its mock for
`POST /api/v1/registrations` would just keep returning a canned success response forever). Contract
drift between frontend and backend stays `audit/`'s job, precisely because it talks to the real
API. This suite and `audit/` are complementary for exactly this reason — neither one's passing
result should be read as "the other kind of regression didn't happen."

---

## 1. Design decisions

### D1 — Tool and location: `@playwright/test` inside `frontend/`

Use the official `@playwright/test` runner (not the bare `playwright` library `audit/` uses) —
built-in `test`/`describe`, parallelization, retries, an HTML report with trace viewer on failure,
and a `webServer` option that starts/stops the app under test automatically. This is CKQ's own
tool choice per `docs/TESTING_STRATEGY.md`'s existing comparison.

New files live in **`frontend/e2e/`** (sibling to `frontend/app/`), with `frontend/playwright.config.ts`
at the frontend package root — not a new top-level package like `audit/`. Reasoning: this suite
only ever drives the Next.js app; keeping it inside `frontend/` lets Playwright's `webServer`
option run `npm run build && npm run start` (or `next dev` for local iteration) with zero
cross-package path plumbing, and keeps `npm install`/`npm test`/`npm run test:e2e` all scoped to
one `package.json` a contributor already has open. `audit/` is a separate top-level package for
the opposite reason — it deliberately has nothing to do with a local frontend build, it drives a
deployed staging URL.

No new root-level `package.json` — this repo has never had one (`backend/`, `frontend/`, `audit/`
are three independent packages), and this plan doesn't introduce monorepo tooling to add a fourth.

### D2 — Mocking strategy: `page.route()`, colocated per spec file

Every backend call is intercepted at the network boundary with Playwright's `page.route('**/api/v1/**', ...)`
— no real backend process, no MongoDB, no Stripe keys, nothing to seed, nothing that can leak
staging/production credentials into CI. This matches CKQ's own documented approach (`docs/TESTING_STRATEGY.md`'s
"CKQ has a third layer" note) rather than introducing MSW's browser/service-worker mode, for two
concrete reasons:

1. **Consistency over reuse.** The frontend's existing Jest/MSW tests already define their mock
   handlers *inline per test file* (`setupServer(http.get(...), http.post(...))` — verified against
   `app/parent/register/__tests__/page.test.tsx`), not from a shared handlers module. There is no
   existing shared-fixtures abstraction to reuse; introducing MSW's separate browser-worker
   machinery (a service-worker file, a build step to register it) to save duplicating a handful of
   `route.fulfill()` calls is more new surface area than it's worth for this plan's scope.
2. **`page.route()` needs nothing registered in the app itself** — no service worker to install
   under test, no risk of a stray worker file shipping to a real build. It intercepts at the
   browser's network layer, transparent to the Next.js app entirely.

A small `frontend/e2e/fixtures/` module holds the handful of genuinely shared pieces (see D3), but
each spec file still owns its own scenario-specific route mocks next to the test that uses them —
same colocation convention the Jest suite and `audit/`'s own scenario files already follow.

**Known, accepted cost of this approach** (see §0's "what this does NOT catch"): every hand-written
mock is a snapshot of the API contract at the moment it was written, and nothing here re-validates
that snapshot against the real backend. This is why this suite doesn't replace `audit/` — it's
the deliberate boundary of what a mocked suite can responsibly claim to prove.

### D3 — Auth: a real login, once, then a shared fixture

Login is exercised for real at least once (a dedicated `login.spec.ts`): real form, real submit,
`page.route()` intercepts `POST /api/v1/auth/login` and responds with a `Set-Cookie` header for the
httpOnly JWT cookie (Playwright's `route.fulfill({ headers })` supports this) plus whatever
`GET /api/v1/auth/me`-equivalent the app calls next, mocked to return a fake user for the role
under test. This proves the real login page, the real Next.js rewrite proxy, and the real
role-based redirect (`ROLE_LANDING_PATH`) all still agree — a regression class Jest's mocked-router
component test for the login page structurally cannot catch.

Every other spec that just *needs* to be logged in as some role uses a shared
`frontend/e2e/fixtures/auth.ts` helper — `loginAs(page, role)` — that does the same route-mock/cookie
dance without re-typing a password into a form every time. One real, unmocked-at-the-UI-level login
flow test plus a fast fixture for everything else, mirroring how `audit/lib/login.js` is the single
real login implementation every `audit/scenarios/*.js` file reuses.

### D4 — Initial scope: five specs, chosen to catch what already broke or is unprotected today

Not full-app coverage in one pass — a first slice sized to prove the layer's value and catch the
concrete regression classes this session already found the hard way, matching how every other plan
in this repo phases its scope rather than attempting exhaustive coverage up front.

| Spec | Flow | Why this one, first |
|---|---|---|
| `login.spec.ts` | Real login form → cookie set → correct role landing page, for each of the 5 roles | Only real, unmocked-router coverage of `ROLE_LANDING_PATH`/auth cookie wiring in the whole test pyramid |
| `public-site.spec.ts` | Logged-out `/`, `/classes`, `/coaches` render without a client error | Zero real-browser coverage today; a hydration/rendering break here is invisible to Jest's jsdom render |
| `parent-register.spec.ts` | Full register wizard: pick child → pick level → pick a start date (**both** the this-month-pill-row case and the "Enroll for next month" case, explicitly, via `page.clock` — see D5) → pay → confirmation | **Directly reproduces today's two real breaks** (the removed "Continue" button, the renamed "Select a start date" group) as a standing regression test, so the next such change fails CI within minutes instead of surfacing only when someone manually runs `audit/` |
| `admin-shell.spec.ts` | Log in as admin/superadmin → sidebar renders expected nav sections → one representative Pattern-A CRUD page create/edit/delete round-trip against mocked responses | `AppShell.tsx` has zero direct test coverage today (`docs/TEST_COVERAGE.md`'s own documented gap) — this is the cheapest real-browser proof the admin shell itself renders and navigates |
| `coach-attendance.spec.ts` | Log in as coach → `/sessions/[id]/attendance` → mark a student attended → mocked PATCH fires with the right payload | The one shared coach/admin page with a real state machine (unmarked → attended/missed → retry-on-failed-charge) that Jest already unit-tests in isolation but no real click-through exists for |

Each spec is independently useful and independently mergeable — this table is the Phase 1 backlog,
not a single all-or-nothing PR. **Explicitly out of scope for Phase 1** (candidates for a Phase 2,
not forgotten): parent subscriptions management (cancel/reactivate/change-schedule), private-class
coach-contract → published-slot → public-booking chain, the register-private wizard, spotlight
admin content. These are real gaps too; Phase 1 is sized to prove the layer works and close the
highest-value/most-recently-proven-fragile paths first.

### D5 — Determinism: freeze the clock, don't depend on "today"

Today's live-audit run failed a second time for a reason with nothing to do with code: the
register wizard's "this month" date window depends on the real calendar date, and Aug 28 happened
to roll a weekly schedule's next occurrence into next month. An E2E suite that inherits that same
fragility would be flaky in the worst way — passing or failing depending on what day someone
happens to run it. `parent-register.spec.ts` uses Playwright's `page.clock.setFixedTime()` (built
in since Playwright 1.45, already satisfied by this repo's `^1.47.0` pin in `audit/package.json`)
to pin "now" to two fixed dates in two separate test cases — one mid-month (exercises the pill-row
path) and one deliberately within the last-two-weeks-of-month edge (exercises the "Enroll for next
month" fallback) — so **both** UI states this session discovered are covered on purpose, every run,
regardless of the real calendar date.

### D6 — CI wiring: new `.github/workflows/` — first CI this repo has ever had

This repo currently has **zero CI** — no `.github/` directory exists, and every merge to `develop`/
`main` today happens on Jest results the owner runs manually. Making this new suite "gate every
PR" (the stated goal) requires adding GitHub Actions for the first time, which is a bigger
decision than the test code itself and worth confirming explicitly rather than bundling in:

- **New file**: `.github/workflows/ci.yml` — on every PR (any base branch) and every push to
  `develop`/`main`: install both `backend/` and `frontend/` deps, run `backend`'s Jest, run
  `frontend`'s Jest, run the new `frontend` E2E suite (`npx playwright install --with-deps chromium`
  then `npm run test:e2e`). No secrets required — nothing here touches staging, Stripe, or a real
  database.
- **What this plan can and can't do alone**: I can add the workflow file itself. I **cannot**
  enable GitHub's "required status checks" branch protection rule that actually blocks a merge on
  a red run — that's a repo-settings change under Settings → Branches that needs a GitHub admin
  (owner) to click, not something available from this session. The workflow will run and report
  status on every PR the moment it's merged; making it a hard gate (not just a visible check) is a
  one-time, two-minute owner action documented in the builder instructions (§4) rather than
  something silently assumed done.
- Runtime cost: Jest (both) + Playwright/Chromium install + 5 specs is a few minutes per run —
  cheap enough for every PR, matching CKQ's own "required on every PR to `main`" precedent.

### D7 — Docs: promote the two-layer table to three, retire the "not yet built" line

Once built, `docs/TESTING_STRATEGY.md`'s "Two-layer strategy" table gains a real third row (this
layer, replacing the placeholder "CKQ has a third layer this repo deliberately does not build"
paragraph with what was actually built and how it differs from CKQ's version — e.g., this repo's
CI additionally gates `develop`, since that's this repo's staging-truth branch, not just `main`).
`docs/TEST_COVERAGE.md`'s "Intentionally skipped... E2E (Playwright) — not yet built for this
project at all" line is replaced with a real E2E section (spec count, what each covers, run
command), the same way the Jest sections already document themselves.

### D8 — Visual regression + accessibility checks, folded into the two highest-traffic specs

A "real browser catches what jsdom can't" layer that skips visual/a11y checking leaves an obvious
win unclaimed — both are cheap with Playwright and this codebase has a documented design system
(`docs/design-system.md`) whose regressions are exactly the kind jsdom structurally cannot render.
Not new spec files — folded into the two specs that already visit the highest-traffic, most
representative pages, to keep this proportionate rather than opening a second full axis of
coverage:

- **`public-site.spec.ts`**: add `expect(page).toHaveScreenshot()` baseline snapshots for the
  logged-out home page and `/classes`, plus an `@axe-core/playwright` scan (`AxeBuilder(...).analyze()`,
  asserting zero `serious`/`critical` violations — `moderate`/`minor` logged, not failed, to avoid
  a noisy first run) on the same two pages.
- **`admin-shell.spec.ts`**: the same axe scan on the admin dashboard after login (the page every
  admin/superadmin session starts from). No screenshot baseline here — the admin shell's content is
  data-driven (counts, lists) and would produce noisy, low-value diffs; the public pages are static
  marketing content, where a screenshot diff is actually a meaningful, low-noise signal.

New dependency: `@axe-core/playwright` (devDependency, `frontend/package.json`). Screenshot
baselines are committed to the repo (`frontend/e2e/*.spec.ts-snapshots/`, Playwright's default
location) and only need updating when the page's actual design intentionally changes — an
unexpected diff on an unrelated PR is exactly the win this is for.

### D9 — Cross-file maintenance burden: explicit cross-references, not a forced shared module

Once built, three places independently encode knowledge of the register wizard's DOM: the Jest
component test, `parent-register.spec.ts` (this plan), and `audit/scenarios/s2-registration.js` /
`audit/lib/register-child.js` (real, already exists). The next wizard change — and there will be
one — means updating all three, or silently letting one rot exactly the way `audit/`'s copy just
did. A shared selector module isn't a clean fit here: `frontend/e2e` runs on `@playwright/test`
inside the `frontend` package, `audit/` runs on the bare `playwright` library as its own
independent top-level package with a different API surface and versioning — forcing a real shared
module across that boundary is a bigger refactor (and a bigger risk of the two suites drifting on
whose config wins) than this plan should take on just to solve a comment-discipline problem.

Cheaper, immediate fix: each of the three files gets a one-line comment pointing at the other two
by path, so a contributor editing any one of them sees the obligation in the diff they're already
looking at:

```
// If you change this wizard's DOM/labels, also update:
//   frontend/e2e/parent-register.spec.ts (this file's Playwright twin)
//   audit/scenarios/s2-registration.js + audit/lib/register-child.js (live-audit twin)
```

Revisit real code-sharing only if/when `audit/` itself is ever migrated onto `@playwright/test` —
out of scope here, noted so it isn't forgotten.

### D10 — Wire into `CLAUDE.md`'s pre-read table, so this doesn't silently rot the way `audit/` did

`audit/` went stale for days because nothing told anyone touching the register wizard that a
Playwright script's assumptions depended on its exact DOM shape. Building a second suite with the
same blind spot would repeat the mistake this plan exists to fix. Add one new row to `CLAUDE.md`'s
"Pre-read requirements" table (the same table that already gates admin/parent-portal/private-class/
public-site changes):

| If you're about to... | Read first |
|---|---|
| Touch the register wizard, login/role-redirect logic, the admin shell/nav, or the coach attendance page | `docs/TESTING_STRATEGY.md`'s E2E section — update the matching `frontend/e2e/*.spec.ts` in the same PR |

This is the one change in this plan that touches a file outside `frontend/` and `.github/` — worth
calling out explicitly since `CLAUDE.md` is the project's own source-of-truth doc, not test
infrastructure.

### D11 — Implementation-detail pins (so the build doesn't hit avoidable surprises)

Checked against current source, not assumed, since this plan should meet the same "verified, not
guessed" bar the rest of this repo's plans hold themselves to:

- **`@playwright/test` version**: pin an exact version (no `^` range) at whatever the newest 1.47.x
  patch resolves to at install time — matching the major.minor `audit/package.json` already pins
  (`playwright@^1.47.0`), so the two Playwright installs in this repo can't silently drift onto
  versions with different `page.clock`/`page.route()` behavior for the same underlying browser
  binaries. `page.clock` (D5) requires ≥1.45, comfortably clear of this pin.
- **CI caching**: cache two things across runs, keyed on `frontend/package-lock.json`'s hash —
  the npm cache (`actions/setup-node`'s built-in `cache: 'npm'`, pointed at
  `frontend/package-lock.json` via `cache-dependency-path`) and the downloaded browser binaries
  (`~/.cache/ms-playwright` via `actions/cache`, additionally keyed on the pinned Playwright
  version from the point above). Without this, every PR re-downloads a Chromium binary from
  scratch, which is most of this workflow's real runtime cost.
- **Env vars the `webServer` build actually needs** — checked directly, not guessed:
  - `BACKEND_URL` (used by `next.config.js`'s `rewrites()`): has a safe `|| 'http://localhost:4000'`
    fallback already in the source, and since every backend call is intercepted by `page.route()`
    before it ever leaves the browser (D2), the rewrite's real destination is never actually hit.
    **No action needed** — confirmed, not assumed.
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (used by `lib/stripe.ts`'s module-scope `loadStripe(...)`
    call, which every page that imports it — `/parent/register`, `/parent/payment-method` — runs
    at bundle-load time): **is required**, confirmed by `frontend/.env.local.example` already
    documenting it as expected for local dev. Unset, `loadStripe(undefined)` runs on every page
    load that touches this module. Fix: set it in the CI workflow's env block to Stripe's own
    published example test **publishable** key (`pk_test_TYooMQauvdEDq54NiTphI7jx` — the one
    Stripe's own docs use everywhere; publishable keys are not secret by design and safe to commit).
    No real Stripe account or secret key involved anywhere in this suite.

---

## 2. Files touched

| File | Change |
|---|---|
| `frontend/package.json` | Add `@playwright/test` (exact-pinned, D11) and `@axe-core/playwright` devDependencies; add `test:e2e`/`test:e2e:ui` scripts |
| `frontend/playwright.config.ts` | New — `webServer` (build+start the Next app, D11's env block), `testDir: './e2e'`, Chromium only, HTML reporter, retries on CI, screenshot snapshot config (D8) |
| `frontend/e2e/fixtures/auth.ts` | New — `loginAs(page, role)` shared login/cookie fixture (D3) |
| `frontend/e2e/login.spec.ts` | New (D4) |
| `frontend/e2e/public-site.spec.ts` | New (D4); + screenshot baselines and an axe-core scan (D8) |
| `frontend/e2e/parent-register.spec.ts` | New (D4/D5); + cross-reference comment (D9) |
| `frontend/e2e/admin-shell.spec.ts` | New (D4); + an axe-core scan on the dashboard (D8) |
| `frontend/e2e/coach-attendance.spec.ts` | New (D4) |
| `audit/scenarios/s2-registration.js`, `audit/lib/register-child.js` | + cross-reference comment only, no logic change (D9) |
| `.github/workflows/ci.yml` | New — first CI in this repo; npm + Playwright-binary caching (D6, D11) |
| `docs/TESTING_STRATEGY.md` | Two-layer table → three-layer table; run instructions for `frontend`'s new `test:e2e`; explicit "what this layer does not catch" note (§0/D7) |
| `docs/TEST_COVERAGE.md` | Replace the "E2E — not yet built" line with a real section (D7) |
| `CLAUDE.md` | One new pre-read table row (D10) |

No `backend/` files touched at all — this suite never talks to a real backend process.

---

## 3. Verification plan (owner-run, after the build)

1. `cd frontend && npx playwright install --with-deps chromium` (first time only).
2. `cd frontend && npm run test:e2e` — expect all 5 specs passing locally.
3. Confirm the clock-mocking claim in D5 for real: temporarily comment out `select-start-date.js`'s
   "Enroll for next month" fallback logic's frontend equivalent (or just eyeball that
   `parent-register.spec.ts`'s two clock-fixed cases actually exercise two different code paths,
   e.g. via a quick `console.log` or Playwright trace inspection) — don't just trust that pinning
   two dates *looks* like it covers both branches.
4. Confirm the first `test:e2e` run generates screenshot baselines under
   `frontend/e2e/*.spec.ts-snapshots/` (D8) and that they're committed — a baseline that only
   exists on one contributor's machine defeats the point.
5. Confirm the axe-core scans (D8) actually ran and reported zero `serious`/`critical` violations
   — read the actual assertion output, don't just check the spec exited green (a scan that's wired
   up wrong can silently report zero violations because it never really ran).
6. Push the branch, open the PR, confirm `.github/workflows/ci.yml` actually runs and reports a
   status check on the PR in GitHub's UI — including that the npm/Playwright-binary caching (D11)
   actually hits on a second run (check the workflow's cache-hit log line), not just that the
   workflow passes.
7. **Owner action, not autonomous**: go to Settings → Branches → the `develop` (and/or `main`)
   protection rule → add the new workflow as a required status check. Confirm by opening a
   throwaway PR with a deliberately broken spec and watching GitHub actually block the merge
   button — the real proof this is a gate, not just a report.
8. Confirm `docs/TESTING_STRATEGY.md`/`docs/TEST_COVERAGE.md` read correctly post-edit (D7),
   including the new "what this layer does not catch" note (§0), and that `CLAUDE.md`'s new
   pre-read row (D10) reads correctly in context with the existing table.

---

## 4. Builder instructions

1. **Pre-reads:** this plan in full; `docs/TESTING_STRATEGY.md` (existing two-layer doc, for tone/
   convention); `audit/lib/login.js` and `audit/scenarios/s2-registration.js` (the closest existing
   precedent for a real-login-then-reuse-fixture pattern and for the register wizard's exact
   current DOM shape, respectively — read the CURRENT versions, not this plan's summary of them,
   since they were just fixed twice in the prior session); every file this plan touches, read
   before editing (per `CLAUDE.md`'s hard rule).
2. **Branch:** `git checkout develop && git pull && git checkout -b feature/e2e-testing-foundation`.
3. **Order:** D1 (scaffold + config, with D11's env/version pins built in from the start, not
   bolted on after) → D3 (auth fixture) → D4's five specs, in the table's order (login first, since
   every other spec's fixture depends on the same mocked-cookie mechanics login.spec.ts proves out
   for real) → D5 (fold clock-mocking into `parent-register.spec.ts` as it's written) → D8 (fold
   the axe-core scan and screenshot baselines into `public-site.spec.ts`/`admin-shell.spec.ts` as
   they're written, not after) → D9 (the three cross-reference comments) → D6 (CI workflow, D11's
   caching built in) → D7 + D10 (docs + `CLAUDE.md`).
4. **Test the tests**: for at least `parent-register.spec.ts`, deliberately break something it
   should catch (e.g., locally revert one of the two register-wizard fixes from the
   audit-skills-refresh session) and confirm the spec actually goes red — a new test suite that has
   never been proven to fail is not proven to catch anything. Do the same once for the axe-core
   scan (e.g., temporarily strip an `alt`/label from a public-site element) — a scan that's never
   been proven to fail is equally unproven.
5. **This does touch a shared, first-ever CI file** (`.github/workflows/ci.yml`) — unlike the
   audit-skills-refresh plan's "no gate" tooling, this literally *is* a gate. Flag the branch-
   protection step (§3.7) explicitly in the PR description as an owner action still pending after
   merge — don't let the PR read as "fully done" when the actual gate isn't switched on yet.
6. **Report back:** files touched; the real local `test:e2e` output (not paraphrased); confirmation
   the CI workflow actually ran on the PR itself (a workflow file only proves itself by running);
   confirmation the cache actually hit on a second run (D11); explicit confirmation of whether
   D5's clock-mocking was verified to hit both code paths (§3.3) or needs correction; and
   confirmation the axe-core scans and screenshot baselines were each proven to fail once (§4.4)
   before being trusted — matching this repo's own established convention of recording what a real
   run found, not just what was designed.
