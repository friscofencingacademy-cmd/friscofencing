# UTC Date-Storage Standard — Plan

**Status:** READY TO EXECUTE (3 PRs)
**Spec'd:** 2026-08-30, against real staging + local-dev data (not assumed — every bug below was reproduced by query or by reading the exact line cited)
**Executor note:** This plan is written to be executed by a smaller model (Sonnet). Every delta names its exact file and line anchor as of 2026-08-30. If a cited line has drifted, find the same code by the quoted identifier — never guess. Where this plan says **VERIFY**, do the verification before writing code; if it fails, stop and report instead of improvising.

---

## Mandatory pre-reads (CLAUDE.md hard rules apply)

Read these BEFORE touching the corresponding area — this repeats CLAUDE.md's pre-read table on purpose so it cannot be skipped:

| PR | Read first |
|---|---|
| All three | `docs/TESTING_STRATEGY.md` — **every test rule in this plan's Testing sections is a citation of that file, and it wins over this plan if they ever disagree** |
| PR 1 (frontend) | `docs/features/parent-portal.md`, `docs/features/admin.md`, `docs/design-system.md` |
| PR 2 (backend) | `docs/decisions/001-in-house-subscription-billing.md`, `docs/modules/email.md`, `docs/plans/timezone-consistency-plan.md` (esp. D9/D10) |
| PR 3 (private classes) | `docs/features/private-class.md` |
| E2E-covered flows (PR 1 touches the register wizard + book-trial) | `docs/TESTING_STRATEGY.md` §E2E — update the matching `frontend/e2e/*.spec.ts` in the same PR |

CLAUDE.md workflow rules remain in force for the executor: feature branch per PR, tests before commit, wait for owner local testing before committing, never `git add .`/`-A`, read every file before editing it.

---

## 1. Problem — five verified bugs, one root cause

The root cause: this codebase has no **gate functions** for constructing dates, so each service hand-rolled its own math and three storage conventions now coexist. `docs/TESTING_STRATEGY.md` (§Timezone day-boundary math) already *documents* the intended convention — `GroupClassSession.date` is a "date-only sentinel: a UTC-midnight Date representing a pure calendar day" — but the code that creates those dates has never obeyed it.

Verified bugs (all reproduced 2026-08-30):

1. **Trial picker shows a Sunday class for a Mon/Wed/Fri class** (the originally reported bug). Staging's `groupclasssessions.date` values are all `T04:00:00Z` = midnight **Eastern** — created 2026-08-24→26 from the owner's Eastern-timezone dev machine by the pre-timezone-fix generator (verified by aggregate query: all 168 staging sessions, UTC hour 4). The frontend (`frontend/app/parent/book-trial/page.tsx:36-42`) formats `session.date` with `toLocaleDateString` and **no `timeZone` option** → browser-local. In a Central browser, Monday `04:00Z` is Sunday 11 PM → the "Sun" pill. Every class shifts one day back the same way.
2. **The trial-confirmation email already says the wrong day, server-side.** `backend/src/services/mail.service.js:157` renders `dateFull(session.date)`, and `backend/src/email/dates.js` formats in `America/Chicago` — Monday `04:00Z` → "Sunday". Wrong for every recipient regardless of device.
3. **Billing sentinel dates render a day early in emails, PDF invoices, and several frontend pages.** `Subscription.anchorDate`/`currentPeriodStart`/`currentPeriodEnd`/`nextBillingDate` and `Registration.periodStart`/`periodEnd` are date-only sentinels (per TESTING_STRATEGY §Timezone). `dateFull()` renders them in Chicago (`mail.service.js:339` cancel-confirmation `endDateLabel`, `:358` renewal `nextBillingDateLabel`; `invoice.service.js:88` `periodLabel`) and the frontend renders them browser-local (`parent/register/page.tsx:60`, `parent/subscriptions/page.tsx:23`, `admin/subscriptions/page.tsx:44`) — a `Sep 30` period end displays as `Sep 29` for any US viewer.
4. **Private-class session instants are stored hours wrong.** `backend/src/services/privateClassSession.service.js:45-50` `combineDateAndTime()` uses `result.setHours(hours, minutes)` — **server-local** setHours. On Vercel (UTC servers) a "16:45" Central slot is stored as 16:45 *UTC* = 11:45 AM Central. Consequence: the attendance gate (`startDate <= now` / `startDate: { $gt: now }`, `privateClassEnrollment.service.js:214` and the session-listing windows) opens ~5–6 hours early, and that gate feeds the per-session Stripe charge pipeline.
5. **Sentinel-vs-instant comparison mismatches.** `todayAtMidnight()` returns a *real instant* (Central midnight = `05:00Z`/`06:00Z`); session/billing sentinels sit at `00:00Z`–`04:00Z`. Sites comparing the two: `groupClassSession.service.js:137` (`listUpcomingByClass` range start), `registration.service.js:97` (`resolveStartDate` past-check), `roster.service.js:28/48` via the `today` argument its callers pass (`registration.service.js:307`, `renewal.service.js:348` + `:532`, `subscription.service.js:299/302`). Today with `04:00Z` data, a same-day session is silently excluded from roster Visit creation (`04:00Z < 05:00Z`).

Production note: production sessions were most likely created through the deployed (UTC) backend pre-fix → already `00:00Z` (correct shape by accident). **Never assume this — the migration script's dry-run reports the actual distribution before anything is written (§6).**

## 2. The standard (adopted from CKQ, verified in its checkout)

CKQ's policy (`chesskqwebsite/backend/backend-2.0/src/utils/dateUtils.js` + frontend `src/utils/timezone.ts`) — every `Date` in Mongo is one of exactly two declared shapes, each with one blessed constructor ("gate") and one blessed rendering rule:

| Shape | Meaning | Construct via (gate) | Compare via | Render via |
|---|---|---|---|---|
| **Calendar-day sentinel** | A pure calendar day, no time meaning. Stored as **UTC midnight** of that day. | `dateOnlyUTC(...)` (new, §4.1) / existing `todayDateOnly()` | other sentinels only (`todayDateOnly()`), never a real instant | `timeZone: 'UTC'` — deterministic for every viewer |
| **Real instant** | An actual moment in time. Stored as the true UTC instant. | `combineDayAndTimeInTZ(day, 'HH:mm', tz)` → UTC (new, §4.1) | real instants (`new Date()`, `todayAtMidnight()`) | `timeZone: 'America/Chicago'` (DEFAULT_TIMEZONE), never browser-local |

Never mix shapes in a comparison, never construct either shape with raw `setHours`/`setDate` on a real instant, never render either shape browser-locally. TESTING_STRATEGY §Timezone already states the sentinel-arithmetic side of this (moment.utc for sentinels, tz-aware for instants) — this plan makes the construction and rendering sides real.

### Field inventory (goes into DATABASE_SCHEMA_DOCUMENTATION.md in PR 2)

| Field | Shape | Current state |
|---|---|---|
| `GroupClassSession.date` | sentinel | **corrupted**: `04:00Z` (staging/local-dev), `05:00Z` from the post-2026-08-28 generator; migrate + fix generator (PR 2) |
| `Subscription.anchorDate`, `currentPeriodStart`, `currentPeriodEnd`, `nextBillingDate` | sentinel | shape-correct when built from `todayDateOnly()`/`'YYYY-MM-DD'`, **contaminated to `04:00Z`** when seeded from a session date via `resolveStartDate` (the sentinel time-of-day then propagates through `addOneMonth`'s calendar math); migrate (PR 2) |
| `Registration.periodStart`, `periodEnd` | sentinel | same contamination path; migrate (PR 2) |
| `User.dateOfBirth` | sentinel | inventory only — no code change in this plan |
| `Subscription.nextRetryAt` | real instant (Central midnight, via `addOneDay(todayAtMidnight())`) | correct; no change |
| `PrivateClassSession.startDate`/`endDate` | real instant | **wrong instants** (server-local `setHours`); fix + migrate (PR 3) |
| `CoachContract.effectiveFrom` | **VERIFY** in PR 1 before choosing its formatter (read the model + how admin creates it; a `'YYYY-MM-DD'`-parsed value is a sentinel) | — |
| `createdAt`/`updatedAt`, `Visit` timestamps | real instant | correct; render-side only |

### What this plan deliberately does NOT touch

- **Billing computation.** Zero changes to charge amounts, proration, renewal/retry sequencing, or any `renewal.service.js`/`chargeFinalization` logic. The renewal cron's `nextBillingDate: { $lte: todayAtMidnight() }` (`renewal.service.js:630`, `:674`) compares sentinel ≤ Central-instant — reviewed: safe in that direction both before and after migration (a `00:00Z` sentinel for today is always ≤ `05:00Z`), so it stays as-is. Backend remains the billing source of truth (CLAUDE.md hard rule 7).
- `todayAtMidnight()`/`addOneDay()` and every existing billing-date helper — unchanged.
- `Location.timezone` wiring (still one location; DEFAULT_TIMEZONE stays the default, per timezone-consistency-plan D5).

---

## 3. PR 1 — frontend display gate (`feature/date-display-gate`)

Ships first because it is **safe against every currently-stored shape**: `00:00Z`, `04:00Z`, and `05:00Z` sentinels all fall inside the same UTC calendar day, so rendering with `timeZone: 'UTC'` shows the correct day for all of them, with or without the PR 2 migration. This alone fixes the reported Sunday-class bug for every viewer.

### 3.1 New module `frontend/lib/formatDate.ts`

The frontend's one blessed date-rendering module (CKQ's `timezone.ts` pattern). `Intl.DateTimeFormat` only — no new dependency.

```ts
// Calendar-day sentinels (UTC-midnight Dates: session dates, billing period
// dates) — rendered in UTC so every viewer sees the intended calendar day.
export function formatDateOnly(iso: string, options?: Intl.DateTimeFormatOptions): string
// defaults: { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
// callers may pass weekday/month/day/year options; timeZone is always forced to 'UTC'.

// Real instants (private-lesson start times, charge timestamps) — rendered in
// the academy's timezone, never browser-local.
export const ACADEMY_TIMEZONE = 'America/Chicago'; // mirrors backend config/timezone.js
export function formatInstant(iso: string, options?: Intl.DateTimeFormatOptions): string
// same defaults, timeZone forced to ACADEMY_TIMEZONE.
```

### 3.2 Call-site migration

For each site, the field's shape (inventory table §2) decides the function. Delete the local helper it replaces; do not leave two paths.

Sentinels → `formatDateOnly`:
- `app/parent/book-trial/page.tsx:36-42` (`formatSessionDate`) — keep the `weekday: 'short'` options
- `app/parent/register/page.tsx:60-73` — both `formatDateLabel` (periodEnd) and `formatSessionDate`
- `app/parent/register/page.tsx:83-104` start-date window math (`thisMonthWindowEnd`, `isNextCalendarMonth` and their call sites): these do **calendar math on session dates in browser-local fields** (`getMonth`, `setHours`) — same bug class. Rework to compare calendar days extracted from the sentinel with `getUTC*` getters against "today in Central" derived once via `new Date().toLocaleDateString('en-CA', { timeZone: ACADEMY_TIMEZONE })` (gives `YYYY-MM-DD`; parse its parts — do not build a local Date from it). Behavior spec is unchanged: same 14-day/this-month window, same "Enroll for next month" anchor.
- `app/admin/schedules/[id]/sessions/page.tsx:46`
- `app/coach/schedules/[id]/sessions/page.tsx:85`
- `app/parent/child/[id]/page.tsx:143` (trial `sessionId.date`)
- `app/parent/subscriptions/page.tsx:23` (`formatDate` — periodEnd/nextBillingDate at `:276-277`)
- `app/admin/subscriptions/page.tsx:44` (`formatDateLabel` — every use: `:478`, `:502`, `:709`, `:810-811`, `:855`; `nextRetryAt` at `:94` is a Central-midnight **instant** — use `formatInstant` there)

Real instants → `formatInstant`:
- `app/parent/subscriptions/page.tsx:108` (`charge.createdAt`)
- `app/private-classes/page.tsx:17` and `app/parent/register-private/page.tsx:46` (availability preview dates: Central-midnight instants from `nextOccurrenceStrictlyAfter` — already correct-day for US viewers, this hardens them)
- `app/coach/private-students/page.tsx:18` (`formatDateTime` — session `startDate`)
- `app/admin/coach-contracts/page.tsx:31` — after the §2 **VERIFY** on `effectiveFrom`'s shape

### 3.3 Testing (per `docs/TESTING_STRATEGY.md` — cited rules, not paraphrases)

- **Layers/placement**: colocated `__tests__/` updates for every touched page; new unit suite `frontend/lib/__tests__/formatDate.test.ts` (§Naming: `<name>.test.ts` for a lib module). One `describe` per subject; a nested `describe` naming this regression (e.g. `session date rendering — timezone off-by-one regression (bug fix)`), per §Naming's git-blame rule.
- **The regression test that proves the fix**: format a `T04:00:00Z` Monday sentinel and assert "Mon" — then assert the same under a spoofed non-UTC environment. Since suites run `TZ=UTC` (§Date rules), add one case constructing the formatter output for an explicit `04:00Z`/`05:00Z`/`00:00Z` triple and asserting all three render the same calendar day — that is the invariant browser-local rendering violated.
- **Date rules**: freeze the clock (`jest.useFakeTimers({ now })`) for the register-wizard window tests — it computes against "today" (§Date rules bullet 1). Fixture instants midday-UTC for real-instant fixtures; sentinel fixtures stay `new Date('YYYY-MM-DD')`-shaped ISO strings. No time-bomb dates. Run `TZ=UTC npm test`.
- **Mocking**: MSW at the network boundary only; no service-module mocks; assert rendered output, never "mock was called".
- **Typed fixtures**: every fixture satisfies `frontend/lib/types.ts` — no `any`.
- **Interaction**: `userEvent.setup()` for any new interaction test.
- **E2E (same PR, CLAUDE.md pre-read trigger)**: `frontend/e2e/parent-register.spec.ts` pins the clock via `page.clock` and asserts date-pill labels — re-verify/update its expected labels under the new UTC-anchored formatting. Check `coach-attendance.spec.ts` for any date-label assertion on the sessions list. Mock fixture dates in `e2e/fixtures/mock-api.ts` should use clean `00:00Z` sentinels.
- `tsc --noEmit` clean; full frontend suite + E2E green before handing to owner.

---

## 4. PR 2 — backend gates, sentinel normalization, migration (`feature/utc-date-standard-backend`)

### 4.1 New module `backend/src/utils/dateShapes.js`

The backend construction gates (kept out of `billingDates.js`, which is billing-scoped by its own docblock; same precedent as `config/timezone.js`). All sentinel math is UTC-getter/`moment.utc` math — zero DST exposure by construction (TESTING_STRATEGY §Timezone: "Do not wrap sentinels in `moment(date).tz(tz)`").

```js
const moment = require('moment-timezone');
const { DEFAULT_TIMEZONE } = require('../config/timezone');

// 'YYYY-MM-DD' | Date -> UTC-midnight sentinel of that (UTC) calendar day.
// The ONLY way application code may construct/normalize a calendar-day sentinel.
function dateOnlyUTC(value) { /* new Date(Date.UTC(y, m-1, d)) from the value's UTC parts */ }

// sentinel + n days -> sentinel (setUTCDate — plain calendar arithmetic).
function addDaysToDateOnly(sentinel, days) {}

// First sentinel on/after `fromSentinel` whose calendar weekday (getUTCDay,
// 0=Sun..6=Sat) is `dayOfWeek`. Sentinel-in, sentinel-out.
function nextDateOnlyOnOrAfter(fromSentinel, dayOfWeek) {}

// 'YYYY-MM-DD' + 'HH:mm' wall-clock at `tz` -> true UTC instant.
// CKQ's combineDateTimeInTZ + convertTZtoUTC, fused. The ONLY way to build a
// stored real instant from human wall-clock input. Used by PR 3.
function combineDayAndTimeInTZ(dayStr, hhmm, tz = DEFAULT_TIMEZONE) {
  return moment.tz(`${dayStr} ${hhmm}`, 'YYYY-MM-DD HH:mm', tz).toDate();
}
```

### 4.2 Group-session generation → sentinels

`backend/src/services/groupClassSession.service.js`:
- `generateInitialSessions` (`:66-79`): `firstDate = nextDateOnlyOnOrAfter(todayDateOnly(), schedule.dayOfWeek)`; step weeks with `addDaysToDateOnly(firstDate, i * 7)`. Delete the now-unused local `nextOccurrenceOnOrAfter` (`:47-52`) if nothing else imports it (**VERIFY** with grep first).
- `listUpcomingByClass` (`:130-154`): `rangeStart = todayDateOnly()`; `rangeEnd = addDaysToDateOnly(rangeStart, days)`. This closes the today's-session exclusion (bug 5) and replaces the hand-rolled `setDate` range end.

`backend/src/services/registration.service.js` `resolveStartDate` (`:86-108`):
- normalize first: `const parsed = dateOnlyUTC(new Date(startDate))` (after the NaN check) — makes the exact-match `findOne({ scheduleId, date: parsed })` robust even if a stale client echoes an old-shape ISO;
- past-check becomes sentinel-vs-sentinel: `if (parsed < todayDateOnly())`.

Roster call sites — pass a sentinel for the session-date `$gte` (bug 5), **without touching the surrounding billing math**: at `registration.service.js:307`, `renewal.service.js:348` and `:532`, `subscription.service.js:299/302`, the roster-call argument becomes `todayDateOnly()`. At `:348`/`:299` the existing `today` variable (`todayAtMidnight()`, lines `renewal.service.js:328` / `subscription.service.js:286`) is also used for billing — **leave those uses alone**; only the argument handed to `addStudentToRoster`/`removeStudentFromRoster` changes. Update `roster.service.js`'s docblock to say `today` is a calendar-day sentinel.

### 4.3 Email + invoice formatters (bugs 2 & 3)

`backend/src/email/dates.js`: add `dateOnlyFull(date)` — same options as `dateFull` but `timeZone: 'UTC'`, with a docblock stating the sentinel/instant contract and pointing at `dateShapes.js`. `dateFull` keeps Chicago and is now documented as instants-only.

Call-site changes (shape-driven, from the §2 inventory):
- `mail.service.js:157` (trial `whenLabel`), `:339` (`endDateLabel`), `:358` (`nextBillingDateLabel`) → `dateOnlyFull`
- `mail.service.js:317` (`nextRetryDateLabel` — instant), `:413`/`:446`/`:471` (private-session instants) → stay `dateFull`
- `invoice.service.js:88` (`periodLabel` sentinels) → `dateOnlyFull`; `:99` (session `startDate` instant), `:187`/`:213` (`invoiceDate` instant) → stay `dateFull`

**VERIFY** each of these six mail.service fields against what its caller actually passes (grep the send-function's call sites) before switching — the shape column in §2, not this list, is the authority.

### 4.4 Migration script `backend/scripts/normalize-date-sentinels.js`

Table-driven over the sentinel fields from §2's inventory: `GroupClassSession.date`; `Subscription.anchorDate/currentPeriodStart/currentPeriodEnd/nextBillingDate`; `Registration.periodStart/periodEnd`. Explicitly NOT: `nextRetryAt`, `PrivateClassSession.*` (PR 3), timestamps.

Rules (mirror `find-orphaned-references.js`'s read-only-by-default ethos):
- **Dry-run by default** — prints, per collection+field, the UTC-hour distribution and the would-change count. `--apply` writes.
- A value changes only if its UTC time-of-day ≠ `00:00:00.000`; new value = `dateOnlyUTC(value)` (truncate to its own UTC calendar day — correct for every US-west-of-UTC-created shape: `04:00Z` Eastern, `05:00Z`/`06:00Z` Central).
- **Safety abort**: any value with UTC hour > 12 (would mean east-of-UTC creation, where truncation lands on the wrong day) → report and exit non-zero without writing anything, even under `--apply`.
- **Collision pre-check**: before writing, detect whether any normalization would collide with an existing row under a unique index (the ledger dedup index on Registration; `GroupClassSession`'s per-schedule dates) — report and skip that document, never crash mid-write.
- Idempotent — second run reports zero changes.
- Extract the per-value decision (`normalizeSentinelValue(date) -> { action: 'keep'|'truncate'|'abort' }`) into `dateShapes.js` so it is unit-testable; the script stays a thin runner.

### 4.5 Testing (per `docs/TESTING_STRATEGY.md`)

- **Unit** (`backend/tests/utils/dateShapes.test.js`): every gate function. Include the **"prove the fix" DST pattern** from `tests/utils/billingDates.test.js` (§Timezone): generate 8 weekly sentinels starting late Oct 2026 across the Nov 1 2026 fall-back transition and assert every one is exactly UTC midnight and the same `getUTCDay()` — then a contrast assertion documenting what Central-instant `setDate` stepping would have produced (`06:00Z` drift). Also `normalizeSentinelValue` including the hour>12 abort.
- **Service** (`mongodb-memory-server`, §Layers; `afterEach` `clearTestDB()`, §Isolation): `groupClassSession.service.test.js` — generator emits UTC-midnight sentinels; `listUpcomingByClass` **includes a session dated today** (freeze clock per §Date rules — this is the same-day regression class the book-trial suite already names) and excludes yesterday's; works against legacy `04:00Z` rows too (seed one directly — the migration hasn't run in the test DB, and the range query must still catch it: `$gte` a `00:00Z` sentinel does).
- **Route-integration**: existing `registration.routes.test.js` has a pre-existing, independently-verified 14-test failure block (real-Stripe proration near month-end — documented in CLAUDE.md). **Do not touch it, do not "fix" it** (hard rule 6); assert your changes add zero new failures against the same baseline, re-verified via `git stash` if unclear.
- **Mail** (`mail.service.test.js`): trial `whenLabel`, cancel `endDateLabel`, renewal `nextBillingDateLabel` each render the correct weekday/day for a `T04:00:00Z`-shaped legacy sentinel AND a clean `00:00Z` one — the exact regression of bugs 2–3. Fixtures: sentinel fields use date-only shapes, instant fields use midday-UTC (§Date rules bullet 2).
- **Date rules**: fake timers wherever the subject computes "today" (`resolveStartDate`, `listUpcomingByClass`); no time-bombs; `TZ=UTC npm test` green.
- **What NOT to test** (§): don't re-test moment-timezone's own tz math — test our gates' contracts.

---

## 5. PR 3 — private-class real instants (`feature/private-session-instants`)

### 5.1 Fix construction (bug 4)

`backend/src/services/privateClassSession.service.js`:
- Delete `combineDateAndTime` (`:45-50`).
- In `generateSessions` (`:58+`) and the `scheduleFirstSessionDate` path (`:127`): derive each occurrence's **calendar day in Central** and gate through `combineDayAndTimeInTZ`:
  ```js
  const firstDay = moment.tz(nextOccurrenceStrictlyAfter(today, schedule.dayOfWeek), DEFAULT_TIMEZONE);
  // per occurrence i: DST-safe day stepping INSIDE the tz-anchored chain —
  // never setDate/+7*24h on the instant (billingDates.js docblock, plan D9 class)
  const dayStr = firstDay.clone().add(i * 7, 'days').format('YYYY-MM-DD');
  const startDate = combineDayAndTimeInTZ(dayStr, schedule.startTime); // -> true UTC instant
  const endDate = new Date(startDate.getTime() + schedule.durationMinutes * 60000);
  ```
- The idempotency dedup (`existingTimes`, `:77`) and unique `(scheduleId, startDate)` index work unchanged — but during the transition old rows hold *wrong* instants, so re-running generation before migration could double-create a week. **Order within this PR: migration script exists and is run on the target DB before/with deploy** (§6).
- The attendance/charge gates (`startDate <= now` comparisons) need **no code change** — they become correct once the stored instants are true. **VERIFY** by reading `privateClassEnrollment.service.js:174-214` and the charge-pipeline gate in `docs/features/private-class.md` before closing the PR.

### 5.2 Migration script `backend/scripts/normalize-private-session-dates.js`

Same dry-run/`--apply`/idempotency/collision-precheck contract as §4.4. Per session:
- intended calendar day = the stored `startDate`'s **UTC date parts** (correct for both wrong shapes in the wild: Eastern-machine-created `20:45Z` and Vercel-created `16:45Z` both fall on the intended UTC day — **VERIFY** this claim against the dry-run's hour distribution before `--apply`; abort if any value's UTC hour makes the day ambiguous, i.e. < 06:00 or ≥ 24:00-window edge cases the report will surface);
- recompute `startDate = combineDayAndTimeInTZ(day, schedule.startTime)` from the session's own schedule; `endDate = startDate + durationMinutes`;
- schedule missing or inactive-with-changed-`startTime` → skip + report that row, never guess;
- skip when already equal (idempotent).

### 5.3 Testing (per `docs/TESTING_STRATEGY.md`)

- `privateClassSession.service.test.js`: generated `startDate` for a `16:45` Central slot is the true UTC instant (`21:45Z` in CDT, `22:45Z` in CST — assert BOTH by freezing the clock on either side of Nov 1 2026: the DST "prove the fix" pattern); 8 occurrences are exactly 7 calendar days apart in Central wall-clock terms across the transition; dedup/unique-index idempotency still holds (re-run `generateSessions`, assert no dupes — real Mongo per §Mocking, so the unique index actually fires).
- Migration decision function unit-tested in `dateShapes.js`'s suite if any new pure logic is added; otherwise the service tests cover it via recomputation equality.
- Fixtures: midday-UTC instants; fake timers for the "strictly after today" walk; `TZ=UTC`.
- Frontend: no UI change in this PR (display was PR 1); run the frontend suite anyway to prove it.

---

## 6. Rollout & environment checklist (owner-sequenced, after each PR's owner review)

1. PR 1 → `develop` → verify on staging in a **Central-timezone browser** (or DevTools sensors tz override): Beginners (Below 10 Yrs) trial picker shows Mon/Wed/Fri, no Sunday. This works BEFORE any migration.
2. PR 2 → `develop`; run `normalize-date-sentinels.js` dry-run against staging (`AUDIT_MONGO_URI` in `backend/.env`), review the report, then `--apply`; re-run → zero. Repeat on local dev DB (`frisco-fencing-dev` — same `04:00Z` shape, verified).
3. PR 3 → `develop`; same dance with `normalize-private-session-dates.js`.
4. Production (with `main` promotion, owner approval per CLAUDE.md): **dry-run first, read the hour-distribution report** — expectation (unverified!) is sessions are already `00:00Z` and both scripts no-op; the report is the proof either way.
5. Book one throwaway trial on staging end-to-end and check the confirmation email's date label (bug 2's live verification).

## 7. Docs close-out (final PR of the batch, or folded into PR 3)

- New ADR `docs/decisions/00X-utc-date-storage-standard.md` (next free number per `docs/decisions/README.md`) — the §2 standard + gates table, CKQ provenance, and that it supersedes the timezone-consistency plan's Central-midnight *session-generation* choice ONLY (billing helpers untouched); cross-link both ways with `docs/plans/timezone-consistency-plan.md`.
- `DATABASE_SCHEMA_DOCUMENTATION.md`: add the §2 shape column to every Date field listed there.
- `docs/TESTING_STRATEGY.md` §Timezone: add one line — sentinel *construction* now goes through `dateShapes.js` gates; a test that hand-builds a sentinel any other way is wrong.
- `docs/modules/email.md`: `dateFull` vs `dateOnlyFull` contract.
- `CLAUDE.md` doc map: add this plan's row; flip status as PRs land.
- `docs/TEST_COVERAGE.md`: only if coverage is re-measured (per that doc's "real, re-run per update" rule — don't paste stale numbers).

## 8. Decision log

- **D1 — Sentinels stay date-only; sessions do NOT adopt CKQ's full start/end-instant shape.** Frisco's time-of-day lives on `schedule.startTime`; duplicating it into the session would be a larger schema change with no current consumer. CKQ needed instants for per-instant queries Frisco doesn't have.
- **D2 — UTC-midnight (not Central-midnight) sentinels.** Matches TESTING_STRATEGY's already-documented convention and `todayDateOnly()`/`anchorDate`'s existing shape; makes weekly stepping DST-proof by construction; renders deterministically with `timeZone:'UTC'`. Central-midnight *instants* (the Aug-28 generator's choice) drift to `06:00Z` after fall-back and render a day early in Chicago-anchored formatters.
- **D3 — Display fix ships before migration** (PR 1 first): UTC rendering is day-correct for all three in-the-wild shapes, so users get the fix immediately and the migration carries zero display risk.
- **D4 — Billing comparison sites left untouched** where the sentinel-vs-instant direction is provably safe (renewal cron `$lte`), per hard rule 7 and to keep this batch out of charge-path review scope. Recorded in the ADR as reviewed-safe, not overlooked.
- **D5 — Migrations are dry-run-first, table-driven, hour>12 abort, collision pre-check** — modeled on `find-orphaned-references.js`'s read-only diagnostic precedent; production state is asserted by report, never assumed.
- **D6 — `dateShapes.js` is a new module**, not an extension of `billingDates.js` (billing-scoped by docblock) nor `scheduleOccurrence.js` (real-instant semantics) — same single-purpose-module precedent as `config/timezone.js`.

## 9. Execution notes (added as each PR actually shipped, not part of the original plan)

- **PR 3's migration was deliberately never built** (contradicts §5.2's original spec) — owner decision, 2026-08-30, made after re-verifying real data state: local dev has zero `PrivateClassSession` docs, staging's 8 rows are disposable seed data reset via the existing wipe/reseed scripts rather than migrated, and production's collection is empty. Building and testing a migration for data that doesn't exist anywhere was judged premature; `scripts/lib/normalizeDateSentinels.js` (PR 2) remains a directly copyable template if real data is ever contaminated before another fix ships. See ADR 009 for the full reasoning.
- **PR 2's migration was built and tested but never run `--live` against staging or production** for the same reason — group-class staging data was likewise disposable/reset, not migrated in place.
- Real staging data confirmed the PR 3 bug's exact shape before the fix was written (not assumed): every stored `PrivateClassSession.startDate` was off by exactly the Central/UTC offset (a `startTime` of `"15:33"` stored as `T15:33:00.000Z` instead of the correct `T21:33:00.000Z`/`T22:33:00.000Z`), confirming server-local `setHours()` on a UTC production server was the exact mechanism.
- One doc drift found and fixed during PR 3, unrelated to the bug itself: `docs/features/private-class.md` incorrectly described `scheduleOccurrence.js`'s `nextOccurrenceStrictlyAfter` as server-local-only — it was already fixed to real IANA math by the timezone-consistency plan; the doc just never caught up. Corrected in PR 3.
