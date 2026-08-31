# Holiday Blocking Plan

**Status:** READY TO EXECUTE — not started.
**Goal:** Port CKQ's Holiday feature, simplified for Frisco. Admin/superadmin manage holidays;
parents can never book a trial or pick a registration start date on a holiday; coaches (and admins)
cannot take attendance on a holiday. **No billing impact whatsoever** — unlike CKQ, holidays here do
NOT change the monthly fee, proration, or renewal math (explicit owner decision). Billing code is
untouched by this plan.

**CKQ reference (read-only, for the builder's orientation — do not copy blindly):**
- `C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\models\holiday.model.js`
- `C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\services\holiday.service.js`
- `C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\routes\v1\holiday.routes.js`
- Session filtering: `backend-2.0\src\services\groupClassSession.service.js` (lines ~50–120, ~1263–1307)

**Builder pre-reads (mandatory, per CLAUDE.md):** `docs/features/admin.md` (Pattern A),
`docs/TESTING_STRATEGY.md` (before any test — including its E2E section: this plan touches the admin
nav and the attendance page, so `frontend/e2e/admin-shell.spec.ts` and possibly
`frontend/e2e/coach-attendance.spec.ts` must be updated in the same PR), `docs/design-system.md`
(new admin page), `DATABASE_SCHEMA_DOCUMENTATION.md` (new collection),
`docs/plans/utc-date-standard-plan.md` background via `backend/src/utils/dateShapes.js`'s docblock.

---

## §0 Decisions — deliberate simplifications vs CKQ

| # | Decision | Why |
|---|---|---|
| D1 | **No `scope`/`locations` fields.** A holiday is academy-wide. | Frisco has one location and no online classes. CKQ's scope machinery (and its `migrate-holiday-scope.js` history) exists because CKQ has both. Re-add later only if a second location materializes. |
| D2 | **No `isMakeUpAllowed`, no `isActive`/`isDeleted` soft-delete.** Hard delete, like every other Frisco catalog model (`Level`, `Price`, …). | `isMakeUpAllowed` only fed CKQ's monthly-cost calculation, which Frisco explicitly does not want. Frisco's convention is hard delete + 409 guards; nothing references a Holiday by id, so it is freely deletable (same reasoning as `Price` — see `docs/features/admin.md`). |
| D3 | **Dates are calendar-day sentinels** (`dateOnlyUTC()` UTC-midnight Dates), NOT CKQ's ET-midnight/23:59 instants. | Frisco's `GroupClassSession.date` is already a sentinel (`backend/src/utils/dateShapes.js`); a holiday range check becomes pure sentinel-vs-sentinel comparison (`date >= startDate && date <= endDate`), the exact shape `docs/plans/utc-date-standard-plan.md` mandates. Never compare against a real instant. |
| D4 | **Sessions on holiday dates stay in the DB.** Enforcement is read-time filtering + write-time guards — no generator change, no migration, no session deletion. | Sessions are generated ONCE at schedule creation (`generateInitialSessions`, 8 weeks); holidays can be created *after* sessions exist and can also be *deleted* (session should reappear). Read-time filtering handles both directions automatically with a single source of truth. This is also CKQ's actual approach. |
| D5 | **Parent-facing pickers: holiday dates simply don't appear** (server-filtered), rather than greyed out client-side. | Both the trial picker (`/parent/book-trial`) and the register wizard (`/parent/register`) consume the SAME endpoint (`listUpcomingByClass` via `fetchSessionsByClass`) — one backend filter covers both, and the codebase rule is "no client-side availability math" (see `listUpcomingByClass`'s own docblock). The owner's ask allowed either "don't see" or "greyed out"; this is the "don't see" option. |
| D6 | **Coach/admin sessions lists: holiday rows are ANNOTATED (`isHoliday` + name), rendered greyed with no attendance link** — not silently removed. | "Coach should not see that date for attendance" = cannot mark it. Removing the row entirely would make admins hunt for a missing week; a greyed "Holiday — Winter Break" row explains itself. The hard guarantee is the backend `markAttendance` 400 (D7), not the UI. |
| D7 | **Defense in depth on every write path**: `markAttendance`, trial `create`, and registration `resolveStartDate` each independently reject holiday dates with a 400. | UI filtering alone is bypassable via direct API calls / stale open tabs. Matches the repo's standing pattern (frontend hides, backend enforces). |
| D8 | **Private-class sessions are OUT OF SCOPE.** | Owner asked for trial / registration start / group attendance only. Private lessons are individually scheduled with a parent-picked slot; if wanted later, the same `holiday.service` helper drops into `privateClassSession` generation/marking. Note the gap in the plan close-out docs. |
| D9 | Validation kept: `endDate >= startDate`, unique `name`, overlap check against existing holidays, and a 31-day duration cap (typo guard — CKQ used 15; Frisco allows a full month max). Single-day holiday = same start and end date. | CKQ's overlap/duration checks caught real admin mistakes; cheap to keep. Cap loosened since Frisco has no cost-calc reason to bound it tightly. |
| D10 | Route gate: `requireRole('admin', 'superadmin')` on ALL `/holidays` routes (list included). | Owner requirement #1. Coaches/parents never query holidays directly — they only see their effects through already-gated session endpoints. Same shape as `level.routes.js` mutations. |

---

## §1 Backend — PR 1 (`feature/holiday-blocking-backend`)

### 1.1 Model — `backend/src/models/holiday.model.js` (new)

Follow `level.model.js`'s minimal style:

```js
const holidaySchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    // Calendar-day sentinels (dateShapes.js) — inclusive range. A one-day
    // holiday has startDate === endDate. Never a real instant.
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  { timestamps: true }
);

holidaySchema.index({ startDate: 1, endDate: 1 });
```

Skip CKQ's four extra indexes — they exist for its `isActive`/`isDeleted`/`scope` filters (D1/D2).

### 1.2 Service — `backend/src/services/holiday.service.js` (new)

CRUD (`create`, `list`, `getById`, `update`, `remove`) in the local error-helper style
(`notFoundError`/`badRequestError`/`conflictError` — copy the pattern from
`trialClass.service.js`), **plus the two consumer helpers everything else imports**:

- `create(data)` / `update(id, data)`:
  - Accept `startDate`/`endDate` as `'YYYY-MM-DD'` strings (or anything `new Date()` parses);
    normalize BOTH through `dateOnlyUTC()` immediately — the only sanctioned sentinel constructor.
  - Validate: parseable dates (400), `endDate >= startDate` (400), duration ≤ 31 days (400 — plain
    sentinel arithmetic: `(end - start) / 86400000 <= 30`, no moment needed), unique name
    pre-check (409, two-layer pattern like `price.service.js`'s `assertNoExistingPrice`),
    overlap with any existing holiday (409, listing the conflicting names — exclude self on
    update). Overlap query, sentinel-simple:
    `Holiday.find({ startDate: { $lte: end }, endDate: { $gte: start } })`.
- `list()`: all holidays sorted `{ startDate: 1 }`. No pagination — academy scale (CKQ's
  future/past split + pagination is over-engineering here; the admin page can visually separate
  past rows client-side if desired, but that is cosmetic and optional).
- `remove(id)`: hard delete, 404 if missing. No guard needed (nothing references holidays).
- **`getHolidaysInRange(startSentinel, endSentinel)`** — the one query consumers use:
  `Holiday.find({ startDate: { $lte: endSentinel }, endDate: { $gte: startSentinel } }).lean()`.
- **`findHolidayForDate(dateSentinel, holidays?)`** — returns the covering holiday doc or `null`;
  accepts an optional pre-fetched array so list-filtering does ONE DB call, not one per session:
  `holidays.find((h) => dateSentinel >= h.startDate && dateSentinel <= h.endDate) ?? null`.
  (Sentinel Dates compare correctly with `>=`/`<=` since both are UTC-midnight.)

### 1.3 Controller + routes — `backend/src/controllers/holiday.controller.js`, `backend/src/routes/holiday.routes.js` (new)

Mirror `level.controller.js`/`level.routes.js` exactly. All five routes gated
`requireAuth, requireRole('admin', 'superadmin')` (D10). Mount in `backend/src/app.js`:
`app.use('/api/v1/holidays', holidayRoutes);` (alongside line 84's settings mount).

### 1.4 Enforcement point 1 — parent pickers (trial + registration start dates)

`backend/src/services/groupClassSession.service.js` → `listUpcomingByClass()` (line 120):
after the existing `GroupClassSession.find(...)`, fetch
`getHolidaysInRange(rangeStart, rangeEnd)` once and filter out any session where
`findHolidayForDate(session.date, holidays)` hits. This single change blocks holiday dates in
**both** the trial picker (`/parent/book-trial`) and the register wizard's start-date picker /
"Enroll for next month" anchor (`/parent/register`) — both consume this endpoint via
`fetchSessionsByClass` (`frontend/lib/services/scheduling.ts:68`). The wizard's month-window split
(register `page.tsx:248–259`) derives purely from the returned sessions, so it needs no change.

### 1.5 Enforcement point 2 — registration start-date guard (defense in depth, D7)

`backend/src/services/registration.service.js` → `resolveStartDate()` (line 95): after the
session-exists lookup succeeds, reject if the date is a holiday:
`400 'startDate falls on an academy holiday'`. This covers `create()` AND `previewChargeAmount()`
(both call `resolveStartDate`). Note: when `startDate` is omitted the anchor falls back to
`todayDateOnly()` *for billing* — that is a billing anchor, not a class date, and holidays have no
billing meaning here (§0 header); do NOT guard the fallback.

### 1.6 Enforcement point 3 — trial booking guard (D7)

`backend/src/services/trialClass.service.js` → `create()` (after the session-exists check at
line 87): reject if `session.date` is a holiday — `400 'This session falls on an academy holiday'`.

### 1.7 Enforcement point 4 — attendance

`backend/src/services/groupClassSession.service.js`:
- `markAttendance()` (line 179): after the session lookup, reject holiday dates —
  `400 'Attendance cannot be marked on an academy holiday'` — BEFORE any Visit writes. This also
  transitively blocks `addStudentToSession`? **No — it does not**: `addStudentToSession` calls
  `visitService.markAttendance` directly, not this function. Add the same guard there (line 339,
  after its own session lookup) and, for symmetry, in `removeStudentFromSession` it is NOT needed
  (removing a mistaken record on a holiday session is harmless cleanup — leave it unguarded).
- `listBySchedule()` (line 104): annotate rather than filter (D6) — fetch holidays covering the
  schedule's session date span (min/max of the fetched sessions, one `getHolidaysInRange` call) and
  return each session with `isHoliday: boolean` and `holidayName: string | null` merged into the
  plain object (`attachRosterToSessions` already converts to POJOs — add the fields there or just
  after). Additive fields — existing consumers/tests that don't know them ignore them.
- `getById()` (line 142): add the same `isHoliday`/`holidayName` fields so the attendance page can
  render its blocked state without a second fetch.

### 1.8 Backend tests (write BEFORE committing, per CLAUDE.md rule 4)

Follow `docs/TESTING_STRATEGY.md`, especially its Date rules: build every holiday/session fixture
date through the `dateShapes.js` gate (`dateOnlyUTC('2026-12-25')` / `new Date('2026-12-25')` —
UTC-midnight sentinels; the midday-UTC fixture rule applies to real *instants*, not to date-only
sentinels, which are midnight by definition), use fixed literal dates (no `now + N days`
time-bombs), freeze the clock with `jest.useFakeTimers` for anything flowing through
`todayDateOnly()` (`listUpcomingByClass`, `resolveStartDate`), and run under `TZ=UTC`. Real
ephemeral Mongo via `mongodb-memory-server`, never `jest.mock('../models/...')`; `afterEach`
calls `clearTestDB()`. New + extended files:
- `backend/tests/services/holiday.service.test.js` (new): CRUD happy paths; `'YYYY-MM-DD'`
  normalization produces exact UTC-midnight sentinels; end-before-start 400; >31-day 400;
  duplicate-name 409; overlap 409 (incl. exact-boundary touch: existing ends on X, new starts on X
  → overlaps, since the range is inclusive); update excludes self from overlap; `findHolidayForDate`
  inclusive at both boundaries; hard delete.
- `backend/tests/routes/holiday.routes.test.js` (new): all five routes 403 for parent/coach,
  200/201 for admin AND superadmin; 401 unauthenticated.
- `backend/tests/services/groupClassSession.service.test.js` (extend): `listUpcomingByClass` drops
  a session inside a holiday range and keeps its neighbors; deleting the holiday makes it reappear
  (just re-query); `listBySchedule` annotates `isHoliday`/`holidayName` on the covered row only.
- `backend/tests/routes/groupClassSession.routes.test.js` (extend): PATCH attendance on a
  holiday-date session → 400, and no Visit is written; POST `/students` (walk-in) → 400.
- `backend/tests/routes/registration.routes.test.js` (extend): `startDate` on a holiday → 400 for
  both preview and create. ⚠ Known pre-existing failure block in this file (14 tests,
  real-Stripe-minimum-charge near-month-end fixtures — documented in CLAUDE.md's
  manual-charge plan row). Do not touch it; verify your new tests pass and the failure count
  doesn't grow.
- `backend/tests/routes/trialClass.routes.test.js` (extend): booking a holiday-date session → 400.

---

## §2 Frontend — PR 2 (`feature/holiday-blocking-frontend`, stacked on PR 1)

### 2.1 Service — `frontend/lib/services/holidays.ts` (new)

Fetch wrappers in `catalog.ts`'s style, following the repo's **query-throws /
mutation-never-throws contract** (`docs/TESTING_STRATEGY.md` §Error-handling contract,
`docs/design-system.md`'s services-inventory row): `fetchHolidays()` lets a failed axios call
reject; `createHoliday`/`updateHoliday`/`deleteHoliday` never throw — they resolve to
`{ status: 'success', data }` or `{ status: 'error', message }`. Add the `Holiday` interface to
`frontend/lib/types.ts` (the single source of truth for domain shapes — never redeclare per-page):
`{ _id, name, startDate, endDate }` with dates as ISO strings.
Send the dialog's `<input type="date">` values as the raw `'YYYY-MM-DD'` strings — the backend
normalizes (§1.2). **Display** dates ONLY through `frontend/lib/formatDate.ts`'s sentinel-safe
formatters (never `toLocaleDateString` — the sitewide rule from `docs/plans/utc-date-standard-plan.md`).

### 2.2 Admin page — `frontend/app/admin/holidays/page.tsx` (new, Pattern A)

Copy the shape of an existing Pattern A page (Levels is the closest/simplest). Columns:
Name | Start Date | End Date | Actions (Pencil/Trash2). One create/edit dialog (name text input +
two `<input type="date">` fields; when editing, prefill the date inputs by slicing the sentinel ISO
string to `YYYY-MM-DD` — do NOT round-trip through a local-timezone Date). Delete confirm dialog,
standard optimistic row removal. Backend 400/409 messages render inline (`Alert variant="error"`),
dialog stays open. Both dialogs render through the shared `Modal` component (`size="md"` for
create/edit, `size="sm"` for the delete confirm, in-flight save/delete passed as `disableClose`) —
`Modal` IS merged to `develop` (commit `87504e8`, verified; CLAUDE.md's doc-map row saying "not yet
committed" is stale) and `docs/design-system.md`'s Pattern A section mandates it; never hand-roll
overlay markup (anti-pattern #8).

### 2.3 Nav — `frontend/app/admin/layout.tsx`

Add `{ href: '/admin/holidays', label: 'Holidays', icon: <CalendarOff size={15} /> }` to the
**Programs** section (after Schedules). Update `frontend/e2e/admin-shell.spec.ts` in the same PR
(mandatory per CLAUDE.md's pre-read table — admin nav change).

### 2.4 Sessions lists — greyed holiday rows (D6)

Both `frontend/app/admin/schedules/[id]/sessions/page.tsx` and
`frontend/app/coach/schedules/[id]/sessions/page.tsx` (they are separate pages, not shared): when a
row has `isHoliday`, render it muted (existing muted/`chipMuted` styling from the design system —
no new CSS pattern — reference tokens, never raw hex, per `docs/design-system.md`), show a
`Holiday — {holidayName}` chip in place of the student count, and do NOT render the attendance
link for that row. Add the two fields as additive optionals (`isHoliday?: boolean;
holidayName?: string | null`) to `GroupClassSession`/`GroupClassSessionDetail` in
`frontend/lib/types.ts:110/132` — no `any` (CLAUDE.md rule 8).

### 2.5 Attendance page — blocked state

`/sessions/:id/attendance` (shared admin/coach page): if the fetched session has `isHoliday`,
render an `Alert` ("This session falls on {holidayName} — attendance is disabled.") and hide/disable
the checkbox list + Save. Backend 400 (§1.7) remains the real guarantee for anyone who lands here
with stale data. E2E note: the E2E suite is fully mocked via `page.route()`
(`frontend/e2e/fixtures/mock-api.ts` — there is no seed data), and the new fields are additive
optionals, so existing mock responses stay valid and `coach-attendance.spec.ts`'s exact-PATCH-payload
assertion is unaffected; verify the suite stays green rather than editing it. Optionally add one
mocked holiday-session case to `coach-attendance.spec.ts` if cheap, but it is not required —
the jsdom test in §2.6 covers the blocked state.

### 2.6 Frontend tests

Per `docs/TESTING_STRATEGY.md`: MSW at the network boundary (never `jest.mock` a service file),
`userEvent.setup()` for interactions in NEW tests (not `fireEvent`), assert rendered results/ARIA
(never "the mock was called", never CSS class names), typed fixtures against `lib/types.ts`.

- `frontend/lib/services/__tests__/holidays.test.ts` (new): the query-throws /
  mutation-never-throws contract for each function (`await expect(fetchHolidays()).rejects...`;
  mutations resolve to `{status:'error'}` on an MSW error response).
- `frontend/app/admin/holidays/__tests__/page.test.tsx` (new): Pattern A suite — list renders,
  create dialog posts `'YYYY-MM-DD'` (assert via MSW's `await request.json()` capture), edit
  prefills, delete removes optimistically, backend 409 "shows an inline error ... without
  crashing" (the repo's standard phrasing). Mirror the Levels page test.
- Sessions pages tests (extend both admin + coach): holiday row renders muted chip and no
  attendance link; normal rows unaffected.
- Attendance page test (extend): `isHoliday` session renders the alert and no Save.
- `tsc --noEmit` clean and `next build` succeeds (both hard CI gates); full frontend suite + E2E
  green under `TZ=UTC`.

---

## §3 Docs to update (same PRs as the code they describe)

- `DATABASE_SCHEMA_DOCUMENTATION.md`: new `## Holiday — implemented` section, matching the
  existing per-model format (PR 1).
- `docs/features/admin.md`: Holidays page under Pattern A (PR 2) + the attendance/sessions holiday
  behavior in the Sessions/Attendance sections.
- `docs/design-system.md`: the Admin shell section's hardcoded `NAV_SECTIONS` list ("**Programs**
  (Classes, Levels, Schedules, Subscriptions, Private Classes, Coach Contracts)") gains Holidays
  (PR 2).
- `docs/features/parent-portal.md`: one line in the trial/register flow notes — holiday dates are
  server-filtered out of the pickers.
- `CLAUDE.md` doc map: add this plan's row with status when shipping.
- `docs/TEST_COVERAGE.md`: refresh counts after suites run.

## §4 Explicitly out of scope (this plan)

- Private-class sessions/charges on holidays (D8).
- Any billing/proration/renewal interaction — holidays never change money (owner decision).
- Location-scoped or online-scoped holidays (D1).
- Makeup-class credit for holiday-cancelled sessions (CKQ's `isMakeUpAllowed`) — Frisco premium
  students can already attend any session at their level, which is the de-facto makeup mechanism.
- Auto-extending the 8-session generation window to compensate for holiday-skipped weeks — session
  docs are kept and merely masked (D4), and no rolling generator exists for group sessions today.

## §5 Suggested PR sequence

1. **PR 1 — backend** (§1): model + service + routes + all four enforcement points + tests.
   Fully shippable alone: with no holidays in the DB, behavior is byte-identical to today.
2. **PR 2 — frontend** (§2, stacked or after PR 1 merges): admin CRUD page + nav + greyed rows +
   attendance blocked state + tests + E2E updates.

Both PRs: feature branches → `develop`, explicit file staging (never `git add .`), owner tests
locally before any commit, test failures reported — never auto-fixed (CLAUDE.md hard rules).
