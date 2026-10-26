# Audit & Health Refresh Plan — live audit revival, session extension, `/health`, audit guards

**Status:** READY-TO-EXECUTE. Spec'd 2026-10-26 from a measured audit of the repo, GitHub, and a
read-only query against the staging database. Nothing in this plan has been built.
**Executor:** another model (Opus or Sonnet), in auto mode, one PR at a time, in order. §1 is the
binding contract. The owner tests each PR locally/on staging before it is merged.
**Supersedes:** the scenario-maintenance parts of `docs/plans/audit-skills-refresh-plan.md` (its
D1–D6 shipped 2026-08-28 and are not reopened). `docs/plans/audit-system-plan.md` stays the
historical build record. The "Group-session generation cron" follow-up in
`docs/plans/deployment-launch-plan.md` is delivered here as PR 1.

---

## 0. What is actually wrong (measured, not assumed)

Everything below was verified on 2026-10-26 against `develop` at `1f1f1c4` (after PR #124).
Reproduce any line with the command next to it.

### 0.1 The live registration audit is dead, and mostly not for DOM reasons

| # | Finding | Evidence | Effect on `npm run audit:registration` |
|---|---|---|---|
| F1 | **Staging has zero upcoming group-class sessions.** 19 schedules, 0 sessions with `date >= now`, latest session date 2026-10-24. `generateInitialSessions` creates `SESSION_COUNT = 8` weekly sessions once, at schedule creation, and nothing extends them. | Read-only query (§7.1). `backend/src/services/groupClassSession.service.js:17`, `:58`. | S1, S2, S3, S5, S6 all fail at the date step ("No upcoming class dates…" / `select-start-date.js` throws). Only S4 can pass. The same gap hits every real parent on staging today. |
| F2 | **The audit fixtures no longer exist on staging.** 0 users matching `audit-*@example.com`, 0 students with `firstName: 'Audit'`, no "Audit Class A/B". `backend/scripts/wipe-staging-environment.js` deletes every collection and the 2026-08-31 staging refresh (`refresh-staging-data.js`) never re-seeds the audit fixtures. | Read-only query (§7.1); `wipe-staging-environment.js:1`; `scripts/lib/refreshStagingData.js` has no audit step. | Every scenario fails at login. `npm run audit:seed` must run first — and will silently rot again after the next refresh unless the refresh re-seeds. |
| F3 | **S1 drives a book-trial wizard that no longer exists.** `audit/scenarios/s1-trial-booking.js` clicks `getByRole('button', { name: /continue/i })` and reads `getByLabel('Class')`. The wizard is now sequential (no Continue), the select is `aria-label="Level"` with level names as options, the pill group is still `"Select a session"`, the CTA is `"Book Trial Class"`, the confirmation is `"Trial class booked!"`. | `frontend/app/parent/book-trial/page.tsx` (`<select aria-label="Level">`, `cta="Book Trial Class"`). | S1 fails even with data present. |
| F4 | **S4's documented contract is stale (the scenario itself still passes).** `SKILL.md` and the scenario comment say `POST /payment-methods` returns **500** "Your card was declined." The Stripe adapter now throws `httpError(402, error.message)` on an attach-time card decline, and the central error middleware would turn any real 500 into the fixed text `"Something went wrong"`. | `backend/src/payments/stripe/stripe.provider.js` `attachPaymentMethod`; `backend/src/middlewares/errorHandler.js` `GENERIC_SERVER_ERROR_MESSAGE`. | Doc is wrong; and the scenario misses a now-cheap regression check: the generic 5xx text appearing in the alert would mean the 402 mapping broke. |
| F5 | **No preflight.** A missing fixture, an empty session table, an unseeded `Service` row or a missing `STRIPE_PUBLISHABLE_KEY` each surface as six unrelated Playwright timeouts. | `audit/run-registration-audit.js` goes straight into scenarios. | Diagnosis costs a headed run every time. |
| F6 | **Nothing ties the audit's selectors to the app.** The E2E twin (`frontend/e2e/parent-register.spec.ts`) and `audit/` encode the same wizard DOM independently; the comment in both files asks humans to keep them in sync. Humans did not (F3). | Header comments in `audit/lib/register-child.js`, `s2-registration.js`, `parent-register.spec.ts`. | Drift is only discovered by a live run, which nobody runs. |
| F7 | **The audit has never run from anywhere but the owner's laptop.** Last recorded run 2026-08-28 (`auditruns`: one `pass 6/6`, two earlier `fail 2/6`). | Read-only query (§7.1). | Two months of billing/payment PRs (#115–#124) were never exercised against real staging + real Stripe through the UI. |
| F8 | `audit/README.md` still lists "S1–S4". | File. | Doc drift. |

**Checked, not stale:** `backend/scripts/audit-reset.js` (updated in payment PRs 1 and 2 — uses
`getPaymentProvider()` and `provider`/`providerPaymentMethodId`); `audit/lib/login.js` (labels
"Email"/"Password", button "Log In" unchanged); `audit/lib/stripe-card.js` (StripeCardForm still
renders Stripe's `CardElement`, so the iframe title and field names stand — re-verify on the first
live run, as always); `audit/lib/select-start-date.js` (both picker states still exist);
`audit/lib/register-child.js` (radio names, "Select a start date", "Register & Pay",
"Registration complete!", "Sibling Discount", and both reason strings match
`frontend/app/parent/register/page.tsx` and `calculateChargeAmount.service.js:143-144`);
`audit/lib/staging-guard.js` (production is still the bare `friscofencing.vercel.app`);
`/api/v1/audit-runs` routes and `/admin/audits` page (superadmin-only, `KNOWN_AUDITS` one entry);
staging payment-field migration (0 of 69 registrations and 0 of 2 payment methods carry a legacy
`stripe*` field); `Service` registry seeded on staging (4 rows).

### 0.2 `/audit-tests` is current, with three small fixes

| # | Finding | Fix (PR 3) |
|---|---|---|
| T1 | Phase 3 Step 3.3 greps for a `Re-measured YYYY-MM-DD` line; `docs/TEST_COVERAGE.md:9` now reads `Measured 2026-10-26 …`. The step reports "no snapshot date" against a current doc. | Match `^(Re-)?[Mm]easured (\d{4}-\d{2}-\d{2})`. |
| T2 | Check 13's baseline (75 files / 117 assertions / 2 candidates) predates PR F and #124 (80 Jest suites now). | Re-run `scripts/dead-negative-assertions.mjs` and restate the baseline with the date. |
| T3 | Step 1.2 counts no `audit/` files, so the report never says whether the live-audit layer exists or how it is verified. | Add one line: count `audit/scenarios/*.js`, state "no Jest by design — guarded by `auditSelectorGuard` (PR 2) and the live run". |

### 0.3 `/health` is the wrong repo's command

`~/.claude/commands/health.md` (user-level, outside this repo) is **CKQ's** "/status — CKQ Repository
Health Check": it fetches three `Chess-Kings-and-Queens/*` repos. Frisco has no health check at all.
PR 3 adds `.claude/skills/health/SKILL.md` for this repo plus a read-only data health script.

### 0.4 CI is green but not a gate

- Latest `develop` run (2026-10-26, run `40345924595`): `backend-tests`, `frontend-tests`,
  `e2e-tests`, `ci-passed` all `success`; E2E `95 passed, 4 skipped` of 99 listed in 12 specs.
- `gh api repos/friscofencingacademy-cmd/friscofencing/branches/develop/protection` → **404 "Branch
  not protected"**.
- `main` protection requires `backend-tests`, `frontend-tests`, `e2e-tests` individually — **not**
  `ci-passed`. Testing PR E asked for exactly `ci-passed` on both branches. Owner action (§6).

### 0.5 Production — NOT verified

The production schedules were created around 2026-08-21, so by F1's mechanics they ran dry in
mid-October. This could not be confirmed: the production read was denied in the planning session.
§7.2 has the one read-only command the owner runs first. **Assume production has the same gap until
that number says otherwise.**

### 0.6 Source-of-truth check (no drift found — recorded so nobody re-audits it)

- Ledger rows are created in exactly four places: `registration.service.js:276`,
  `renewal.service.js:569/669/804`, `privateClassEnrollment.service.js:197`. All charge through
  `services/billing/chargeFinalization.service.js` → `payments/` port. No frontend file computes a
  fee, discount or total (grep for arithmetic on `amount|fee|total` in `frontend/app`, `frontend/lib`
  returns only comments).
- `WebhookEvent` is written only by `controllers/webhooks.controller.js` and read only by its own
  dedup `findOne`. It is a redelivery guard, not a ledger. Nothing reconciles from it.
- `backend/src/models/subscription.model.js` is byte-identical before and after payment PRs 1–3 and
  testing PRs A–F. Enrollment reads (`student.service.js:63`, `kiosk.service.js:31/139`,
  `calendar.service.js:302`, `groupClassSession.service.js:293/387/393`) all key off an active
  `Subscription`. `GroupClassSchedule.students` remains the materialized roster mirror maintained by
  `roster.service.js`, not a second truth.

---

## 1. EXECUTION PROTOCOL (binding on the executing model)

1. **Pre-reads, before any edit:** `CLAUDE.md` (hard rules), `docs/TESTING_STRATEGY.md`,
   `docs/TEST_COVERAGE.md`, `docs/features/admin.md` ("Audits"), `docs/plans/audit-system-plan.md`,
   `docs/plans/audit-skills-refresh-plan.md`, `.claude/skills/audit-tests/SKILL.md`,
   `.claude/skills/audit-live-registration/SKILL.md`, `.claude/skills/reset-audit-data/SKILL.md`,
   `audit/README.md`, and **every file this plan tells you to modify, in full, before editing it**.
2. **One PR at a time, in order PR 1 → PR 2 → PR 3 → PR 4.** Each on its own branch from a fresh
   `develop`: `feature/group-session-extension`, `feature/live-audit-refresh`,
   `feature/health-skill`, `docs/audit-health-close-out`. PR 2 depends on PR 1's library (it is
   called from the audit seed); if PR 1 is not yet merged, branch PR 2 from PR 1's branch and say so
   in the PR description.
3. **Per-PR gate, all green before the commit:**
   - `cd backend && npm test` (this is `cross-env TZ=UTC jest --ci`) — all green
   - `cd frontend && npm test` — all green
   - `cd frontend && npm run typecheck` — 0 errors (app + `e2e/`)
   - `cd frontend && npm run build` — clean
   - `node scripts/check-route-existence.mjs --frontend frontend --backend backend` — exit 0
   - `/audit-tests` read-only run — no new CRITICAL
   - No `console.log` in production code (scripts under `backend/scripts/` are CLI tools and may
     print; the libs under `backend/scripts/lib/` return reports and print nothing). No `any` on
     domain data.
4. **Commit per PR**, files staged explicitly by name (never `git add .` / `-A`). Commit message
   starts with the type and names the plan: e.g. `feat(sessions): weekly group-session extension
   (audit-health plan PR 1)`. End with the attribution line the session's reminder specifies.
   **Do not push and do not open the PR** — stop and report; the owner tests, pushes, opens the PR.
5. **Tests before any commit** (CLAUDE.md rule 4). Docs-only PR 4 is the one exception.
6. **A failing pre-existing test is a finding, not a thing to fix silently.** Report the failure,
   root cause and fix plan; change the test only when this plan changed the behaviour it asserts.
7. **Never run anything against staging or production from the build.** Every script here is
   dry-run by default and is executed by the owner (§7). The build verifies with
   `mongodb-memory-server` tests only. The audit package is verified by the owner's live run.
8. **Report-back per PR:** files created/modified; real suite/test counts from the runs; gates
   passed; every divergence from this plan and why; the §9 as-built note written into this file.

---

## 2. LOCKED DECISIONS

| # | Decision |
|---|---|
| D1 | **Fix the data gap at the root, as PR 1, before touching the audit.** A weekly extension keeps every schedule stocked to the same 8-occurrence horizon `generateInitialSessions` uses — the CKQ model the owner chose on 2026-09-25. It is one shared planner (`plannedSessionsFor`) used by both schedule creation and the extension, so the two can never disagree about which dates a schedule has. |
| D2 | **Sessions are generated on holiday dates**, exactly as `generateInitialSessions` does today. A holiday is an annotation + attendance guard (`attendanceAnnotations`, `assertSessionAcceptsAttendance`), not a reason for a session document not to exist. Changing that is out of scope. |
| D3 | **New sessions get scheduled Visits for every student on `schedule.students`**, via `visitService.upsertScheduledVisits(studentId, [{ sessionId, scheduleId }], 'regular')` — the same call `roster.service.js`'s `addStudentToRoster` makes. The roster array is the authority for "who is on this schedule"; `Subscription` is not re-derived here. |
| D4 | **The extension is idempotent under the existing `(scheduleId, date)` unique index** (`groupClassSession.model.js:44`). It queries existing dates first and additionally treats an `E11000` on insert as "already there", never as an error. |
| D5 | **Scheduling of the weekly run is a GitHub Actions `schedule` workflow with `workflow_dispatch`, secrets supplied by the owner.** Until the owner adds `STAGING_MONGO_URI` / `PRODUCTION_MONGO_URI` secrets the workflow is a no-op that says so (it does not fail red every Monday). Owner can instead run `npm run extend-sessions -- --live` weekly by hand; both paths run the same script. |
| D6 | **The audit gets a preflight (P0)** that runs before any scenario, uses only the staging frontend's `/api/v1/*` proxy (the audit package has no DB client and must not gain one), and reports a single `P0 Preflight` row with every reason when it fails. Scenarios are then recorded as `skip` with note "preflight failed", the run is reported to `/admin/audits` as `fail`, and the process exits 2. |
| D7 | **The audit seed owns its own sessions.** `seedAuditFixtures` ends by extending the two audit schedules through PR 1's library, so a seed always leaves S1/S2 with dates. The staging refresh calls the same lib, so a refresh can never again remove the fixtures. |
| D8 | **Selector drift becomes a CI failure**, not a live-run discovery: a frontend Jest guard extracts every label/text literal the audit uses and asserts each one still exists in the app or backend source. Fixture names (`Audit …`) are allow-listed. |
| D9 | **The live audit becomes schedulable** (`live-audit.yml`: `workflow_dispatch` + weekly `schedule`), reset-then-run, against staging only, Stripe TEST mode only, secrets owner-supplied. Default after this plan: **weekly**. This reverses `docs/plans/audit-system-plan.md` D7 ("owner-triggered only") by owner decision 2026-10-26; the skill files and `TESTING_STRATEGY.md` say so. It stays staging-only and never gates a PR. |
| D10 | **`/health` is a repo skill**, `.claude/skills/health/SKILL.md`, backed by a read-only `backend/scripts/health-check.js`. The owner retires the CKQ `~/.claude/commands/health.md` (or renames it `ckq-health`) so the names do not collide — owner action, outside this repo. |
| D11 | **Nothing in this plan changes billing behaviour, a model, a route, or a page.** PR 1 adds session documents and Visits the same way existing code does; PR 2 changes the audit package, scripts and docs; PR 3 adds read-only scripts and skills; PR 4 is docs. |

---

## 3. PR 1 — weekly group-session extension (`feature/group-session-extension`)

### 3.1 Files

| File | Change |
|---|---|
| `backend/src/services/groupClassSession.service.js` | Extract the pure planner: `plannedSessionsFor(schedule, fromSentinel, count = SESSION_COUNT)` returns `[{ scheduleId, date, startsAt, endsAt }]` for the `count` occurrences of `schedule.dayOfWeek` on/after `fromSentinel`, built with `nextDateOnlyOnOrAfter`, `addDaysToDateOnly`, `sessionInstantsFor` — the exact loop `generateInitialSessions` runs today. `generateInitialSessions(schedule)` becomes `plannedSessionsFor(schedule, todayDateOnly())`. Export `plannedSessionsFor` and `SESSION_COUNT`. Zero behaviour change for schedule creation (the route test for schedule creation must stay green untouched). |
| `backend/scripts/lib/extendGroupSessions.js` | **New.** `extendGroupSessions({ apply, today = todayDateOnly(), scheduleIds = null })`. For each `GroupClassSchedule` (filtered by `scheduleIds` when given): compute `plannedSessionsFor(schedule, today)`; load existing `GroupClassSession` dates for the schedule within `[planned[0].date, planned[last].date]`; the missing dates are the plan. When `apply`, `insertMany(missing, { ordered: false })`, catching `E11000` per D4, then for each inserted session and each `studentId` of `schedule.students` call `visitService.upsertScheduledVisits`. Returns `{ today, schedules: [{ scheduleId, classId, dayOfWeek, rosterSize, existing, planned: [dates], created: [dates], visitsUpserted }], totals: { schedules, created, visitsUpserted }, aborted: false }`. Prints nothing. |
| `backend/scripts/extend-group-sessions.js` | **New** CLI, copied in shape from `scripts/backfill-session-instants.js`: `require('dotenv/config')`, `MONGO_URI`, dry-run default, `--live`, optional `--schedule=<id>` (repeatable). Prints the per-schedule table and `No writes made — re-run with --live to apply.` on a dry run. Exit 1 on any thrown error. |
| `backend/package.json` | `"extend-sessions": "node scripts/extend-group-sessions.js"`. |
| `backend/tests/scripts/lib/extendGroupSessions.test.js` | **New** (see 3.2). |
| `backend/tests/services/groupClassSession.service.test.js` (or wherever `generateInitialSessions` is asserted today — find it with `grep -rn generateInitialSessions backend/tests`) | Add one case: `plannedSessionsFor` returns `SESSION_COUNT` dates, 7 days apart, all on `dayOfWeek`, first on/after `fromSentinel`, each with `startsAt/endsAt` equal to `sessionInstantsFor(date, schedule)`. |
| `.github/workflows/extend-sessions.yml` | **New.** `on: schedule: - cron: '0 11 * * 1'` (Monday 11:00 UTC = 5/6 am Central) + `workflow_dispatch`. One job per environment (`staging`, `production`), each: checkout, node 20, `npm ci` in `backend`, then `if [ -z "$MONGO_URI" ]; then echo "::notice::<env> MONGO_URI secret not set — skipping"; exit 0; fi`, then `npm run extend-sessions -- --live`. `env: MONGO_URI: ${{ secrets.STAGING_MONGO_URI }}` / `PRODUCTION_MONGO_URI`. `concurrency: extend-sessions-<env>`. The dry-run output of the same command is printed first in the same step so the log shows the plan and the result. |
| `docs/plans/deployment-launch-plan.md` | The "Group-session generation cron" follow-up bullet → "SHIPPED (audit-health plan PR 1): `npm run extend-sessions`, weekly via `extend-sessions.yml` once the two MONGO_URI secrets exist; one-time catch-up run on staging and production — see that plan §7." |

### 3.2 Tests (`extendGroupSessions.test.js`, in-memory Mongo, clock pinned with `testUtils/clock.js` to a literal Wednesday, e.g. `2026-10-28T15:00:00Z`)

1. A schedule with no sessions: dry run plans 8 dates and writes nothing (`countDocuments` is 0 after); live run creates exactly 8, 7 days apart, on `dayOfWeek`, `startsAt`/`endsAt` match `sessionInstantsFor`.
2. A schedule with 3 remaining future sessions and 5 past ones: live run creates exactly the 5 missing dates, touches none of the existing 8 documents (compare `updatedAt`/full docs before and after).
3. A fully stocked schedule: `created` is empty, no write, second live run is also a no-op (idempotency).
4. A concurrent duplicate: pre-insert one of the planned dates through the raw collection between planning and insert (or stub `insertMany` to throw an `E11000` for one doc) → the run completes, that date is reported as `existing`, the other dates are created.
5. Roster: a schedule with two students on `schedule.students` → every new session gets one `scheduled` Visit per student (`Visit.countDocuments` = created × 2), existing Visits untouched, a schedule with an empty roster gets no Visits. Requires the `Service` seed in the test (`seedServices` lib or a direct `Service.create` with code `group-classes`), because `upsertScheduledVisits` resolves the service id.
6. `scheduleIds` filter: two schedules, filter to one → the other is not touched.
7. A session on a holiday date is still planned and created (D2).

### 3.3 Owner rollout (after merge; commands in §7.3)

Dry run then `--live` on staging, then on production. Then add the two secrets so the Monday
workflow takes over. Verify with `health-check.js` (PR 3) or the §7.1 query that every schedule has
8 upcoming sessions.

---

## 4. PR 2 — live audit refresh (`feature/live-audit-refresh`)

### 4.1 Files

| File | Change |
|---|---|
| `audit/scenarios/s1-trial-booking.js` | Rewrite the flow against the current wizard: login → `/parent/book-trial` → `getByRole('radio', { name: /audit childone/i }).click()` → **no Continue** → `getByLabel('Level').selectOption({ label: 'Audit Level A' })` → `getByRole('radiogroup', { name: 'Select a session' }).getByRole('radio').first()` wait + click → `getByRole('button', { name: /book trial class/i }).click()` → `getByText('Trial class booked!')`. Update the header comment (it still describes a 3-step wizard with a class select). Keep the `skip` branch for an existing trial (`TrialClass` unique-per-student) — detect the backend's own conflict message by reading the alert text rather than guessing; find the exact string in `backend/src/services/trialClass.service.js` before writing it. |
| `audit/scenarios/s4-decline.js` | Comment: the decline is a **402** from `stripe.provider.js`'s `attachPaymentMethod` (`httpError(402, error.message)`), surfaced verbatim by `StripeCardForm`. Add: `if (/something went wrong/i.test(alertText)) throw new Error('Generic 5xx text shown — the 402 card-decline mapping regressed')`. Keep every existing assertion. |
| `audit/lib/preflight.js` | **New** (D6). `runPreflight(context, config)` → `{ ok, reasons: string[] }`. Steps, each adding a reason on failure and continuing: (a) `login` as `audit-parent-1@example.com` (proves the seed exists — on failure, the reason says `run npm run audit:seed in backend/`); (b) `GET /api/v1/payments/config` → 200 with a `provider` field (else "backend has no payment public config — STRIPE_PUBLISHABLE_KEY missing on the backend Preview env"); (c) `GET /api/v1/levels` and `GET /api/v1/group-classes` → both "Audit Class A" and "Audit Class B" present (ids captured); (d) `GET /api/v1/group-class-sessions/by-class/:classId` for both → at least one session each (else "no upcoming sessions for <class> — run npm run extend-sessions -- --live on staging"); (e) `GET /api/v1/registrations/preview?studentId=<ChildOne id from GET /students/mine>&scheduleId=<first session's scheduleId._id>&startDate=<first session's date>` → 200 (a 500 here is the `Service` registry not seeded — say so). All through `context.request` on the staging origin so the login cookie is sent (same reasoning as `staging-guard.js`). |
| `audit/run-registration-audit.js` | Call `runPreflight` first. On `ok: false`: build `results = [{ id: 'P0', name: 'Preflight', result: 'fail', note: reasons.join(' · ') }, ...SCENARIOS.map(s => ({ id: s.id, name: s.name, result: 'skip', note: 'preflight failed' }))]`, print, report, exit 2. Give every scenario module an exported `id` and `name` (the orchestrator today prints `'?'` for a scenario that throws outside its own try/catch — fix that while here by using the exported fields). On `ok: true` proceed unchanged. |
| `audit/lib/stripe-card.js` | Comment only: StripeCardForm (`frontend/app/components/payment/stripe/StripeCardForm.tsx`) still renders `CardElement`; the submit button is `"Save Card"` on `/parent/payment-method` and `"Add Card"` inside the register wizard. No code change unless the first live run proves otherwise. |
| `audit/README.md` | S1–S6 + P0 list; prerequisites section (seed, sessions, publishable key); the weekly workflow; pointer to this plan. |
| `backend/scripts/lib/seedAuditFixtures.js` | **New.** The body of today's `audit-seed.js` `main()` try-block, as `seedAuditFixtures({ testPassword })` returning `{ created: {...counts}, classA, classB, scheduleA, scheduleB }`, printing nothing. Adds: (1) `getServiceByCode('group-classes')` first — throw with "run npm run seed:services" if missing; (2) after the schedules exist, `extendGroupSessions({ apply: true, scheduleIds: [scheduleA._id, scheduleB._id] })` (D7); (3) **`Price` idempotency keyed on `levelId`** stays as is, but set `registrationFee: 0` on the two audit prices when creating them so S2's charge text is deterministic regardless of the academy-wide `Setting.registrationFee` (per-level fee wins — `docs/plans/per-level-registration-fee-plan.md`; confirm the field name in `backend/src/models/price.model.js` before writing). |
| `backend/scripts/audit-seed.js` | Becomes the thin CLI: env checks + staging-URI guard (unchanged) + `seedAuditFixtures` + the same console summary. |
| `backend/scripts/lib/refreshStagingData.js` + `backend/scripts/refresh-staging-data.js` | New final step "re-seed audit fixtures" calling `seedAuditFixtures({ testPassword: process.env.AUDIT_TEST_PASSWORD })`. `AUDIT_TEST_PASSWORD` joins the CLI's required env vars. The lib's report gains `auditFixtures: { … }`. |
| `backend/tests/scripts/lib/seedAuditFixtures.test.js` | **New**: creates all 5 parents / 7 students / 2 levels / 2 classes / 2 prices / 2 schedules; second run creates nothing new (counts unchanged); students are matched by role+name+parentId (the `findOne({ email: undefined })` bug the file header documents must stay fixed — assert a seeded coach is not returned as a student); throws without the `group-classes` Service; leaves both audit schedules with 8 upcoming sessions. |
| `backend/tests/scripts/lib/refreshStagingData.test.js` | Add: the refresh ends with the audit fixtures present. |
| `frontend/lib/__tests__/guards/auditSelectorGuard.test.ts` | **New** (D8, see 4.2). |
| `.github/workflows/live-audit.yml` | **New** (D9). `workflow_dispatch` + `schedule: - cron: '0 14 * * 1'` (Monday 14:00 UTC, after `extend-sessions.yml`). `concurrency: live-audit`. Steps: checkout; node 20; `npm ci` in `backend`; **skip-with-notice if `AUDIT_MONGO_URI` secret is empty**; `npm run audit:reset` (env: `AUDIT_MONGO_URI`, `STRIPE_SECRET_KEY` — the reset detaches cards through the provider); `npm ci` in `audit`; `npx playwright install --with-deps chromium`; `npm run audit:registration` (env: `AUDIT_STAGING_URL`, `AUDIT_TEST_PASSWORD`, `AUDIT_SUPERADMIN_EMAIL`, `AUDIT_SUPERADMIN_PASSWORD`); on failure upload `audit/` console log as an artifact (`tee audit-output.txt`). Exit code is the audit's own. |
| `.claude/skills/audit-live-registration/SKILL.md` | Scenario table gains P0; S1 row describes the sequential wizard; S4 row says 402 + generic-text regression check; "Run it" gains the prerequisites (seed, sessions, key) and the workflow; Notes: "weekly via `live-audit.yml` + on demand" replaces "owner-triggered only"; staging refresh re-seeds fixtures. |
| `.claude/skills/reset-audit-data/SKILL.md` | Mention the workflow runs it automatically before each scheduled audit; otherwise unchanged. |

### 4.2 `auditSelectorGuard.test.ts` — the contract

Scan `audit/scenarios/*.js` and `audit/lib/*.js` (root resolved as
`path.join(__dirname, '..', '..', '..', '..', 'audit')`; fail loudly if fewer than 20 selectors are
found). Extract:

- `getByRole('<role>', { name: <literal|regex> })`, `getByLabel(<literal>)`, `getByText(<literal|regex>)`,
  `selectOption({ label: <literal> })`.
- A **string literal** must appear verbatim (case-sensitive) in at least one file under
  `frontend/app/**/*.tsx`, `frontend/app/**/*.ts`, or `backend/src/**/*.js` (backend because the
  reason strings and error messages come from services).
- A **regex** whose source is plain words with optional `'`/`&`/spaces and the `i` flag (e.g.
  `/book trial class/i`, `/we'll automatically retry/i`, `/register & pay/i`) is searched
  case-insensitively as text. Any regex containing `^ $ | ( ) [ ] * + ? .` is listed under
  "unchecked (complex regex)" in the failure message but does not fail.
- **Allowlist** (fixture data, not app text): any literal/regex starting with `audit ` /
  `Audit ` (child names, level names, class names). Keep the allowlist to that one rule.
- Also assert the two reason strings in `calculateChargeAmount.service.js` appear in the audit
  (so a copy change there fails here, the same way it would fail S3/S5 live).
- Include the small pure-function unit cases the other guards have (`findProblems`-style), so the
  extractor itself is tested.

### 4.3 Verification the executor can do (no staging)

Gates in §1.3. Then `node --check` every file in `audit/` and `cd audit && npm ci && node -e
"require('./lib/preflight'); require('./run-registration-audit.js')"` is **not** safe (it would
start a run); instead `node -e "require('./lib/preflight')"` and `require` each scenario module to
prove they load. The real proof is the owner's live run (§7.4), which must be the first thing that
happens after merge.

---

## 5. PR 3 — `/health` skill + data health script + `/audit-tests` fixes (`feature/health-skill`)

### 5.1 Files

| File | Change |
|---|---|
| `backend/scripts/lib/healthCheck.js` | **New.** `collectHealth({ now = new Date() })`, read-only, returns `{ checks: [{ id, label, status: 'ok'|'warn'|'fail', detail }], summary }`. Checks: **sessions** — per schedule the count of sessions with `startsAt > now`; `fail` if any schedule has 0, `warn` if any has < 4 (half the horizon); **services** — the 4 codes `group-classes`, `private-lessons`, `camps`, `meets` exist and the first two are active; **legacy payment fields** — 0 docs with `stripePaymentIntentId` (registrations), `stripePaymentMethodId` (paymentmethods), `stripeCustomerId` (users); **payment methods on an inactive provider** — count of `PaymentMethod.provider !== getPaymentProvider().name` (`warn`); **stuck pending ledger rows** — `Registration.status === 'pending'` with `createdAt < now - 24h` (`fail` if any; these are what `recoverStalePending` should have cleared); **dunning** — active subscriptions with `retryCount >= 3` (`warn`); **duplicate active subscriptions** — reuse `scripts/lib/findDuplicateActiveSubscriptions.js` (`fail` if any); **orphaned references** — reuse `scripts/lib/findOrphanedReferences.js` (`fail` if any); **audit fixtures** — 5 audit parents, 7 audit students, 2 audit classes present (`warn` when absent — production legitimately has none, so the CLI flag `--expect-audit-fixtures` turns it into `fail` for staging only); **last audit run** — newest `AuditRun.createdAt`; `warn` > 14 days, `fail` if never or last `overall === 'fail'`. |
| `backend/scripts/health-check.js` | **New** CLI. `--env staging` reads `AUDIT_MONGO_URI` (the URI must contain `friscofencing-staging`, same guard as `audit-reset.js`) and sets `--expect-audit-fixtures`; `--env production` reads `MONGO_URI` from `.env.production.local` via `dotenv` `path` (never prints the URI). Prints one line per check with ✅/⚠️/❌ and exits 1 on any `fail`. Read-only: no model `save/create/update/delete` anywhere in the lib (assert that in the test by spying on `mongoose.Model.prototype.save` and `Model.updateOne/deleteMany/create` — none called). |
| `backend/package.json` | `"health": "node scripts/health-check.js"`. |
| `backend/tests/scripts/lib/healthCheck.test.js` | **New**: each check's ok/warn/fail branch with seeded data; the read-only spy; the audit-fixture flag. Clock pinned. |
| `.claude/skills/health/SKILL.md` | **New.** Frontmatter `name: health`, `description: Frisco repository + environment health check — git/branch state, CI, branch protection, last E2E and live-audit run, staging data health. Read-only.` Steps, run in order, no questions: (1) `git fetch origin`; (2) current branch, dirty tree, unpushed/unpulled; (3) `develop` vs `origin/develop` (local ahead = direct commits, flag); (4) `git log origin/main..origin/develop --oneline` gap; (5) `gh pr list`; (6) `gh run list --workflow=ci.yml --branch develop --limit 3` + `gh run view <id> --json jobs` → per-job conclusion for the newest; (7) branch protection: `gh api repos/friscofencingacademy-cmd/friscofencing/branches/{develop,main}/protection --jq '.required_status_checks.contexts'` → expect `["ci-passed"]` on both, flag otherwise; (8) last `live-audit.yml` and `extend-sessions.yml` runs (`gh run list --workflow=…  --limit 1`), flag > 14 days or never; (9) `cd backend && npm run health -- --env staging` (print verbatim); (10) production: print the exact command for the owner to run (`npm run health -- --env production`) and, if the skill is running on the owner's machine with `.env.production.local` present, run it. Output block in the CKQ `/status` style, ending with ACTION ITEMS or `✅ All healthy`. The skill never writes, never runs tests, never touches a feature branch. |
| `.claude/skills/audit-tests/SKILL.md` | T1: Step 3.3 pattern `^(Re-)?[Mm]easured (\d{4}-\d{2}-\d{2})`. T2: Check 13 baseline restated from a fresh `node scripts/dead-negative-assertions.mjs --frontend frontend` run, dated. T3: Step 1.2 adds `find "$WORKSPACE/audit/scenarios" -name '*.js' | wc -l` with the one-line note from §0.2. Phase 1 "Where the tests live" gains `backend/tests/scripts/lib/`. |
| `frontend/app/admin/audits/page.tsx` + its test (optional, only if cheap) | A `warn` chip "Stale — last run N days ago" when the newest run is older than 14 days. Skip if it needs more than a dozen lines; note the decision in §9. |

### 5.2 Owner action recorded by this PR

Rename or delete `~/.claude/commands/health.md` (CKQ's). Not a repo file; the PR description
repeats this.

---

## 6. PR 4 — docs close-out + the CI gate (`docs/audit-health-close-out`)

Docs-only commit (no tests). Every statement must match what PRs 1–3 actually built (read their §9
notes first).

| File | Change |
|---|---|
| `docs/TESTING_STRATEGY.md` "Live audits" | Prerequisites (seed → sessions → publishable key, checked by P0); "Not CI-gated, no cron" → "Weekly `live-audit.yml` + on demand; never gates a PR; staging only"; the selector guard as the compile-time link between `audit/` and the app; the health script. The "Available scripts" table gains P0 and the preflight reasons. |
| `docs/TEST_COVERAGE.md` | New suites from PRs 1–3 with real counts; a "Live audit" line stating the last real run date and result (the owner's §7.4 run); `/audit-tests` baseline line updated. |
| `docs/features/admin.md` "Audits" | P0 row; stale chip if built; the workflow as the second writer of `AuditRun` rows (still through `POST /audit-runs`, never direct). |
| `docs/plans/deployment-launch-plan.md` | Cron bullet already updated in PR 1; add the two new GitHub secrets groups to the env-var tables; add the weekly workflows to the "after go-live" checklist. |
| `docs/plans/audit-skills-refresh-plan.md` + `docs/plans/audit-system-plan.md` | One-line addendum each pointing here (D9 reverses audit-system D7). |
| `CLAUDE.md` | Documentation Map: a new top row for this plan with status; Pre-read table: "Touch `audit/**`, `backend/scripts/audit-*.js`, or the live-audit skill → this plan §4 + `docs/TESTING_STRATEGY.md` 'Live audits'; the `auditSelectorGuard` must stay green" and "Touch `groupClassSession.service.js`'s planner → PR 1 §3 (schedule creation and the weekly extension share `plannedSessionsFor`)". Fix the testing-refresh row's stale "Playwright 43 listed" to the real 99. |
| `CLAUDE_HISTORY.md` | One entry per PR with dates and PR numbers. |
| `docs/decisions/README.md` | No new ADR — D1–D11 are operational, not architectural. Say so here in §9 if the executor disagrees. |

**Owner gate action (same day as PR 4):** Settings → Branches → `develop` and `main` → require
status checks → exactly `ci-passed` (and remove the three individual job contexts from `main`).
Verify with the `gh api … /protection --jq '.required_status_checks.contexts'` line from the
`/health` skill.

---

## 7. OWNER RUNBOOK (commands, in order)

### 7.1 Read-only staging query used for §0 (re-run any time)

```bash
cd backend && NODE_PATH="$(pwd)/node_modules" node -e "
require('dotenv').config(); const m=require('mongoose');
m.connect(process.env.AUDIT_MONGO_URI).then(async()=>{const d=m.connection.db, now=new Date();
console.log('schedules', await d.collection('groupclassschedules').countDocuments());
console.log('upcoming sessions', await d.collection('groupclasssessions').countDocuments({date:{\$gte:now}}));
console.log('audit users', await d.collection('users').countDocuments({email:/^audit-/}));
console.log('services', await d.collection('services').countDocuments());
const r=await d.collection('auditruns').find().sort({createdAt:-1}).limit(1).toArray(); console.log('last audit', r[0]&&r[0].createdAt, r[0]&&r[0].overall);
await m.disconnect()})"
```

### 7.2 Production — the one number this plan could not verify

```bash
cd backend && NODE_PATH="$(pwd)/node_modules" node -e "
require('dotenv').config({path:'.env.production.local'}); const m=require('mongoose');
m.connect(process.env.MONGO_URI).then(async()=>{const d=m.connection.db;
console.log('PROD upcoming sessions', await d.collection('groupclasssessions').countDocuments({date:{\$gte:new Date()}}));
await m.disconnect()})"
```

If it prints `0` (expected), production parents cannot book a trial or register today. PR 1's
catch-up run (7.3) is the fix; it is safe to run on production the moment PR 1 is merged, before the
rest of this plan.

### 7.3 After PR 1 merges — catch-up, staging then production

```bash
cd backend
npm run extend-sessions                       # dry run against MONGO_URI in backend/.env (staging/local)
npm run extend-sessions -- --live
MONGO_URI="<from .env.production.local>" npm run extend-sessions           # dry run, read the plan
MONGO_URI="<from .env.production.local>" npm run extend-sessions -- --live
```

Then `gh secret set STAGING_MONGO_URI` and `gh secret set PRODUCTION_MONGO_URI` so
`extend-sessions.yml` runs every Monday. Never paste either URI into a chat or a file in the repo.

### 7.4 After PR 2 merges — the first real run

```bash
cd backend && npm run seed:services && npm run audit:seed       # idempotent; seed now also stocks the audit schedules
cd backend && npm run audit:reset                               # clean slate (detaches audit cards)
cd audit && npm install && npx playwright install chromium && npm run audit:registration
```

Expected: `P0` not printed (preflight passed silently), `S1–S6 ✓`, `Passed: 6/6`, `Reported to
/admin/audits.` Then immediately `npm run audit:reset && npm run audit:registration` again — the
reset→rerun with no Stripe idempotency collision is the standing D1 proof from the 2026-08-28 plan.
Then set the five audit secrets (`AUDIT_MONGO_URI`, `AUDIT_STAGING_URL`, `AUDIT_TEST_PASSWORD`,
`AUDIT_SUPERADMIN_EMAIL`, `AUDIT_SUPERADMIN_PASSWORD`; `STRIPE_SECRET_KEY` already exists) and run
`live-audit.yml` once by hand from the Actions tab.

If S1 fails at the Stripe iframe or any selector, the failure note names the selector — fix it in
`audit/` **and** confirm `auditSelectorGuard` would have caught it (if not, extend the guard).

### 7.5 After PR 3 merges

`/health` from the repo root. Expect every line green except what §6's owner gate still owes.

---

## 8. DEFINITION OF DONE

1. `/admin/audits` on staging shows a dated run from after PR 2 with `6/6 scenarios passed`, and a
   second run from the Monday workflow.
2. Reset → immediate rerun passes (no idempotency collision, no `skip`).
3. `npm run health -- --env staging` prints no ❌; production prints no ❌ once 7.3 has run.
4. Every schedule on staging and production has 8 upcoming sessions, and the Monday
   `extend-sessions.yml` run is green.
5. `auditSelectorGuard` is in CI and fails when an audit label is removed from the app (prove it once
   by temporarily editing a label locally, not committed).
6. `develop` and `main` both require exactly `ci-passed`.
7. `/audit-tests` Phase 3 reports the real measured date and a current Check 13 baseline.
8. CKQ's `/health` no longer answers in this repo.

---

## 9. AS-BUILT NOTES (the executor appends one block per PR)

_Each block: date, branch, PR number, files, real test counts, gates, every divergence from the
sections above with the reason._

### PR 1 — built 2026-10-26 on `feature/group-session-extension`

- **Files:** `groupClassSession.service.js` (`plannedSessionsFor` + exported `SESSION_COUNT`;
  `generateInitialSessions` now delegates — byte-identical output, proven by a test),
  `scripts/lib/extendGroupSessions.js`, `scripts/extend-group-sessions.js`, `package.json`
  (`extend-sessions`), `.github/workflows/extend-sessions.yml`, tests (below), docs
  (`deployment-launch-plan.md` follow-up, `TEST_COVERAGE.md`, `CLAUDE.md` map row, this plan).
- **Tests:** new `tests/scripts/lib/extendGroupSessions.test.js` (11 cases) + 3 `plannedSessionsFor`
  cases in `tests/services/groupClassSession.service.test.js`. Backend 93 → 94 suites /
  1,263 → 1,277 tests, all green; statements 94.16%. Frontend untouched.
- **Divergences:**
  1. D3 refined, not changed: Visits are created only for new sessions whose `startsAt` is still
     ahead of now — the same rule `roster.service.js` applies (session-start-time-cutoff D8). The
     lib takes `today` and `now` as parameters so tests pass literals and never read the clock.
  2. D4: inserts are one `create` per missing date instead of `insertMany({ ordered: false })`, so a
     duplicate-key race is isolated to its own date without relying on the driver's partial-result
     shape. At most 8 inserts per schedule — no performance cost.
  3. The workflow is one job with a `staging`/`production` matrix (same behaviour as two jobs,
     one definition).

### PR 2 — built 2026-10-26 on `feature/live-audit-refresh`

- **Files:** `audit/lib/preflight.js` (new), `audit/run-registration-audit.js`, `audit/lib/register-child.js`,
  `audit/lib/stripe-card.js` (comments), `audit/scenarios/s1…s6`, `audit/README.md`, `audit/.gitignore`;
  `backend/scripts/lib/seedAuditFixtures.js` (new), `backend/scripts/audit-seed.js`,
  `backend/scripts/audit-reset.js`, `backend/scripts/lib/refreshStagingData.js`,
  `backend/scripts/refresh-staging-data.js`; `frontend/lib/__tests__/guards/auditSelectorGuard.test.ts`
  (new); `.github/workflows/live-audit.yml` (new); both live-audit skills; docs
  (`TESTING_STRATEGY.md`, `TEST_COVERAGE.md`, `features/admin.md`, `CLAUDE.md`, addenda in the two
  older audit plans); a comment in `frontend/e2e/parent-register.spec.ts`.
- **Tests:** `seedAuditFixtures.test.js` (8), `refreshStagingData.test.js` +2 (clock now pinned),
  `auditSelectorGuard.test.ts` (9). Backend 95 suites / 1,287 tests (94.25 %); frontend 81 / 633
  (90.30 %); typecheck, build and the route-existence guard clean. The guard was proven to fail by
  renaming one S1 label locally and restoring it.
- **New findings while building (each fixed here, not worked around):**
  1. **F9 — trial booking needs a family phone and the child's date of birth**
     (`trialClass.service.js`); the old seed set neither, so S1 would have failed even after F3's
     rewrite. The seed now converges both.
  2. **F10 — S3/S5's preview check was dead.** They waited for "10% sibling discount applied",
     which the register wizard no longer renders (only the admin page does), so every run with a
     sibling would fail. The check now waits for the preview to load ("Due at enrollment"), reads
     the summary's discount note, and compares the previewed discount AMOUNT with the charged one —
     a stronger property than the old visibility-only check.
  3. **F11 — the stale-registration `skip` was dead.** S2/S3/S5/S6 looked for "already registered",
     which nothing renders; the wizard now blocks an enrolled child with "is already enrolled".
     All four now detect that notice.
- **Divergences:**
  1. The seed is **convergent**, not create-only: audit-owned records are brought to their declared
     state on every run (password, phone, date of birth, price fees). Stronger than §4.1's
     "registrationFee 0 on create", and it is what makes a re-seed a repair.
  2. `audit-reset.js` derives its account lists from `AUDIT_FAMILIES` and only resets children of
     the audit parents (previously name-only), so the two scripts cannot drift and a real student
     with a matching name is never touched.
  3. The refresh refuses to start (before wiping) without `AUDIT_TEST_PASSWORD`, and seeds the
     audit fixtures after the shared staging-password step so the audit accounts keep their own
     password.
  4. The guard fails on a regex too complex to check (rather than listing it), so every audit
     selector is checkable; none needed rewriting.
  5. `TESTING_STRATEGY.md`'s live-audit rules were updated in this PR rather than PR 4, because
     this PR changes them.
