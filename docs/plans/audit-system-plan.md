# Audit System Plan — Registration/Payment Audits, Admin Report, Testing Strategy Refresh

**Status: APPROVED FOR AUTONOMOUS EXECUTION**
Owner directive: all phases execute in ONE uninterrupted run (no per-phase check-ins), same model
as `ckq-parity-plan.md`. The executing agent follows §0 (Execution Protocol) exactly.

This plan ports CKQ's registration/payment audit system — a live, repeatable check that trial
booking, group registration, and the 10% sibling discount actually work end-to-end — adapted to
Frisco's smaller feature surface (no camps/tournaments/guest/membership/credit) and to two real
constraints CKQ doesn't have: **no MCP Playwright browser tool is available in this environment**,
and **Frisco's auth is httpOnly-cookie-only** (no `Authorization: Bearer` support). Both are
corrected for below, not silently worked around.

CKQ reference files (read-only, structural reference — they live on this machine):

| What | CKQ path |
|---|---|
| Admin audits dashboard page | `C:\Users\mages\chesskqwebsite\websitepublic\website2.0\src\app\(nonheadless)\admin\audits\page.tsx` |
| Admin audits service layer | `...\src\app\services\admin\auditRuns.ts` |
| AuditRun test factory | `...\src\testing\factories\auditRun.ts` |
| Admin audits page test | `...\src\__test__\admin\pages\AuditsPage.test.tsx` |
| Live registration audit skill (scenario structure/report format) | `C:\Users\mages\chesskqwebsite\.claude\skills\audit-live-registration\SKILL.md` |
| Sibling discount DB-integrity audit (reference only, not ported as-is) | `C:\Users\mages\chesskqwebsite\.claude\skills\audit-sibling-discount\SKILL.md` |
| CKQ testing strategy (structure to mirror) | `C:\Users\mages\chesskqwebsite\docs\TESTING_STRATEGY.md` |
| Skills backlog conventions | `C:\Users\mages\chesskqwebsite\docs\skills.md` |

---

## 0. EXECUTION PROTOCOL (binding on the executing agent)

1. **Pre-reads (mandatory, before any edit):** `CLAUDE.md`, `docs/TESTING_STRATEGY.md`,
   `docs/design-system.md`, `docs/features/admin.md`, `docs/decisions/001-in-house-subscription-billing.md`,
   `DATABASE_SCHEMA_DOCUMENTATION.md`, plus every existing file this plan tells you to modify.
   Read every file before editing it.
2. **Branch first:** `git checkout develop && git pull origin develop && git checkout -b feature/audit-system`.
   Verify with `git branch --show-current` before the first edit and before every commit.
3. **Order:** Phase 1 → 2 → 3 → 4 → 5. Phase 2 (admin page) reads Phase 1's API. Phase 4 (skills)
   wraps Phase 3's scripts. Phase 5 (docs) documents everything built in 1–4.
4. **Per-phase gate (all must pass before the phase's commit):**
   - `cd backend && TZ=UTC npm test` — all green
   - `cd frontend && TZ=UTC npm test` — all green
   - `cd frontend && npx tsc --noEmit` — 0 errors
   - `cd frontend && npm run build` — clean
   - No `console.log` in production code. No `any` on domain data.
5. **Commit per phase**, files staged explicitly by name (never `git add .`). Message format:
   `feat(audit): <summary> [audit-system phase N]`. **Never push, never open a PR** — the owner
   tests locally after the run and ships via the normal `develop`-branch flow used for every
   other feature this session.
6. **Test failures in code you wrote this run:** diagnose and fix properly, then re-run.
   **Pre-existing tests:** update only if a phase changes behavior an existing test asserts
   (none expected — this plan is additive). Never delete, skip, or weaken a test to get green.
7. **New tests follow `docs/TESTING_STRATEGY.md` to the letter** (Phase 5 updates that doc — follow
   its *current* content for Phases 1–4, then reconcile): mock at the network boundary only,
   typed fixtures, `userEvent` not `fireEvent` for new frontend tests, fixture instants at midday
   UTC, no now-relative dates.
8. **Phase 3's `audit/` scripts are NOT run automatically by this plan.** They require real
   staging credentials (env vars, not committed) and mutate the staging DB + create real Stripe
   TEST-mode charges. Writing and unit-testing the scripts is in scope; **executing a live audit
   run against staging is a separate, owner-triggered step after this plan's code lands** —
   exactly the same "built, not auto-run" boundary CKQ's own audits observe.
9. **Final report-back format:** per phase — files created/modified, suite/test counts (real
   numbers from the runs), gates passed, anything deviating from this plan and why.

---

## 1. LOCKED DECISIONS (do not reopen)

| # | Decision |
|---|---|
| D1 | **No MCP Playwright is available in this environment.** CKQ's live-audit skills depend on it (Claude interactively driving a browser). Corrected design: install the real `playwright` npm package in a new top-level `audit/` directory and write actual unattended scripts (headless Chromium, real clicks, real Stripe TEST-mode charges) that a skill invokes with a single non-interactive command. This is also the correct fit for "auto mode, no intervention" — MCP-driven browsing is inherently interactive; a real Playwright script is not. |
| D2 | **Reporting auth uses the browser context's own cookie, not a bearer token.** Confirmed by reading `backend/src/config/passport.js`: `cookieExtractor` reads `req.cookies.accessToken` only — there is no `Authorization: Bearer` fallback (unlike CKQ). The script logs in as the staging superadmin via the real UI in its own browser context, then uses Playwright's `context.request.post(...)` (which automatically carries that context's cookies) to report to `/audit-runs`. Never hand-roll a separate curl+cookie-header path. |
| D3 | **Scenario set is Frisco's real architecture, not a copy of CKQ's.** Confirmed by reading `register/page.tsx` and `paymentMethod.service.js`: registration always uses a **pre-saved** card (added on a separate `/parent/payment-method` step, plain `stripe.paymentMethods.attach()`, no SetupIntent/confirm at save time — a decline card *saves* successfully and only fails at actual charge time). CKQ's "new card at checkout" vs "saved card at checkout" split doesn't exist here. Final scenario list: **S1** trial booking (free) · **S2** add a payment method then register (group class) · **S3** sibling discount (second child, cheaper class, preview vs. real-charge cross-check) · **S4** decline path (dedicated decline-card parent, expect a clean 402 and no false-success `Registration`/`Subscription`). No camp/tournament/guest/membership/credit scenarios — none of those features exist in Frisco (per `CLAUDE.md`'s explicit deferred list). |
| D4 | **Dedicated, seeded audit accounts + a dedicated audit-only class/schedule/price**, not ambient staging data. `audit/seed-audit-accounts.js` (idempotent, safe to re-run) creates: `audit-parent-1@example.com` (1 child, S2), `audit-sibling-parent@example.com` (2 children, S3), `audit-decline-parent@example.com` (1 child, S4), and a fixed staging superadmin login (reuse the existing seeded one — no new account) for reporting. Same script also idempotently creates two dedicated Levels/Locations/GroupClasses/Schedules ("Audit Level A" $100/mo, "Audit Level B" $50/mo) so the audit never depends on real class data drifting or selling out. This mirrors the isolation principle already in `docs/TESTING_STRATEGY.md`, applied to a live environment instead of a mocked one. |
| D5 | **Staging reset script**, `audit/reset-staging-audit-data.js` — plain Node + mongoose (no Playwright), targets *only* the fixed audit account IDs from D4: deletes their `TrialClass`/`Registration`/`Subscription` docs, pulls them out of every `GroupClassSchedule.students` and `GroupClassSession.students` array they were added to. Hard-fails if `MONGO_URI` doesn't contain `friscofencing-staging`. Never runs automatically — a separate, owner-triggered skill, same separation CKQ's `/sync-preprod` keeps from its own live audits. Must be run before every audit re-run (a stale `TrialClass` blocks S1 via its unique-per-student index; this is documented in the skill, not silently discovered). |
| D6 | **`/admin/audits` is superadmin-only** — same as CKQ, and this surfaces real payment/Stripe test-run data. |
| D7 | **No CI-gated mocked-Playwright E2E layer in this pass** — CKQ has a second, separate layer (`@playwright/test` against localhost with `page.route()` mocks, gating PRs to `main`). Deliberately out of scope here (owner decision) — documented as such in Phase 5, not silently omitted. |
| D8 | **Audit results ARE real, not simulated** — every scenario either books a real trial, creates a real `Registration`/`Subscription`, or completes/declines a real Stripe TEST-mode `PaymentIntent`. Targets `develop` staging **only**; the script hard-fails if pointed at a URL that isn't the known staging host. |

---

## Phase 1 — Backend: `AuditRun` model + API

**Files:**
- `backend/src/models/auditRun.model.js` — new
- `backend/src/services/auditRun.service.js` — new
- `backend/src/controllers/auditRun.controller.js` — new
- `backend/src/routes/auditRun.routes.js` — new
- `backend/src/app.js` — mount `app.use('/api/v1/audit-runs', auditRunRoutes)`
- `backend/tests/routes/auditRun.routes.test.js` — new

**Model** (mirrors CKQ's `AuditRun` shape exactly, translated to Mongoose):

```js
const auditRunSchema = new Schema({
  auditName: { type: String, required: true },       // e.g. "audit-live-registration"
  group: { type: String, default: null },             // sub-group arg, or null for a full run
  overall: { type: String, enum: ['pass', 'fail', 'partial'], required: true },
  scenarios: [{
    id: { type: String, required: true },              // "S1"
    name: { type: String, required: true },
    result: { type: String, enum: ['pass', 'fail', 'skip'], required: true },
    note: { type: String, default: '' },
  }],
  summary: { type: String, default: '' },
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date, required: true },
  runner: { type: String, default: 'playwright-script' },
}, { timestamps: true });
```

**Routes** (`requireAuth, requireRole('superadmin')` on all three — per D6):
- `POST /api/v1/audit-runs` — create a run (called by the script's reporting step)
- `GET /api/v1/audit-runs?latest=true` — one row per distinct `auditName`, most recent only (admin dashboard's primary read)
- `GET /api/v1/audit-runs/:id` — single run detail (API parity with CKQ; not wired to a page yet, same as CKQ's own unused `fetchAuditRuns`/`fetchAuditRunById`)

**Service — `latest=true` query**: `AuditRun.aggregate([{ $sort: { createdAt: -1 } }, { $group: { _id: '$auditName', doc: { $first: '$$ROOT' } } }])` — one most-recent doc per `auditName`.

**Tests** (`auditRun.routes.test.js`, mirrors this repo's existing route-test conventions):
1. Superadmin creates a run, 201, all fields persisted correctly
2. `GET ?latest=true` returns one row per `auditName` — seed 2 runs for the same `auditName` at different times, assert only the newer one comes back
3. 403 for a non-superadmin (admin, coach, parent) on all three routes
4. `GET /:id` returns 404 for an unknown id
5. Validation: missing `auditName`/`overall`/`startedAt`/`finishedAt` → 400

---

## Phase 2 — Admin report page

**Files:**
- `frontend/lib/types.ts` — add `AuditRun`, `AuditRunScenario`, `AuditOverallResult`, `AuditScenarioResult` (mirrors `backend/src/models/auditRun.model.js` exactly, not CKQ's TS shape blindly)
- `frontend/lib/services/auditRuns.ts` — new, `fetchLatestAuditRuns()` (query, throws on failure — this repo's established contract)
- `frontend/app/admin/audits/page.tsx` — new, mirrors CKQ's structure: hardcoded `KNOWN_AUDITS` registry (one entry to start: `{ key: 'audit-live-registration', label: 'Live Registration' }`), table (Audit / Last Result / Last Run / expand), `AdminPageHeader`, `AdminLoadingRow`, relative-time formatter, expandable per-scenario detail row
- `frontend/app/admin/audits/__tests__/page.test.tsx` — new
- `frontend/app/components/admin/admin.module.css` — add `.chipFailed` (error tokens), `.chipPending` (gold/warning tokens), `.chipNeutral` (muted, for "Never run") — `.chipActive`/`.chipMuted` already exist; these three are the missing overall-result states
- `frontend/app/admin/layout.tsx` — add `{ href: '/admin/audits', label: 'Audits', icon: <ShieldCheck size={15} /> }` under a new **Reports** `NAV_SECTIONS` entry (own section — this isn't Programs/Billing/Places/Content)
- `frontend/app/admin/layout.tsx`'s existing route-guard pattern already redirects non-admin/superadmin visitors; **add an additional in-page guard on `/admin/audits` itself** for superadmin-only (mirrors CKQ's `isSuperadmin` check in the page component, since the shell-level guard only enforces admin-or-superadmin)

**Page behavior**: loading → `AdminLoadingRow`; each `KNOWN_AUDITS` row always renders (a never-run audit shows a "Never run" neutral chip, not an empty table) — reads as a checklist, matching CKQ's explicit design intent, not a log.

**Tests**: renders one row per `KNOWN_AUDITS` entry; "Never run" for an audit with no data; pass/fail/partial chip renders correctly per `overall`; expand/collapse reveals the scenario table; non-superadmin sees the access-denied state; MSW error → retry works.

---

## Phase 3 — `audit/` package: seed, reset, and the live-registration script

New top-level directory (sibling to `backend/`/`frontend/`, not inside either — it's neither a Next.js app nor an Express service, matching CKQ's own separation of live-audit tooling from the two main apps):

```
audit/
  package.json          — deps: playwright, axios, mongoose, dotenv
  .env.example           — AUDIT_STAGING_URL, AUDIT_BACKEND_URL, AUDIT_MONGO_URI,
                            AUDIT_TEST_PASSWORD, AUDIT_SUPERADMIN_EMAIL, AUDIT_SUPERADMIN_PASSWORD
  .gitignore              — .env
  lib/
    staging-guard.js      — throws unless AUDIT_STAGING_URL/AUDIT_MONGO_URI contain
                             "friscofencing-staging" / the staging Vercel alias — imported by
                             every script below as its first line, not just documented
  seed-audit-accounts.js  — idempotent: creates the 3 audit parents + children + 2 audit
                             classes/schedules/prices from D4
  reset-staging-audit-data.js — D5's reset, plain mongoose, no Playwright
  scenarios/
    s1-trial-booking.js
    s2-registration.js
    s3-sibling-discount.js
    s4-decline.js
  run-registration-audit.js — orchestrator: runs S1–S4 in sequence (even if one fails — collect
                               all results first, matching CKQ's "run all, report at the end" rule),
                               builds the AuditRun payload, logs in as superadmin in its own
                               browser context, POSTs via context.request per D2
```

**Each scenario script** exports one async function `(page, config) => { id, name, result, note }`
— `page` is a fresh Playwright page/context per scenario (no shared state between scenarios,
mirrors this repo's own test-isolation rule). Pass criteria per scenario (translated from the
CKQ report format into what actually applies here):

- **S1**: `POST /trial-classes`-driven booking completes via the real 3-step wizard (`ChildPickerCards` → class → `PillRow` session pick → confirm); confirmation screen renders; the audit's dedicated trial-eligible child now has a `TrialClass` (verified via an authenticated API call in the same context, not a DB peek — keeps the check honest to what a real user experience proves).
- **S2**: add-payment-method step (real Stripe `CardElement`, test card `4242 4242 4242 4242`) succeeds; register wizard completes; `Registration.status === 'active'`, `chargeAmount` equals the audit class's known price.
- **S3**: register `audit-sibling-parent`'s first (pricier, "Audit Level A") child — expect no discount; register the second (cheaper, "Audit Level B") child — cross-check the **live preview** (`GET /registrations/preview`, the endpoint built earlier this session) against the **real charge response**, exactly the "preview and reality must never disagree" property already proven in `registration.routes.test.js`; assert `siblingDiscountApplied === true` and both amounts match exactly.
- **S4**: `audit-decline-parent` saves Stripe's documented decline card (`4000 0000 0000 0002`) — succeeds at save time (per D3); attempts registration — expect a clear, legible decline message in the UI (never a raw Stripe/JS error), and confirm via API that no `Registration`/`Subscription` was left in a false-success state.

**Final report** (console, same shape as the CKQ example, adapted):

```
════════════════════════════════════════
 AUDIT: audit-live-registration
 Run: <ISO timestamp>
 Target: <AUDIT_STAGING_URL>
════════════════════════════════════════
 S1 — Trial booking                          ✓/✗
 S2 — Add card + register                    ✓/✗
 S3 — Sibling discount (preview == charge)    ✓/✗
 S4 — Decline path (clean failure)            ✓/✗
────────────────────────────────────────
 Passed: N/4   Failed: <list>   
 Reported to /admin/audits: yes/no (non-fatal)
════════════════════════════════════════
```

**No unit tests for the Playwright scripts themselves** (they require live staging + real Stripe
TEST-mode — same as CKQ, which never unit-tests its live-audit skills either). `staging-guard.js`
(pure logic, no network) **does** get a small Jest-free `node --test`-style sanity check, or is
simply short and reviewed by hand — call this out explicitly in the final report rather than
silently having zero coverage on a safety-critical 10-line file.

---

## Phase 4 — Skills

**Files:**
- `.claude/skills/audit-live-registration/SKILL.md` — new (Frisco has no `.claude/skills/` yet; this creates the directory)
- `.claude/skills/reset-audit-data/SKILL.md` — new

Both are thin wrappers (unlike CKQ's, which contain the entire browser-driving logic inline,
since here the logic lives in `audit/`'s real scripts per D1): document what the script does, its
pass criteria (copied from Phase 3), the exact command to run (`cd audit && node run-registration-audit.js`
/ `node reset-staging-audit-data.js`), the required env vars, and the hard staging-only rule.
`reset-audit-data` explicitly is never auto-invoked by `audit-live-registration` (D5).

---

## Phase 5 — Docs

- **`docs/TESTING_STRATEGY.md`**: new "Live Audit Scripts" section (mirrors CKQ's "Live Audit
  Skills" section structure: two-layer strategy table, rules, available scripts table) — states
  plainly that the CI-mocked Playwright E2E layer (CKQ's other layer) is a deliberate D7 scope
  decision, not a gap. New "Coverage Expectations" table with **real, measured** numbers (already
  captured this session): backend 84.88% statements / 62.66% branches / 84.85% functions / 84.95%
  lines; frontend 89.87% / 80.26% / 88.99% / 90.97% — both already clear an 80%-statements target,
  stated as the target going forward. Command to re-measure: `TZ=UTC npm test -- --coverage` in
  each repo (confirmed working, zero new tooling needed).
- **`docs/TEST_COVERAGE.md`**: add the same real coverage table (this file already tracks
  suite/test counts — the coverage % table is a new, complementary section, not a replacement).
- **`docs/features/admin.md`**: add the Audits page to the per-page behavior spec (superadmin-only,
  read-only report, "Never run" checklist semantics).
- **`CLAUDE.md`**: add this plan to the Documentation Map table once shipped (SHIPPED plan row,
  same convention every prior plan in that table follows) — done as the owner reviews/merges,
  not by the executing agent (matches how every other plan row in that table already reads
  "pending owner review" until actually merged to `develop`).

---

## Final verification (all phases)

- `TZ=UTC npm test` — backend and frontend, both green, real counts reported
- `npx tsc --noEmit` — 0 errors
- `npm run build` (frontend) — clean
- `git status --short` reviewed — only the files this plan lists
- Report back: exact files touched per phase, real test counts, and the exact commands the owner
  runs next (`cd audit && npm install && npx playwright install chromium && cp .env.example .env`
  — then fill in real staging credentials, `node seed-audit-accounts.js` once, and
  `node run-registration-audit.js` for the first real run).

---

## Addendum — 2026-08-23: first real run against staging

The written plan above was correct in design; the actual scenario/helper *code* had bugs no
amount of reading could have caught without a real run — exactly the reason this system exists.
Found and fixed, in order:

1. **`audit/lib/login.js`**: the login button's accessible name changes to "Logging in..." the
   instant the click handler starts, well before the request resolves — waiting for the "Log
   In"-named element to *detach* matched that text change, not a real login (~400ms, zero
   cookies set, still on `/login`). Fixed to wait for actual navigation away from `/login`. This
   silently broke every scenario *and* the reporting step identically.
2. **`backend/scripts/audit-seed.js`**: `findOrCreateUser`'s idempotency check queried by
   `email` — students have none, so `User.findOne({ email: undefined })` (Mongoose drops the
   undefined key) matched the first unrelated user in the whole collection instead of ever
   creating a student. Zero student documents were ever actually created on the first seed run.
   Fixed to key students by role+name+parentId instead.
3. **`audit/lib/stripe-card.js`**: the payment-method page's `CardElement` uses Stripe's default
   options (no `hidePostalCode`), so it has a ZIP field too — omitting it produced a real,
   legible "Your postal code is incomplete." error that surfaced as a downstream save timeout.
4. **`audit/scenarios/s3-sibling-discount.js`**: `Locator.isVisible({timeout})` checks the DOM
   immediately — it does not actually wait/retry despite accepting a `timeout` option. The live
   discount preview needs a real network round-trip; the immediate check always read `false`.
   Fixed to `.waitFor({state:'visible'})`.
5. **`backend/scripts/audit-reset.js`**: clearing the Mongo `Registration` doc doesn't free
   Stripe's own 24h idempotency-key cache for `initial-registration-${studentId}-${scheduleId}`
   — a second attempt with the same pair collided with "Keys for idempotent requests can only be
   used with the same parameters they were first used with," a real 500, even right after a full
   DB reset. Fixed by deleting the student documents themselves so re-seeding gives them fresh
   `_id`s (and therefore a fresh idempotency key) every cycle. Also found missing entirely:
   `PaymentMethod` cleanup for the fixed parents (needed so S4 gets a guaranteed-unsaved card
   every run) — added.
6. **`audit/scenarios/s4-decline.js`** (design correction, not just a bug fix): the original
   design assumed Stripe's decline card saves successfully and only fails at charge time — wrong,
   confirmed live. `4000000000000002` declines at `stripe.paymentMethods.attach()` itself,
   surfacing as `POST /payment-methods` → 500 "Your card was declined." Rewrote S4 to test the
   real behavior (decline at the payment-method save step, not at registration checkout).
   **Real app finding, not fixed here** (this is the audit surfacing it, not silently patching
   app behavior): that 500 is architecturally inconsistent with `registration.service.js`'s own
   decline path, which correctly uses 402 for the same class of failure — a card decline is an
   expected user-facing outcome, not a server error. Flagging for a future decision, not acting
   on it unilaterally.
7. **`audit/scenarios/s4-decline.js`** (second bug, same file): the payment-method page renders
   **two** `role="alert"` elements (the real one plus an unrelated always-empty one elsewhere in
   the portal shell). `page.getByRole('alert')` resolved to either, non-deterministically — when
   it picked the empty one, the scenario reported "Decline message not clean/legible: ''" even
   though the real message was correct. Fixed by filtering to the alert with actual text.

**Result: 4/4 scenarios passing** on the first fully clean run after all fixes, confirmed both in
the script's own console report and by reading it back via `GET /audit-runs?latest=true` —
visible on `/admin/audits` on staging.
