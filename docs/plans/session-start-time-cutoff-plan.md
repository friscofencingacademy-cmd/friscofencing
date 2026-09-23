# Session Start-Time Cutoff Plan

**Status:** PR 1 BUILT 2026-09-23 on `feature/session-start-time-cutoff` — full backend (71 suites) and frontend (418) suites green, `tsc --noEmit` clean, not yet committed, pending owner local testing. PR 2 (§3) not built. Deviations from the spec while building: no `Location`/schedule-populate changes were needed; `sessionInstantsFor` lives in `groupClassSession.service.js` (as spec'd) and the backfill uses the raw collection `bulkWrite` (the model now refuses a row without the new fields); `student.service.js` populates `'date startsAt'`. Analysed 2026-09-23 (v1: compute-on-read; **v2, this
version: store the instant, CKQ-style** — revised the same day after checking CKQ's actual model
and the calendaring industry standard, see §0.2). Builder is a separate session.

**Goal:** A group-class session that has already **started** must read as "past" everywhere the
site asks "is this session still upcoming?" — not just a session whose calendar **day** has
passed. Reported symptom: at 8 pm a parent can still book a trial / pick a registration start
date for today's 4 pm class. Owner requirement: **no quick fix** — one proper, tz-correct
representation that every "has this class started" decision uses, for the trial flow, the
registration flow, and every other call site that currently compares only the day.

**Builder pre-reads (mandatory, per CLAUDE.md):** `docs/TESTING_STRATEGY.md` (§Date rules —
sentinel/instant contract, the `freezeAt` fake-timer pattern, fixture rules),
`docs/decisions/009-utc-date-storage-standard.md` (the two-shape contract this plan extends),
`backend/src/utils/dateShapes.js` + `backend/src/utils/billingDates.js` docblocks,
`DATABASE_SCHEMA_DOCUMENTATION.md` (two new fields), `docs/features/parent-portal.md` (both
pickers), `docs/features/admin.md` (§Schedules — the deferred-edit note that §2.4 tightens),
`docs/decisions/001-in-house-subscription-billing.md` (PR 1 touches roster calls inside
`registration.service.js`/`renewal.service.js`/`subscription.service.js` — no billing logic
changes, but the read is mandatory for anything in those files). If PR 2 is built:
`docs/design-system.md` and the E2E section of `docs/TESTING_STRATEGY.md`
(`frontend/e2e/coach-attendance.spec.ts` must be updated in that PR).

**CKQ reference (read-only, orientation only):**
`C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\models\groupClassSession.model.js`
(`startDate`/`endDate` real instants), `…\src\utils\dateUtils.js` (`combineDateTimeInTZ` +
`convertTZtoUTC`, lines 73–102), `…\src\services\groupClassSession.service.js:1386`
(`startDate: { $gt: now }` — the "upcoming" query this plan adopts).

---

## §0 Root cause and the design choice

### 0.1 Root cause (verified against current source)

`GroupClassSession.date` is a **calendar-day sentinel** (UTC midnight, no time-of-day meaning —
ADR 009). The time of day lives separately on `GroupClassSchedule.startTime`/`endTime` as a
`"HH:mm"` Central wall-clock string. **Nothing in the codebase ever combines the two.** Every
"is this session upcoming?" decision is a sentinel-vs-`todayDateOnly()` comparison — a *day*
comparison by construction — so a Tuesday 16:00 session stays "upcoming" until midnight
Central on Tuesday.

Every affected call site, with what it does today:

| # | Call site | Today's check | Effect |
|---|---|---|---|
| 1 | `groupClassSession.service.js` `listUpcomingByClass` (lines 148–153) | `date: { $gte: todayDateOnly() }` | **The reported bug.** Feeds BOTH pickers through the one `GET /group-class-sessions/by-class/:classId` endpoint (`fetchSessionsByClass`): the trial picker (`/parent/book-trial`) and the register wizard's start-date picker (`/parent/register`). Today's started session is still offered. |
| 2 | `registration.service.js` `resolveStartDate` (line 109) | `parsed < todayDateOnly()` → 400 | Defense-in-depth behind #1; accepts today's started session as a start date via direct API / stale tab. |
| 3 | `trialClass.service.js` `create` (lines 88–103) | **No past-check at all** — not even day-level | A trial can be booked into *yesterday's* session via direct API. Worse than #2. |
| 4 | `roster.service.js` `addStudentToRoster` / `removeStudentFromRoster` (lines 34–37, 54–57) | `date: { $gte: today }` (caller-supplied sentinel) | Registration / schedule-change at 8 pm creates a `scheduled` Visit for today's already-finished 4 pm session; cancellation / schedule-change **cancels** today's already-marked Visit, erasing real attendance. Five call sites: `registration.service.js:343`, `renewal.service.js:481`/`:926`, `subscription.service.js:334`/`:337`, `scripts/lib/runLegacyImport.js:295`. |
| 5 | `student.service.js` `attachEnrollment` (line 126) | `sessionDoc.date >= today` → `trial_scheduled` | Child card / child detail reads "Trial class scheduled" all evening after the trial happened. |
| 6 | `groupClassSession.service.js` `markAttendance` / `addStudentToSession` | **No "has occurred" gate** (private classes have one: `privateClassSession.service.js:366`) | A coach can mark attendance for next week's session. Adjacent, not the reported bug — **PR 2, owner's call** (D9). |

**Already correct — the reference implementation:** private classes. `PrivateClassSession.startDate`/
`endDate` are real instants built by `combineDayAndTimeInTZ` at generation; every private-class
gate is instant-vs-instant (`session.startDate <= new Date()` in `markAttendance`, `listMine`'s
`upcoming`/`unmarked`/`past` windows, `privateClassEnrollment.service.js:214`).

**Verified NOT the cause:** the frontend. `register/page.tsx`'s `thisMonthSessions` filter and
`book-trial/page.tsx` do no time math — they render whatever #1 returns. Per the standing
"no client-side availability math" rule, the fix is server-side. **No frontend logic changes in
PR 1** (types gain two optional fields, §2.9).

### 0.2 Why store the instant (v2) instead of computing it on read (v1)

| | Rule (the schedule) | Occurrence (the session) | "Started?" check |
|---|---|---|---|
| **Industry standard** (RFC 5545 iCalendar, Google Calendar API, MS Graph) | Local wall-clock + IANA tz — never pre-converted, so DST/tz-rule changes resolve at expansion time | Each expanded occurrence stored as an **absolute UTC instant** | Indexable instant range query |
| **CKQ** | `dayOfWeek` + `"HH:mm"` + timezone | `startDate`/`endDate` **UTC instants**, combined at generation (`combineDateTimeInTZ` → `convertTZtoUTC`) | `startDate: { $gt: now }` |
| **Frisco private classes** | same | `startDate`/`endDate` UTC instants | `startDate <= now` ✓ |
| **Frisco group classes today** | same | `date` sentinel only, time never combined | day-vs-day ✗ (the bug) |
| **v1 of this plan** | same | `date` sentinel; instant **computed on every read** from `date` + populated `schedule.startTime` | in-memory filter after a day-range query |
| **v2 (this plan)** | same (already standard) | **`date` sentinel kept + `startsAt`/`endsAt` UTC instants added**, all written by the one generator | `startsAt: { $gt: now }` — identical to CKQ and to Frisco's own private classes |

v1 works but is the weaker long-term shape: every future time question needs a populate + an
in-memory filter, and group sessions stay inconsistent with Frisco's own private sessions.
Frisco's `GroupClassSchedule` + `Location.timezone` already *is* the standard's "rule" half; v2
completes the "occurrence" half the way the standard, CKQ, and private classes all do it.

ADR 009 moved `GroupClassSession.date` *to* a sentinel because instants once rendered as
"Sunday" for a Monday class — but that was a browser-local rendering bug, fixed in the same PR by
`formatInstant`. Storing an instant is safe when every render goes through the formatter gate,
which is now enforced. This plan keeps `date` (sentinel) because holidays, the unique index, the
register wizard's `startDate` payload, and day-grouped displays are genuinely day-granular and
already built on it; `startsAt`/`endsAt` are additive.

---

## §1 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Cutoff = the session's START instant.** "Started" ⇔ `now >= startsAt`. A started session is not bookable, not a valid start date, gets no new `scheduled` Visit, has its existing Visit left alone on removal, and reads as completed. | Owner's words: "if a class has started." `endsAt` is stored too (cheap, same generator, and what PR 2 / any future "in progress"/"ended" question needs), but no call site in PR 1 reads it. |
| D2 | **No booking lead-time buffer** in this plan. | Not asked for; later it is one constant (`now + leadMs`) on the one query. §6. |
| D3 | **Two additive fields on `GroupClassSession`: `startsAt`, `endsAt` (real UTC instants, `required: true`)**, generated alongside `date` by the existing generator via `dateShapes.js`'s `combineDayAndTimeInTZ`. `date` stays, unchanged in shape and meaning. | §0.2. Additive means no consumer of `date` changes. `required` (not optional) so a session can never be half-shaped again — the migration (§2.7) runs before the model change deploys, or the deploy runs with `required` and the migration is applied first in each environment (§2.7 sequencing). |
| D4 | **One new blessed conversion in `dateShapes.js`: `sentinelDayString(sentinel)` → `'YYYY-MM-DD'`.** The generator composes `combineDayAndTimeInTZ(sentinelDayString(date), schedule.startTime, tz)`. No new "date utils" module. | `dateShapes.js`'s docblock explicitly forbids `sentinel.toISOString()` reinterpretation and has no blessed path for sentinel→day-string. Adding the named path to the gate keeps ADR 009's "one gate per side" rule. The v1 `sessionTiming.js` module is dropped — with the instant stored there is nothing to compute on read. |
| D5 | **Timezone: the generator resolves in `DEFAULT_TIMEZONE`; `Location.timezone` is NOT wired.** The composition takes `tz` (defaulting) like every existing primitive. | Identical to `timezone-consistency-plan.md` D4 and to how private-class generation resolves today. The whole site — email `dates.js`, frontend `ACADEMY_TIMEZONE`, `todayDateOnly()` — assumes the single academy tz; wiring one write path to `Location.timezone` while rendering stays Central is less consistent, not more. §6. |
| D6 | **Schedule time edits regenerate instants.** `groupClassSchedule.service.js`'s `update()` (exposed as admin-only `PUT /group-class-schedules/:id`, accepts any field today) recomputes `startsAt`/`endsAt` for every **not-yet-started** session of that schedule when `startTime` or `endTime` changes; started sessions are left as they were (history). `dayOfWeek` changes are **rejected (400)** — they change which calendar days exist, which is a regenerate-and-re-roster operation `docs/features/admin.md` already defers. | Stored instants must never drift from the rule. The admin UI defers schedule editing, but the API does not, so the invariant has to hold at the service. Rejecting `dayOfWeek` (rather than silently ignoring or half-handling it) makes the deferral real instead of a UI-only convention. |
| D7 | **`now` is sampled ONCE per request/operation and threaded into every query** — never `new Date()` inside a loop. | A request straddling a start minute must not include a session for one query and exclude it for the next. Also what makes suites testable with the existing `freezeAt` pattern. |
| D8 | **Roster helpers stop taking a caller-supplied `today`.** `addStudentToRoster(schedule, studentId)` / `removeStudentFromRoster(schedule, studentId)` query `startsAt: { $gt: new Date() }` themselves. | The param exists only so callers pass the right *shape* — and five existing tests already pass the wrong one (`todayAtMidnight()`, the instant `roster.service.js`'s docblock forbids: `subscription.service.test.js:111`, `renewal.service.test.js:119`/`:1420`, `groupClassSchedule.routes.test.js:146`, `groupClassSession.routes.test.js:172`). Removing the param removes the class of mistake and puts "every session still ahead of us" in one place. |
| D9 | **Group-class attendance gate (row #6) is PR 2, built only if the owner says so.** | Changes coach-facing behaviour nobody reported broken; needs a frontend blocked state + E2E fixture change; severable. Recommended yes — private classes already enforce it. |
| D10 | **Error wording** — registration: `'startDate is a session that has already started'` (400); trial: `'This session has already started — choose a later date'` (400); schedule `dayOfWeek` edit: `'Changing a schedule's day is not supported — create a new schedule'` (400); PR 2: `'Attendance cannot be marked before the session starts'` (400). | Distinct from the existing `'startDate cannot be in the past'` (keep it, it fires first for a past *day*) and from the holiday messages, so a test/log can tell which guard fired. |
| D11 | **Indexes:** add `{ scheduleId: 1, startsAt: 1 }`. Keep the existing unique `{ scheduleId: 1, date: 1 }`. | Every new query is scheduleId-scoped + `startsAt` range (rows #1 via `$in`, #4, D6). `date` remains the uniqueness key (one session per schedule per day). |
| D12 | **Migration: one-shot, dry-run-first backfill script**, table-driven like `scripts/lib/normalizeDateSentinels.js`, idempotent (skips rows that already have both fields), aborts loudly on an orphaned `scheduleId`. Run on staging first, then production, **before** deploying the `required: true` model (§2.7). | Real sessions exist in production (this is a live bug report). Same proven runner/lib/test split the repo already uses for every migration. |

---

## §2 PR 1 — backend (`feature/session-start-time-cutoff`)

### 2.1 `backend/src/utils/dateShapes.js` — one addition (D4)

```js
// The ONLY sanctioned way to read a calendar-day sentinel back out as the
// 'YYYY-MM-DD' day string combineDayAndTimeInTZ accepts — a sentinel's UTC
// calendar parts ARE its meaning. Named so the docblock's "never reinterpret
// a sentinel via toISOString()" rule has an explicit, blessed exception.
function sentinelDayString(sentinel) {
  const y = sentinel.getUTCFullYear();
  const m = String(sentinel.getUTCMonth() + 1).padStart(2, '0');
  const d = String(sentinel.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
```

Export it. In the module docblock: add it to the sentinel bullet; change the
`combineDayAndTimeInTZ` warning from "never feed this a sentinel via toISOString()" to "…convert a
sentinel with `sentinelDayString` first"; update the "used by private-class session generation"
sentence to "used by both session generators."

### 2.2 `backend/src/models/groupClassSession.model.js` (D3, D11)

```js
date: { type: Date, required: true },        // unchanged — calendar-day sentinel
// Real UTC instants (docs/plans/session-start-time-cutoff-plan.md D3) —
// `date` + the schedule's "HH:mm" resolved in the academy timezone at
// generation time, the same shape PrivateClassSession.startDate/endDate
// already store. Every "has this session started / is it upcoming" query
// reads these; `date` stays the day-granular key (holidays, uniqueness,
// day-grouped display). Only groupClassSession.service.js's generator and
// groupClassSchedule.service.js's update() (D6) may write them.
startsAt: { type: Date, required: true },
endsAt: { type: Date, required: true },
```

```js
groupClassSessionSchema.index({ scheduleId: 1, date: 1 }, { unique: true }); // unchanged
groupClassSessionSchema.index({ scheduleId: 1, startsAt: 1 });
```

### 2.3 `groupClassSession.service.js` — generator + the reported bug

**`generateInitialSessions(schedule)`** — per session:

```js
const date = addDaysToDateOnly(firstDate, i * DAYS_PER_WEEK);
sessions.push({
  scheduleId: schedule._id,
  date,
  startsAt: combineDayAndTimeInTZ(sentinelDayString(date), schedule.startTime),
  endsAt: combineDayAndTimeInTZ(sentinelDayString(date), schedule.endTime),
});
```

Extract that into an exported pure helper `sessionInstantsFor(date, schedule)` →
`{ startsAt, endsAt }` so D6's `update()` and the migration (§2.7) use the identical composition
rather than each re-deriving it. Docblock: the first session may be today; if today's occurrence
has already started it is still generated (it is a real, past occurrence) — consumers filter by
`startsAt`, not the generator.

**`listUpcomingByClass(classId, days)`** (row #1):

```js
const now = new Date();
const rangeEnd = addDaysToDateOnly(todayDateOnly(), days);

const sessions = await GroupClassSession.find({
  scheduleId: { $in: scheduleIds },
  startsAt: { $gt: now },
  date: { $lte: rangeEnd },
})
  .sort({ startsAt: 1 })
  .populate('scheduleId', 'dayOfWeek startTime endTime');
```

Holiday filter unchanged (`getHolidaysInRange(todayDateOnly(), rangeEnd)` + per-session
`findHolidayForDate(session.date, …)` — day-granular, stays on `date`). Sort by `startsAt`
(also fixes §6.4's cosmetic same-day ordering for free). Rewrite the docblock: "every session
whose start instant is still ahead of `now`, through `+days` calendar days."

`listBySchedule` / `getById` are **unchanged in PR 1** — they intentionally include past
sessions. (`attachRosterToSessions` keeps using `session.date` for holidays.)

### 2.4 `groupClassSchedule.service.js` — `update()` (D6)

```js
async function update(id, data) {
  if (data.dayOfWeek !== undefined) {
    const existing = await GroupClassSchedule.findById(id);
    if (existing && existing.dayOfWeek !== data.dayOfWeek) {
      throw badRequestError("Changing a schedule's day is not supported — create a new schedule");
    }
  }
  … existing classId/coachId asserts, findByIdAndUpdate …

  const timeChanged = data.startTime !== undefined || data.endTime !== undefined;
  if (timeChanged) {
    const now = new Date();
    const upcoming = await GroupClassSession.find({ scheduleId: schedule._id, startsAt: { $gt: now } }, 'date');
    if (upcoming.length) {
      await GroupClassSession.bulkWrite(
        upcoming.map((session) => ({
          updateOne: { filter: { _id: session._id }, update: { $set: sessionInstantsFor(session.date, schedule) } },
        }))
      );
    }
  }
  return schedule;
}
```

`update()` has no `badRequestError` helper today — add one in the file's local style. Comment the
block: started sessions are deliberately left as-is (history); `docs/features/admin.md` §Schedules
gets the corresponding note (§5).

### 2.5 `registration.service.js` — `resolveStartDate` (row #2)

Keep the signature `resolveStartDate(scheduleId, startDate)`. The existing exact-match lookup
already returns the session doc, which now carries `startsAt`:

```js
const session = await GroupClassSession.findOne({ scheduleId, date: parsed });
if (!session) throw badRequestError('startDate is not an upcoming session for this schedule');
if (session.startsAt <= new Date()) {
  throw badRequestError('startDate is a session that has already started');
}
… holiday guard unchanged …
```

Keep `parsed < todayDateOnly()` → `'startDate cannot be in the past'` ahead of it (D10). The
omitted-`startDate` fallback branch is untouched. Both callers (`create` line 148,
`previewChargeAmount` line 471) are unchanged.

### 2.6 `trialClass.service.js` — `create` (row #3)

After the session-exists check, before the holiday guard:

```js
if (session.startsAt <= new Date()) {
  throw badRequestError('This session has already started — choose a later date');
}
```

Closes the day-level gap too (yesterday's `startsAt` is trivially past). No schedule lookup needed.

### 2.7 `roster.service.js` (row #4, D8)

```js
async function addStudentToRoster(schedule, studentId) {
  … roster push unchanged …
  const futureSessions = await GroupClassSession.find(
    { scheduleId: schedule._id, startsAt: { $gt: new Date() } }, '_id'
  );
  … upsertScheduledVisits unchanged …
}
```

Same for `removeStudentFromRoster`. Rewrite the docblock (the whole `today`-param paragraph goes:
state the rule "every session of this schedule that has not yet started; a started session's
Visit is history and is never created or cancelled here"). Update all five call sites to drop
the third argument and delete their now-stale "must be a sentinel, never `todayAtMidnight()`"
comments: `registration.service.js:343`, `renewal.service.js:481` + `:926`,
`subscription.service.js:334`/`:337` (its `const today = todayDateOnly()` at line 321 and comment
become unused — remove; drop the `todayDateOnly` import if nothing else in the file uses it —
check), `scripts/lib/runLegacyImport.js:295` (and its `today` local + comment, ~288–295). Every
test listed in D8 drops its third argument.

### 2.8 `student.service.js` — `attachEnrollment` (row #5)

Populate `sessionId` with `'date startsAt'` (was `'date'`). Then:

```js
const now = new Date();
…
const status = sessionDoc && sessionDoc.startsAt > now ? 'trial_scheduled' : 'trial_completed';
```

Remove `const today = todayDateOnly()` (line 91) and the sentinel comment (119–125); drop the
import if unused. Response shape unchanged.

### 2.9 Migration — `backend/scripts/backfill-session-instants.js` + `scripts/lib/backfillSessionInstants.js` (D12)

Lib (`backfillSessionInstants({ apply })`, returns a report; dry-run default):
1. `GroupClassSession.find({ $or: [{ startsAt: { $exists: false } }, { endsAt: { $exists: false } }] })`.
2. Load each row's schedule (batch by `scheduleId`). **Orphaned schedule → `abort`** with the
   docId (nothing written for any row — same all-or-nothing contract as `normalizeDateSentinels`).
3. Per row, `newValues = sessionInstantsFor(session.date, schedule)`; collect `{ docId, scheduleId, date, startsAt, endsAt }`.
4. `apply: true` → one `bulkWrite` of `$set`s. Report: scanned, wouldChange, changes[], abortReason.

Runner (`node scripts/backfill-session-instants.js [--live]`): copy
`scripts/normalize-date-sentinels.js` verbatim in structure (connect via `MONGO_URI`, print mode,
print report, `--live` applies).

**Sequencing per environment (staging, then production):** (1) deploy nothing yet; (2) run the
backfill dry-run against that env's `MONGO_URI`, read the report; (3) run `--live`; (4) merge/
deploy the PR (the `required: true` model + every query). Rows generated *after* the deploy get
their instants from the generator. If the deploy must precede the backfill for any reason, ship
`startsAt`/`endsAt` as non-required in a first commit and flip to `required` in a follow-up —
call this out in the PR description rather than silently choosing it.

Test: `tests/scripts/lib/backfillSessionInstants.test.js` — dry-run writes nothing; live fills
both fields with the exact values `sessionInstantsFor` produces (CST and CDT rows); rows already
having both fields are untouched; an orphaned schedule aborts with nothing written.

### 2.10 Frontend (types only, no logic)

`frontend/lib/types.ts`: add `startsAt?: string; endsAt?: string;` to `GroupClassSession`,
`GroupClassSessionDetail`, and `GroupClassSessionWithSchedule` (optional — the API sends them,
nothing reads them yet; PR 2 reads them). No page changes; `session.date` remains what every
picker submits and renders. Run `tsc --noEmit` + full frontend suite to prove nothing moved.

### 2.11 Tests (PR 1) — write before commit, per Hard Rule 4

All backend, `TZ=UTC npm test`. Clock: `freezeAt`/`jest.useFakeTimers({ now, doNotFake })` from
`tests/services/groupClassSession.service.test.js`. Fixtures: build sessions through
`generateInitialSessions` or through `sessionInstantsFor` — **never** hand-roll `startsAt`
(`TESTING_STRATEGY.md`). Every existing `GroupClassSession.create({ scheduleId, date })` fixture
(listed by `grep -rn "GroupClassSession.create" backend/tests`) now fails Mongoose validation
without `startsAt`/`endsAt` — add a small `tests/testUtils/sessions.js` helper
`createSession(schedule, date)` that calls `sessionInstantsFor` and use it everywhere, rather
than pasting instants into each fixture.

| File | Cases |
|---|---|
| `tests/utils/dateShapes.test.js` (extend) | `sentinelDayString`: sentinel → `'YYYY-MM-DD'`; zero-pads; round-trips with `dateOnlyUTC(new Date(str))`. |
| `tests/services/groupClassSession.service.test.js` — generator | `sessionInstantsFor`/`generateInitialSessions`: `2026-01-20` (CST) + `'16:00'`/`'17:00'` → `22:00:00Z`/`23:00:00Z`; `2026-07-21` (CDT) → `21:00:00Z`/`22:00:00Z` (the "prove the tz math" pair); an 8-week run crossing the 2026-11-01 DST end keeps `startsAt` at 16:00 Central on both sides; `date` still a UTC-midnight sentinel. |
| same file — `listUpcomingByClass` | Freeze **21:00 Central** Tuesday, Tuesday `16:00` schedule → today absent, next week present. **15:59 Central** → today present. Two schedules, `10:00` and `18:00`, frozen 14:00 → only `18:00`. Sorted by `startsAt`. Existing "today-inclusive" and holiday cases still pass. |
| `tests/routes/groupClassSession.routes.test.js` | Re-verify the "today-inclusive" test (~line 215) freezes *before* its fixture's `startTime` — verify, don't assume. |
| `tests/routes/groupClassSchedule.routes.test.js` | PUT `startTime` → every not-yet-started session's `startsAt`/`endsAt` updated, a started session's untouched; PUT `dayOfWeek` (changed) → 400 D10; PUT `dayOfWeek` (same value) → 200. |
| `tests/routes/registration.routes.test.js` | POST + GET preview with today's started session → 400 `'startDate is a session that has already started'`; not-yet-started today → accepted; past day still → `'startDate cannot be in the past'`. After a 21:00-Central registration: **no** Visit for today's 16:00 session, Visits for later ones. The existing "past date" test at ~1662 that `updateOne`s `date` alone must also set `startsAt`/`endsAt` (use the helper). |
| `tests/routes/trialClass.routes.test.js` | Started-today → 400 D10; yesterday → same 400 (new coverage); not-yet-started today → 201. |
| `tests/services/renewal.service.test.js`, `subscription.service.test.js` | Cancel-finalize / `changeSchedule` at 21:00 Central: today's 16:00 Visit on the old schedule stays; new schedule gets no Visit for its started session today. Drop the third roster argument (D8). |
| `tests/services/student.service.test.js` ("stale trial_scheduled" block) | Trial today `16:00`: frozen 12:00 Central → `trial_scheduled`; 20:00 Central → `trial_completed`. |
| `tests/scripts/lib/backfillSessionInstants.test.js` (new) | §2.9. |

---

## §3 PR 2 — group attendance "not started" gate (only if owner approves, D9)

Branch `feature/group-attendance-start-gate`, stacked on PR 1. With `startsAt` stored this is
small:

- `groupClassSession.service.js`: in `markAttendance` and `addStudentToSession`, after the
  holiday guard: `if (session.startsAt > new Date()) throw badRequestError('Attendance cannot be marked before the session starts')`.
  Mirrors `privateClassSession.service.js:366`.
- `attachRosterToSessions` / `getById`: annotate `hasStarted: session.startsAt <= now`
  (additive, like `isHoliday`) so the admin/coach sessions lists and the attendance page render a
  "Starts at 4:00 PM" muted state with no Save button, exactly like the holiday blocked state
  (`docs/plans/holiday-blocking-plan.md` D6 / PR 2). No extra fetch needed.
- Frontend: `GroupClassSessionDetail` + list-row types gain `hasStarted: boolean`; attendance
  page + both sessions-list pages branch on it. Update `frontend/e2e/coach-attendance.spec.ts`
  and `e2e/fixtures/mock-api.ts` session fixtures (they use `date: new Date().toISOString()` with
  a `'16:00'` schedule — set `hasStarted: true` explicitly or the page renders blocked).
- Tests: route 400 (future) / 200 (started); frontend blocked-state render; E2E in the same PR.
- Docs: `docs/features/admin.md` Sessions/Attendance sections.

---

## §4 Files touched (PR 1)

| File | Change |
|---|---|
| `backend/src/utils/dateShapes.js` | + `sentinelDayString`; docblock |
| `backend/src/models/groupClassSession.model.js` | + `startsAt`, `endsAt` (required); + index |
| `backend/src/services/groupClassSession.service.js` | `sessionInstantsFor` (new export), generator, `listUpcomingByClass` query/sort/docblock |
| `backend/src/services/groupClassSchedule.service.js` | `update()`: `dayOfWeek` reject + time-change regeneration |
| `backend/src/services/registration.service.js` | `resolveStartDate` guard; roster call |
| `backend/src/services/trialClass.service.js` | guard |
| `backend/src/services/roster.service.js` | drop `today` param; `startsAt` queries; docblock |
| `backend/src/services/renewal.service.js`, `subscription.service.js`, `backend/scripts/lib/runLegacyImport.js` | roster call sites |
| `backend/src/services/student.service.js` | populate + instant predicate |
| `backend/scripts/backfill-session-instants.js`, `backend/scripts/lib/backfillSessionInstants.js` | **new** migration |
| `backend/tests/testUtils/sessions.js` | **new** fixture helper |
| `backend/tests/…` | per §2.11 |
| `frontend/lib/types.ts` | two optional fields ×3 interfaces |
| `DATABASE_SCHEMA_DOCUMENTATION.md` | `GroupClassSession` rows for `startsAt`/`endsAt` + index |
| `docs/TESTING_STRATEGY.md` | §Date rules bullet (§5) |
| `docs/decisions/009-utc-date-storage-standard.md` | Addendum (§5) |
| `docs/features/parent-portal.md`, `docs/features/admin.md` | picker + schedule-edit notes |
| `CLAUDE.md` | Documentation Map row |

---

## §5 Doc close-outs (same PR)

- **`docs/TESTING_STRATEGY.md` §Date rules — new bullet:** *"'Has this group-class session
  started / is it upcoming?' is answered ONLY by `GroupClassSession.startsAt` vs a real `now`
  (`startsAt: { $gt: now }` / `session.startsAt <= now`) — never by comparing
  `GroupClassSession.date` to `todayDateOnly()`; that is a day comparison and was the bug
  `session-start-time-cutoff-plan.md` fixed. `date` remains correct for genuinely day-granular
  questions (holidays, uniqueness, a display window's far edge). Fixtures build `startsAt`/
  `endsAt` via `sessionInstantsFor`/`tests/testUtils/sessions.js`, never by hand."*
- **ADR 009 addendum (dated):** `GroupClassSession` now carries both shapes — `date` (sentinel,
  day key) and `startsAt`/`endsAt` (instants, time key) — written together by one generator via
  `sentinelDayString` + `combineDayAndTimeInTZ`; group and private sessions now share the
  instant-vs-instant contract. Rationale in this plan's §0.2. Note the ADR's original
  "sentinel because instants rendered wrong" reasoning as superseded by the formatter gate.
- **`DATABASE_SCHEMA_DOCUMENTATION.md`:** two rows + index under `GroupClassSession`.
- **`docs/features/parent-portal.md`:** both pickers — "upcoming means start time still ahead."
- **`docs/features/admin.md` §Schedules:** the API now rejects `dayOfWeek` changes and regenerates
  future sessions' instants on `startTime`/`endTime` changes (D6); the UI deferral note stands.
- **`CLAUDE.md`:** Documentation Map row; flip this plan's Status as it progresses.

---

## §6 Out of scope / observed while analysing (owner to decide separately)

1. **Booking lead-time buffer** (D2) — one constant on the one query.
2. **`Location.timezone` wiring** (D5) — the composition takes `tz`; wire when a second location
   exists, together with the frontend's `ACADEMY_TIMEZONE` and email `dates.js`.
3. **Registration roster Visits start from TODAY, not the chosen start date.**
   `registration.service.js:343` adds the student to every not-yet-started session regardless of
   `requestedStartDate` — a parent registering Sep 23 with an Oct 1 start (billed from Oct 1 via
   proration) gets `scheduled` Visits for every late-September session too and appears on those
   rosters. Pre-existing and independent of this bug; not changed here because it may be intended
   ("on the roster once paid"). Flagging for a decision.
4. **`listBySchedule` ordering** — sorts by `date` then `scheduleId`; switch to `startsAt` when
   that page is next touched (cosmetic; `listUpcomingByClass` already switches in §2.3).
5. **Private-class `firstSessionDate` is strictly-after-today** — a Monday 9 am viewer of a Monday
   4 pm slot is offered next Monday. Deliberate in `scheduleOccurrence.js`; unchanged.
6. **Session-extension for group classes.** Sessions are generated once (8 weeks) at schedule
   creation and never extended (only `extend-private-sessions.js` exists). Unrelated to this bug
   but will bite before the instants do; a group equivalent would reuse `sessionInstantsFor`.
