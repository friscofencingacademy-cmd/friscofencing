# Duplication Cleanup Plan (Single Source of Truth) — PRs A–D

**Status:** PR A SHIPPED (merged as #94, 2026-09-24). **PR B BUILT 2026-09-24 on `feature/shared-error-factories`** (uncommitted, pending owner local testing): shared `utils/errors.js` (57 per-file definitions removed, 14 hand-built error sites converted), `utils/roles.js` (10 inline checks + 59 route lists), central `middlewares/errorHandler.js` (104 controller catch blocks → `next(error)`); the plan's §B was corrected during review (see its "Review corrections"), and the build confirmed every count. C, D READY TO EXECUTE — not started. Earlier PR A note: Build notes for PR A: the two walk-in gate tests initially failed with a `ReferenceError` because `seedTwoSchedulesSameClass` was nested in one `describe` — fixed by hoisting it to file scope (single definition), verified with a one-off `no-undef` static pass, and the "helper lives at the narrowest scope containing all its users" convention was added to `TESTING_STRATEGY.md`. Audited 2026-09-23 against Frisco `develop` (after PR #93)
and the local CKQ checkout; **reviewed the same day** — every "verify first" item was verified in
this session and its outcome is recorded inline (no open UNVERIFIED items remain), seven gaps were
found and folded in (11th inline admin check, 44 route-level admin lists, B-4 decided and included,
schedule-label duplication C7, C4/C6 resolved, `TEST_COVERAGE.md` close-out). Builder is a
separate session.

**Goal (owner requirement, 2026-09-23):** one source of truth for every rule and helper, no
unnecessary duplication, and nothing invented that the codebase or CKQ doesn't already justify.
Every finding below was **measured** (counts/diffs reproduced by the commands in §0.3), not
assumed. Where a claim could not be verified it is marked **UNVERIFIED — builder must check
first**, and the PR is scoped to only what the check confirms.

**Sequencing:** A → B → C → D, one PR each, each independently mergeable to `develop`. A first
because it is the owner's next feature (group attendance gate) and touches the same code the
cleanup would. D is last because A's tests deliberately reuse the existing local fake-timer
pattern (no new copies) and D then migrates everything, A's included, in one place.

**Standing rules for every PR here (CLAUDE.md hard rules, restated so the builder cannot miss them):**
discuss-then-`write` trigger; tests before commit (docs-only commits exempt); never auto-fix a
failing test — report cause + fix plan and stop; owner tests locally before any commit; feature
branch off `develop` → PR to `develop`; stage files by name (never `git add .`/`-A`); read every
file before editing it; no `any` on domain data; no `console.log` in production code; run backend
and frontend suites under `TZ=UTC`. **B, C, D are behavior-preserving refactors** — no test
assertion may be weakened or deleted to make them pass; if one must change, the PR description
says why.

**CKQ reference (read-only, orientation only — do not copy blindly):**
`C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\` — `utils\errors.js`, `utils\response.js`,
`middlewares\errorHandler.js`, `utils\dateUtils.js`, `__tests__\helpers\`.

---

## §0 Audit results

### 0.1 Frisco vs CKQ

| Area | CKQ | Frisco today |
|---|---|---|
| Session times | real UTC instants (`startDate`/`endDate`) | **aligned** as of PR #93 (`startsAt`/`endsAt`) — nothing to do |
| Timezone math | `moment-timezone`, IANA zone | **aligned** (`config/timezone.js`, `dateShapes.js`) |
| Error types | one `utils/errors.js`, imported by **87** files | `notFoundError` ×21, `badRequestError` ×17, `forbiddenError` ×9, `conflictError` ×11 redefined per service file |
| Error handling | central `middlewares/errorHandler.js`; controllers call `next(error)` | no central handler (`middlewares/` holds only `auth.js`); the same `catch { status = error.status \|\| 500 … }` block in **23** controllers |
| Response shaping | `utils/response.js`, 68 importers | inline `res.status().json()` — **not** a finding (see §0.4) |
| Role checks | `middlewares/roleValidate.js` (`adminOnly` hardcodes the same pair) + 6 inline in services | `role === 'admin' \|\| … 'superadmin'` inline **11×** (10 in 8 services + `registration.controller.js:43`); the admin-policy list `'admin', 'superadmin'` also spelled out **44×** as `requireRole('admin', 'superadmin')` in routes (+8 `'coach','admin','superadmin'`, +7 `'parent','admin','superadmin'`). Role *names* already have a SOT (`User.ROLES`, `user.model.js:5`); the admin *policy* has none. |
| 5xx handling | central handler, generic message | every controller sends `error.message` to the client on a 500 (raw Mongo/Stripe text). Frontend query flows hide 5xx bodies (`useLoadState`'s `getErrorMessage`) but mutation flows (`lib/services/shared.ts`) show any `data.message` regardless of status — a real leak. 0 of the 97 fallback strings are asserted by any test. |
| Test helpers | `__tests__/helpers/` | `tests/testUtils/` has only `db.js` + `sessions.js`; `loginAgent` redefined in **22** of 37 route/service test files, `TEST_PASSWORD` in **23**, fake-timer `doNotFake` list in **9** |

### 0.2 Findings by area

**A — `groupClassSession.service.js` + the attendance pages (the owner's next feature):**
- Holiday guard copy-pasted: `markAttendance` (lines 257–259) and `addStudentToSession` (419–421).
- Holiday annotation built in three places: `attachRosterToSessions` (128–132), `getById` (210–211), and the filter in `listUpcomingByClass` (183–185, a distinct *filter* use — stays).
- `markAttendance` derives coach-or-admin **inline** (lines 245–251) although `assertCoachOrAdmin` (line 317) already exists in the same file and the other three mutating functions use it.
- Frontend: `app/sessions/[id]/attendance/page.tsx` declares local `PopulatedStudent`/`SessionStudentEntry`/`SessionDetail`, structurally identical to `lib/types.ts`'s `PopulatedSessionStudentEntry`/`GroupClassSessionDetail`; `app/coach/schedules/[id]/sessions/page.tsx` declares local `SessionItem`, a subset of `GroupClassSession`. `isHoliday`/`holidayName` therefore live in **four** places today.

**B — backend errors/roles:** the four factory families above (identical intent, per-file copies);
two genuinely domain-specific helpers that are **not** duplicates and stay local:
`paymentFailedError` (1 file) and `remapKnownValidationError` (1 file).

**C — frontend:**
- `formatSessionDate` / `formatSessionTimeRange` / `formatSessionLine`: **byte-identical** (9 lines, confirmed by `diff`) in `app/parent/book-trial/page.tsx` and `app/parent/register/page.tsx`; the session load-and-merge effect (`classIdsForLevel.map((id) => fetchSessionsByClass(id))` + `.flat().sort()`) is also duplicated between them (only the error string differs).
- `DAY_LABELS` redefined in `app/admin/private-classes/page.tsx` and `app/admin/subscriptions/page.tsx` although `lib/constants.ts` exports it.
- 6 pages hand-roll the `let isMounted`/`let cancelled` fetch pattern while 24 use `lib/hooks/useLoadState.ts`: `coach/schedules/[id]/sessions`, `parent/billing`, `parent/book-trial`, `parent/payment-method`, `parent/register`, `sessions/[id]/attendance`.
- `app/admin/locations/page.tsx` line 24 hardcodes `'America/Chicago'` although `lib/formatDate.ts` exports `ACADEMY_TIMEZONE`.
- **Schedule/slot labels built inline at 11 sites** (`DAY_LABELS[x.dayOfWeek]` + `formatTime(x.startTime)`…), with **three different separators** (`·`, `-`, ` - `): `admin/private-classes` (3 slot sites), `admin/subscriptions` (`scheduleLine` + line 343), `parent/child/[id]` (2), `parent/dashboard`, `parent/register` (line 572), `parent/subscriptions` (`formatSchedule` + slot at 103). Two tests pin the exact string `'Wednesday 4:00 PM-5:00 PM'` (`parent/subscriptions/__tests__/page.test.tsx:131,238`).
- **Checked and NOT a duplicate:** `formatFirstSessionDate` (`register-private` vs `private-classes`) differs (`weekday: 'long'` vs `'short'`) — leave both.
- **Verified (was UNVERIFIED):** five local date formatters are one-line wrappers over the shared gate — pure indirection: `admin/coach-contracts` `formatDate` = `formatInstant(iso)`; `parent/subscriptions` `formatDate` = `formatDateOnly`; `admin/subscriptions` `formatDateLabel` = `formatDateOnly`; `parent/register` `formatDateLabel` = `formatDateOnly`; `coach/private-students` `formatDateTime` = `formatInstant(iso, { weekday: 'short', hour: 'numeric', minute: '2-digit' })`. `admin/audits` `formatRelativeTime` is unique logic — keep.
- **Verified (was UNVERIFIED):** `lib/hooks/useLoadState.ts` supports `deps`, cancellation on unmount/re-run, and `retry()`; it takes ONE fetcher (compose inside the fetcher for multi-fetch). `parent/billing` is a single read (`fetchMyPaymentHistory`) → migrate. `coach/schedules/[id]/sessions` is a single read → migrate. `sessions/[id]/attendance` refetches after a mutation AND derives local checkbox state from the data → leave. `parent/payment-method` (Stripe element lifecycle) → leave. `register`/`book-trial` → handled by C2.

**D — tests:**
- `doNotFake` timer list in 9 files: `routes/groupClassSchedule`, `routes/groupClassSession`, `routes/privateClassSchedule`, `routes/registration`, `services/billing/proration`, `services/groupClassSession`, `services/privateClassSession`, `services/roster`, `services/student` (`*.test.js`). **Verified: every list is the same 7 timers** (`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `setImmediate`, `clearImmediate`, `nextTick`). **PR #93 added two of these copies** (`groupClassSchedule.routes.test.js`'s `FAKE_TIMER_PASSTHROUGH`, `roster.service.test.js`'s `DO_NOT_FAKE`) — this plan cleans up that duplication too.
- `loginAgent` ×22 — **verified: two variants that differ only by blank lines**, otherwise identical. `TEST_PASSWORD` ×23 — **verified: all `'correct-password'`**. `seedClass` ×3 — **verified: content-identical** (one formatted on a single line).

### 0.3 How to re-measure (run before starting each PR — counts may have moved)

```bash
cd backend/src
grep -l "function notFoundError" services/*.js | wc -l        # also badRequestError/forbiddenError/conflictError
grep -rn "role === 'admin' ||" services controllers | wc -l
grep -l "error.status || 500" controllers/*.js | wc -l
cd ../tests
grep -rl "async function loginAgent" . | wc -l
grep -rl "doNotFake" . | wc -l
cd ../../frontend
grep -rn "const DAY_LABELS" app lib
grep -rlE "let isMounted|let cancelled" app --include=page.tsx
```

### 0.4 Observed and deliberately left alone

1. **Date utility modules** — `billingDates.js`, `dateShapes.js`, `scheduleOccurrence.js`, `email/dates.js`, `config/timezone.js` vs CKQ's single `dateUtils.js`. ADR 009 split these on purpose (billing vs non-billing vs presentation) and no overlapping *functions* were found. Not touched. Revisit only if a genuine duplicate function appears.
2. **`utils/response.js`** — CKQ wraps every response in `{status,message,code,data}`; Frisco's contract is plain `{ message }` / entity JSON. Adopting CKQ's envelope would be a breaking API change for no measured duplication. Not adopted.
3. **Frontend timezone constant** — `ACADEMY_TIMEZONE` (frontend) and `DEFAULT_TIMEZONE` (backend) are two constants because they are two runtimes; they cannot import each other. Only the stray *literal* on the locations page (C5) is a real duplicate.
4. **Pages bypassing the service layer** — the attendance page and coach sessions page call `api.get` directly although `fetchSessionById` / `fetchSessionsBySchedule` exist in `lib/services/scheduling.ts`. Pre-existing; PR A changes only their *types*, not their fetch path.
5. **CKQ's relative-date test helper** (`__tests__/helpers/testDates.js`, `futureDate()`/`pastDate()`) — **do not copy**: it computes from the real clock, which contradicts this repo's no-time-bomb rule (`TESTING_STRATEGY.md` §Date rules). Only the *idea* of one shared helper directory is borrowed (D).
6. **Private-class attendance stays strict** (instant-vs-instant, `session.startDate <= now`) while group attendance becomes same-day (PR A) — intentional, see A-D6.

---

## §A PR A — Same-day group attendance gate + single-source cleanup of `groupClassSession.service.js`

**Branch:** `feature/group-attendance-same-day-gate` (off `develop`).

**Problem:** a coach/admin can mark attendance for a session that hasn't happened (e.g. next
week's class). Private lessons already block this; group classes have no gate and the UI doesn't
say the session is upcoming.

### A-D Decisions

| # | Decision | Why |
|---|---|---|
| A-D1 | **Rule (owner, 2026-09-23): attendance can be marked from the start of the session's calendar day (Central) onward — same-day is the grace period. No admin override (same rule for everyone). No late-marking cutoff.** | Owner's words: "attendance should be allowed on the same day… Admin override not necessary… No late marking cutoff." |
| A-D2 | **Day-granular check: `session.date <= todayDateOnly()`. `date` is compared directly — NOT normalized with `dateOnlyUTC()`.** | "Is attendance open?" is a *day* question, so the sentinel-vs-sentinel comparison is the correct one (ADR 009: a sentinel is compared only against another sentinel). It is deliberately *different* from "has the class started?" (a *time* question, answered by `startsAt` — PR #93). Normalizing DB values would be an invented safeguard: staging was verified 0 non-midnight dates of 152, production has no sessions, and every writer (generator, backfill) produces clean sentinels; existing call sites compare DB `date` directly. If contamination ever appears, the existing `scripts/normalize-date-sentinels.js` is the fix. |
| A-D3 | **One predicate + one assertion in `groupClassSession.service.js`:** `isAttendanceOpen(date, today)` and `assertSessionAcceptsAttendance(session)` (holiday check first, then open-day check). Both write paths (`markAttendance`, `addStudentToSession`) call the assertion; both annotators call the predicate. | Single source of truth: the guard, the list annotation and the detail annotation cannot disagree. Holiday stays *first* so the existing holiday tests keep failing/passing for the right reason. |
| A-D4 | **One additive response field: `attendanceOpen: boolean`**, on `getById` and every row of `attachRosterToSessions`, computed with one `todayDateOnly()` per request. No `attendanceOpensAt` (the frontend already has `date`). | Mirrors the `isHoliday` pattern (`holiday-blocking-plan.md` D6); the no-client-side-availability-math rule means the backend decides, the frontend renders. |
| A-D5 | **Frontend blocks only when `attendanceOpen === false`.** Absent/`undefined` renders normally. | Same permissive-default semantics as `isHoliday` (blocked only when `true`). Consequence: existing E2E mock fixtures and older tests need **no** edit — this corrects the earlier draft in `session-start-time-cutoff-plan.md` §3, which had it inverted. |
| A-D6 | **`removeStudentFromSession` stays ungated.** Private-class attendance stays strict. | Removal only undoes a mistaken walk-in. Private attendance is strict because marking a private lesson attended triggers a per-session Stripe charge (`privateClassSession.service.js` `chargeSession`); group attendance charges nothing. Record this rationale in the docs so it does not read as an oversight. |
| A-D7 | **Error message:** `'Attendance can only be marked on or after the session\'s day'` (400). | Distinct from the holiday message so a test can tell which guard fired. |

### A-1 Backend — `backend/src/services/groupClassSession.service.js`

Line numbers are as of `develop` @ PR #93; re-`grep` before editing.

1. Add (module-local, near the other small helpers):
   ```js
   // "Is attendance open?" is a DAY question (docs/plans/duplication-cleanup-plan.md A-D1/A-D2):
   // open from the start of the session's own calendar day onward. Sentinel-vs-sentinel.
   function isAttendanceOpen(dateSentinel, today) {
     return dateSentinel <= today;
   }

   // The single guard both attendance-writing paths call. Holiday first (its own
   // message), then the open-day check. Extracted from two copy-pasted holiday guards.
   async function assertSessionAcceptsAttendance(session) {
     const holidays = await holidayService.getHolidaysInRange(session.date, session.date);
     if (holidayService.findHolidayForDate(session.date, holidays)) {
       throw badRequestError('Attendance cannot be marked on an academy holiday');
     }
     if (!isAttendanceOpen(session.date, todayDateOnly())) {
       throw badRequestError("Attendance can only be marked on or after the session's day");
     }
   }
   ```
2. `markAttendance`: replace the inline `isAdmin`/`isAssignedCoach` block (lines 245–251) with
   `await assertCoachOrAdmin(schedule, requestingUser);` (already defined at line 317 and used by
   the other three functions — verify the two blocks are behaviorally identical first, including
   the 403 message, before deleting the inline copy), and replace the holiday guard
   (lines 257–259) with `await assertSessionAcceptsAttendance(session);`.
3. `addStudentToSession`: replace the holiday guard (lines 419–421) with the same one call.
4. Annotation, one shared builder used by `attachRosterToSessions` and `getById`:
   `today` computed **once** per call (`attachRosterToSessions`: once outside the `.map`);
   each returns `{ isHoliday, holidayName, attendanceOpen: isAttendanceOpen(session.date, today) }`.
   The holiday *lookup* differs (one range query for the list, one single-date query for detail)
   and stays as is — only the annotation object is built in one place.
5. `listUpcomingByClass`'s holiday **filter** (183–185) is a different use and is left untouched.

### A-2 Frontend

1. `frontend/lib/types.ts`: add `attendanceOpen?: boolean` (with a single explanatory comment
   pointing at this plan) to `GroupClassSession` **and** `GroupClassSessionDetail` — the only two
   places the field is declared.
2. `app/sessions/[id]/attendance/page.tsx`: **delete** the local `PopulatedStudent`,
   `SessionStudentEntry`, `SessionDetail` interfaces; import `GroupClassSessionDetail` from
   `lib/types`. (Verified structurally identical apart from the optional `startsAt`/`endsAt` the
   shared type adds. Type-only change — the `api.get` call is untouched, see §0.4-4.) Add the
   blocked state next to the holiday one: when `session.attendanceOpen === false` render
   `Alert` "Attendance opens on {formatDateOnly(session.date)} …" with no roster and no Save
   button; holiday takes precedence when both apply.
3. `app/coach/schedules/[id]/sessions/page.tsx`: **delete** local `SessionItem`; import
   `GroupClassSession`. When `attendanceOpen === false`: muted **"Not open yet"** chip instead of
   the "Mark Attendance" link (the row already shows its date, so a chip repeating it would be
   noise — refined from the original "Opens {date}" wording during the build), student count
   kept (admins/coaches still see who is registered); holiday chip wins.
4. `app/admin/schedules/[id]/sessions/page.tsx` (already on the shared type): same chip.
5. Reuse existing tokens/classes (`chip`, `chipMuted`) — no new CSS.

### A-3 Tests (before commit, per Hard Rule 4)

**New fixture helper** — extend the existing `backend/tests/testUtils/sessions.js` (PR #93), do
not create a new file: `makeSessionAttendable(session, schedule)` moves a session to a fixed past
day (`2020-01-01`) **and recomputes `startsAt`/`endsAt` through the production
`sessionInstantsFor`**, so `date` and the instants stay mutually consistent. Call it **once** in
each of the two seed helpers in `tests/routes/groupClassSession.routes.test.js`
(`seedScheduleWithSession`, `seedTwoSchedulesSameClass`) — not per test. Other sessions of that
schedule remain in the future, so "blocked" tests use a different session from the same seed.

**Existing assertions that would otherwise pass for the wrong reason** (verified by reading the
file): `returns 400 when a studentId is not on the session roster` (~line 399),
`returns 400 adding a student not on the eligible list` (~551) assert only `status === 400` —
with the new gate they could 400 for the wrong reason. Make the session attendable **and** add a
`res.body.message` assertion to each. The two holiday 400 tests (~588, ~607) stay correct because
the holiday check runs first; add a message assertion there too for the same reason. The 403
test (~329) is unaffected (permission check precedes the gate). The `GET /:id` / `by-schedule`
annotation tests keep passing (holiday-annotation assertions are independent).

| File | New cases |
|---|---|
| `tests/routes/groupClassSession.routes.test.js` | Clock frozen (existing `jest.useFakeTimers({ now, doNotFake })` pattern already in this file). **PATCH `/attendance` and POST `/students` on a future-day session → 400 with the A-D7 message, no Visit written/changed.** Same call on today's session → 200. Past session → 200 (no late cutoff). Admin and coach get identical results. **Boundary:** day-before 23:59 Central → 400; the session's own day 00:00 Central → 200, in CDT (`05:00Z`) and CST (`06:00Z`). **UTC trap:** frozen at 20:00 Central Tuesday (already Wednesday in UTC) → Wednesday's session is still 400 (a naive UTC-day comparison would wrongly open it — the exact bug class this whole effort targets). **Holiday precedence:** a session that is both future-day and holiday returns the *holiday* message. **Guard/annotation agreement:** for the same session, `GET /:id` says `attendanceOpen: false` iff PATCH returns 400 (and vice versa); also asserted for a `by-schedule` row. `DELETE` (remove walk-in) on a future-day session is not blocked. |
| frontend `app/sessions/[id]/attendance/__tests__/page.test.tsx` | `attendanceOpen: false` → blocked alert with the date, no checkboxes, no Save; `true` and *absent* → normal roster + Save; `isHoliday: true` + `attendanceOpen: false` → holiday message. |
| frontend `app/coach/schedules/[id]/sessions/__tests__/page.test.tsx`, `app/admin/schedules/[id]/sessions/__tests__/page.test.tsx` | `attendanceOpen: false` row → "Opens {date}" chip, no Mark Attendance link, count still shown; open/absent row keeps the link; holiday wins. |
| `frontend/e2e/coach-attendance.spec.ts` | Add a blocked-state test (mock `GET /group-class-sessions/:id` with `attendanceOpen: false`); the existing test passes **unchanged** (absent field = open). E2E update is mandatory per `TESTING_STRATEGY.md`. |

Frontend types are checked by `tsc --noEmit`; fixtures must satisfy the shared type (no `any`).

### A-4 Docs (single source — state the rule once)

- **`docs/decisions/009-utc-date-storage-standard.md`** — the **canonical** statement, as a short
  addendum: *time* questions ("has it started / is it upcoming") use `startsAt` (instant); *day*
  questions (attendance-open, holidays, uniqueness, display window edges) use the `date` sentinel
  vs `todayDateOnly()`; attendance opens on the session's own Central day (A-D1), and why private
  attendance is stricter (A-D6).
- **`docs/TESTING_STRATEGY.md`** — reword the *one* existing bullet added by PR #93
  ("…never by comparing `GroupClassSession.date` to `todayDateOnly()`") to add
  "…for started/upcoming; day-granular questions such as the attendance gate legitimately use the
  day comparison — see ADR 009"; document `makeSessionAttendable` beside `createSession`. Do not
  restate the rule.
- **`docs/features/admin.md`** — Sessions/Attendance behavior (blocked state, chip). Link to the ADR.
- **`CLAUDE.md`** — Documentation Map row for this plan.
- **`docs/plans/session-start-time-cutoff-plan.md` §3** — replaced by a pointer to this section
  (done in the same change that created this file).

### A-5 Files touched

`backend/src/services/groupClassSession.service.js`, `backend/tests/testUtils/sessions.js`,
`backend/tests/routes/groupClassSession.routes.test.js`, `frontend/lib/types.ts`,
`frontend/app/sessions/[id]/attendance/page.tsx` (+ test), `frontend/app/coach/schedules/[id]/sessions/page.tsx`
(+ test), `frontend/app/admin/schedules/[id]/sessions/page.tsx` (+ test),
`frontend/e2e/coach-attendance.spec.ts`, docs above.

---

## §B PR B — Backend shared error factories, admin-role SOT, central error middleware

**Branch:** `feature/shared-error-factories`. Reviewed against CKQ and the code on 2026-09-24
(seven defects in the first draft were found and fixed — see "Review corrections" at the end of
this section; the decisions below are the corrected ones).

### B-D Decisions

| # | Decision | Why |
|---|---|---|
| B-D1 | **`backend/src/utils/errors.js`: one private `httpError(status, message)` (`const error = new Error(message); error.status = status; return error;`) exported alongside thin named factories — `notFoundError` (404), `badRequestError` (400), `unauthorizedError` (401), `forbiddenError` (403), `conflictError` (409).** Plain `Error` with a numeric `.status`, byte-identical to today's per-file bodies. **No `http-errors` dependency and no class hierarchy** (CKQ's `APIError`/`ValidationError`/… classes are not adopted). `httpError` is also exported so the two genuinely domain-specific statuses (`paymentFailedError` 402 in `paymentMethod.service.js`, the 500 config error in `serviceCatalog.service.js`) go through the same single constructor instead of a hand-set `.status`. After this PR **no file outside `utils/errors.js` sets `error.status =` by hand.** | 57 identical per-file copies (§0.2-B; **verified by hashing every full body**, not just headers). The existing contract — every controller reads `error.status` — must not change, so plain factories are the minimal correct shape. `http-errors` was in the first draft only to supply `.expose`; the corrected middleware rule (B-D4) is status-based, so it has no remaining purpose and would add a dependency for nothing. `unauthorizedError` exists because `auth.service.js` hand-builds two 401s and CKQ has the equivalent (`UnauthorizedError`). Keeping the named factories means the ~177 existing `throw xxxError(...)` call sites are untouched. |
| B-D2 | **`serviceCatalog.service.js`'s local `notFoundError` (status 500!) is NOT swapped for the shared 404 factory.** Rename it `serviceNotConfiguredError` and build it with `httpError(500, message)`; its `conflictError` (409) IS swapped. `remapKnownValidationError` (`location.service.js`) stays local (it transforms a Mongoose error; it is not a factory). | **Verified by full-body hash:** of the 21 `notFoundError` definitions, 20 return 404 and exactly one (`serviceCatalog`) returns 500 — it signals a misconfigured service registry, not a missing resource. Swapping it would silently change 500 → 404. Same name, different semantics across modules is itself a source-of-truth hazard, hence the rename. |
| B-D3 | **`backend/src/utils/roles.js` exporting `ADMIN_ROLES = ['admin', 'superadmin']` and `hasAdminRole(user)`** (`!!user && ADMIN_ROLES.includes(user.role)`). Replace the **10** inline derivations (9 services + `registration.controller.js:43`) with `hasAdminRole(...)`, and the route lists with a spread of `ADMIN_ROLES`: **44** `requireRole('admin', 'superadmin')`, **8** `'coach', 'admin', 'superadmin'` → `requireRole('coach', ...ADMIN_ROLES)`, **7** `'parent', 'admin', 'superadmin'` → `requireRole('parent', ...ADMIN_ROLES)`. Per-site authorization *logic* (ownership rules, coach assignment) is untouched. Unit test: every `ADMIN_ROLES` entry ∈ `User.ROLES` (the role-*name* SOT, `user.model.js:5`). `LOGIN_CAPABLE_ROLES` (`user.service.js`) is a different policy with a single definition — leave. **The helper is deliberately NOT named `isAdmin`:** the services all write `const isAdmin = …`, and `const isAdmin = isAdmin(user)` is a temporal-dead-zone `ReferenceError`. | The admin *policy* ("admin means admin or superadmin") is spelled out ~70 times with no home; changing it means a 70-site edit. `User.ROLES` stays the SOT for role names; `ADMIN_ROLES` becomes the SOT for the admin policy. CKQ's `adminOnly` middleware hardcodes the same pair — this is one step ahead of it. |
| B-D4 | **Central error middleware `backend/src/middlewares/errorHandler.js`, registered as the LAST `app.use` in `app.js`.** Rule (status-based, identical in every environment): `status = err.status \|\| 500` — **`err.status` only, never `err.statusCode`** (Stripe SDK errors carry a `statusCode` of 401/402/429 that must not be relayed to our client). If `res.headersSent` → `return next(err)` (Express docs). Mapping (in order): (1) Mongoose **`ValidationError` → 400**, message = the per-field `errors[*].message` values joined with `', '` (as CKQ does; cleaner than today's `"Testimonial validation failed: quote: Path …"` and does not leak the model name); (2) Mongoose **`CastError` → 400**, fixed message `Invalid ${err.path}` (a malformed ObjectId in `:id`; **CKQ does not map this — it is our addition, standard practice**, and the fixed message avoids leaking `Cast to ObjectId failed … for model "X"`); (3) anything else: `status < 500` → that status with **its own message** (legacy-shaped errors have no `.expose` flag — the login 401 "Invalid credentials", signup 400/409, the 402 card message must keep their text); `status >= 500` → the fixed message `'Something went wrong'`. Response body stays `{ message }` (**CKQ's `{status,message,code}` envelope is NOT adopted**, §0.4-2). Logging: **only `status >= 500`**, via `console.error` with the eslint-disable comment this codebase already uses for operational logging (no new logger), logging method, url, status, message, stack and `req.user._id` — **never the request body** (CKQ logs it; it can contain passwords/card data). **Not mapped:** Mongo duplicate-key (`E11000`) — 7 services handle it locally as idempotency guards (`registration`, `renewal`, `privateClassSession`), and turning race-condition 500s into 409s is a separate decision; JWT errors — `requireAuth` already handles them. The 104 standard controller catch blocks become `return next(error);`; the try/catch stays (Express 4.22 does not auto-forward async rejections). **Left untouched:** `stripeWebhook.controller.js` (its own 400/500 shapes are tailored to Stripe's signature/retry contract and it is not user-facing), the multer error handlers in `spotlight.routes.js`/`testimonial.routes.js`, and inline pre-checks such as `privateClassSchedule.controller.js:8`/`spotlight.controller.js:58` (a 400 with a fixed message, not a catch block). | Measured: **0 of the 97** distinct controller fallback strings are asserted by any test. Today every controller sends `error.message` on a 500 — a raw Mongo/Stripe message reaches the client; query flows hide it (`getErrorMessage`) but mutation flows (`lib/services/shared.ts`) display it. Three existing tests assert `500` for what are really *validation* failures (`price.routes` negative `registrationFee`, `spotlight.routes` >3 bullets, `testimonial.routes` missing quote/author — each carries a comment calling it "imperfect"); without the `ValidationError` mapping those admin flows would regress from a useful message to "Something went wrong". Industry standard: one error middleware, 4xx exposed, 5xx masked and logged. |
| B-D5 | **Behavior changes in this PR (the PR description must list all three):** (a) 5xx response text is the fixed generic message instead of the raw error text (security); (b) Mongoose `ValidationError` responses change from **500 to 400** and their wording is the joined field messages — the three tests above change `500 → 400` and gain a message assertion; (c) a malformed ObjectId path param changes from **500 to 400**. Everything else — every 4xx status and message text — is byte-identical, and the existing suite is the proof. | Called out so a reviewer does not have to rediscover them. |

### B-1 Create modules + unit tests
`utils/errors.js`, `utils/roles.js`, `middlewares/errorHandler.js`, and
`tests/utils/errors.test.js` / `tests/utils/roles.test.js` / `tests/middlewares/errorHandler.test.js`:
- errors: each factory → correct `.status`, `.message`, is an `Error`; `httpError(402, 'x')`.
- roles: `hasAdminRole` true for `admin`/`superadmin`, false for `coach`/`parent`/`student`/`undefined`
  user; every `ADMIN_ROLES` entry ∈ `User.ROLES`.
- errorHandler (supertest against a tiny throwaway Express app, not the real `app.js`): a factory
  error → its status + message; a legacy-shaped `Error` with `.status = 401` and no other flag →
  401 + **its own message**; a bare `new Error('db exploded')` → 500 + `'Something went wrong'`
  and **not** the raw text; an error with `.statusCode = 402` but no `.status` (Stripe-shaped) →
  **500**, not 402; a real Mongoose `ValidationError` (built from a throwaway schema) → 400 +
  joined messages; a `CastError` → 400 + `Invalid <path>`; `res.headersSent` → delegated to
  `next`; 4xx is not logged, 5xx is (spy on `console.error`).

### B-2 Replace the copies (57 definitions in 21 services)
A checker script (kept out of the repo) must confirm each definition's normalized body equals the
canonical one **before** deleting it; the one known exception is `serviceCatalog`'s `notFoundError`
(B-D2). Definitions per name (as of this audit): `notFoundError` 21 (20 swapped + the serviceCatalog
500 one renamed), `badRequestError` 17, `forbiddenError` 9, `conflictError` 11. Each file gets a
`require('../utils/errors')` destructure of **only the names it uses**; a definition that turns out
to be unused is simply deleted.

**Inline error creation (14 sites — also duplication, previously missed):** convert each
`const error = new Error(msg); error.status = N; throw error;` to the matching factory —
`auth.service.js` ×4 (two 401 → `unauthorizedError`, the 400 "Phone number is required" →
`badRequestError`, the 409 "account already exists" → `conflictError`), `level.service.js` ×2,
`billing/calculateChargeAmount.service.js` ×2, and one each in `groupClass`, `location`,
`paymentMethod` (402 → `httpError(402, …)`), `price`, `serviceCatalog` (→ B-D2), `trialClass`.
**Read each site first:** a `new Error` with no `.status` (an internal/programming error that is
meant to surface as a 500) must stay a plain `Error`, not be given a status.

### B-3 Replace inline admin checks (10) and route role lists (59)
Services: `groupClassSession.service.js` (1 — `assertCoachOrAdmin`, after PR A),
`privateClassEnrollment.service.js`, `privateClassSchedule.service.js`,
`privateClassSession.service.js` (2), `registration.service.js`, `subscription.service.js` (2),
`trialClass.service.js`; controller: `registration.controller.js:43`. **Verified: all 10 are
exactly `X.role === 'admin' || X.role === 'superadmin'`** (`X` = `requestingUser` or `req.user`);
each becomes `const isAdmin = hasAdminRole(X);` (local variable name unchanged).
Routes: every `requireRole(...)` whose list contains both `'admin'` and `'superadmin'`
(`grep -rn "requireRole(" src/routes` to enumerate; `requireRole('superadmin')` ×8 and the
single-role guards are NOT admin-policy sites — leave them).

### B-4 Central error middleware
1. `middlewares/errorHandler.js` per B-D4; `app.use(errorHandler)` as the last `app.use` in
   `app.js` (there is no 404 handler today — do not invent one).
2. Controllers: **104 catch blocks in 23 files** (excluding `stripeWebhook`); five are
   prettier-wrapped variants (`return res\n .status(status)\n .json(…)`). Each
   `catch (error) { const status = …; return res.status(status).json({ message: … }); }` becomes
   `catch (error) { return next(error); }` and the handler's signature gains `next`. **Every**
   converted function needs `next` in its parameter list — a missed one is a runtime
   `ReferenceError`, so run the no-undef static pass (below) over all 23 files and confirm
   `grep -c "error.status || 500" src/controllers/*.js` is 0 everywhere except `stripeWebhook`.
3. The now-dead fallback strings are deleted with the blocks.

### B-5 Tests & docs
- The three `500` tests become `400` with a message assertion (their comments explaining "falls
  through the generic `error.status || 500` handler" are rewritten). One integration test through
  the real `app`: a route whose service rejects with `new Error('secret db detail')` (spy on a
  model method) → 500, generic message, **the secret text absent from the body**.
- Existing suite must otherwise pass **unchanged** — that *is* the regression proof for the
  factories, the role helper and every 4xx path. Run a one-off `no-undef` pass
  (`npx eslint@8 --no-eslintrc --env node,es2022,jest --rule '{"no-undef":"error"}'`) over every
  changed file; the repo has no linter, so this is the only guard against a missing `next` or
  import.
- Docs: `TESTING_STRATEGY.md` (the "per-file `notFoundError`/`badRequestError`/etc. helper pattern"
  reference near its error-handling contract → `utils/errors.js`, plus the new contract "a 5xx
  never carries the internal message; Mongoose validation is a 400"); `docs/TEST_COVERAGE.md`
  (§E); `CLAUDE.md` row.

### Review corrections (2026-09-24) — what the first draft of this section got wrong
1. **"Verified: one distinct body per name" was false** — the check compared headers, not bodies;
   `serviceCatalog`'s `notFoundError` is a 500 (→ B-D2).
2. **`.expose`-based masking would have broken legacy-shaped errors** (login 401, signup 400/409,
   402 card message) — replaced by the status-based rule (→ B-D4).
3. **`http-errors` was unnecessary** once (2) was fixed, and its `.statusCode` invites the Stripe
   mix-up — dropped (→ B-D1).
4. **14 inline `new Error` + `.status` sites bypass the factories** and were missed (→ B-2).
5. **Helper named `isAdmin` would shadow-crash every call site** (`const isAdmin = isAdmin(...)`) —
   renamed `hasAdminRole` (→ B-D3).
6. **The Mongoose `ValidationError` exclusion was wrong** — three admin flows would have degraded;
   mapping now included, plus `CastError` (→ B-D4/B-D5).
7. **The handler lacked `headersSent` delegation and logged too much/too little** — fixed (→ B-D4).

---

## §C PR C — Frontend shared session helpers, constants, fetch patterns

**Branch:** `feature/frontend-shared-session-helpers`. Each item is independent; drop any whose
verification step fails rather than forcing it.

| # | Change | Verification the builder must do first |
|---|---|---|
| C1 | Move `formatSessionDate` / `formatSessionTimeRange` / `formatSessionLine` (9 identical lines) into one module (e.g. `lib/sessionLabels.ts`); both `book-trial` and `register` import it. | `diff` the two pages' copies again (they were byte-identical at audit time). Keep the ADR 009 rule: the date renders via `formatDateOnly` (sentinel), never a bare `toLocaleDateString`. |
| C2 | Extract the duplicated load-and-merge effect into one hook in `lib/hooks/` (e.g. `useUpcomingSessionsForLevel(classIdsForLevel)` returning `{ sessions, loading, failed }`); the pages keep their **own** error strings (`'Failed to load sessions.'` vs `'Failed to load upcoming class dates.'`) by mapping `failed`. | Read both effects in full: only the error string may differ — any other difference (cancel handling, sort) means the hook must take a parameter or the item is dropped. Existing MSW-based page tests must pass untouched. |
| C3 | Delete the two local `DAY_LABELS` (`admin/private-classes`, `admin/subscriptions`); import `lib/constants.ts`'s. | Confirm all three arrays are identical (values and order). |
| C4 | Migrate **exactly two** pages to `useLoadState`: `coach/schedules/[id]/sessions` and `parent/billing`. Leave `attendance`, `payment-method` (reasons in §0.2-C); `register`/`book-trial` are C2. | **Verified** (§0.2-C). Existing page tests must pass untouched; the pages already render the same loading/error states the hook provides — if a page's error copy differs from `getErrorMessage`'s, keep the page's copy via a local mapping rather than changing user-visible text. |
| C5 | `admin/locations/page.tsx` line 24: replace the `'America/Chicago'` literal with `ACADEMY_TIMEZONE` from `lib/formatDate`. | Confirm the form default is meant to equal the academy timezone (it is a *default for a new location*, which today is always Central). |
| C6 | Delete the five one-line wrapper formatters (§0.2-C) and call `formatDateOnly`/`formatInstant` directly at their call sites, passing the same options. Keep `admin/audits` `formatRelativeTime`. | **Verified: pure indirection, zero output change.** Page tests must pass untouched. |
| C7 | **Schedule/slot labels:** add `formatScheduleLabel(schedule)` → `'Wednesday 4:00 PM-5:00 PM'` and `formatSlotLabel(slot)` → `'Tuesday 4:00 PM'` to the same module as C1 (one `lib/sessionLabels.ts` for every human label built from a schedule/slot/session). Replace all 11 inline builds; sites with a prefix (`'Every '`, `'Enrolled — '`, class name) keep their prefix and call the helper for the core. **Separator decision: `'Wednesday 4:00 PM-5:00 PM'`** (plain hyphen, space-separated day) — the form two existing tests already pin; `admin/subscriptions`' `·` and `book-trial`/`register`'s en-dash `–` are unified to it. | This is the **one C item where test assertions legitimately change** (the `·`/`–` sites' tests, if any assert the exact string — `grep -rn "PM–\|· 4:00" app --include=*.test.tsx` first). The PR description lists every changed assertion with its before/after string. E2E specs that match by regex on the time (`/4:00 pm/i`) are unaffected. |

**Tests:** no page test may change assertions **except** the C7 separator unification, itemized
in the PR. Add unit tests for the new module (`lib/__tests__/sessionLabels.test.ts` — every
helper, sentinel dates rendered via `formatDateOnly`, an instant never passed to it) and the C2
hook (`lib/hooks/__tests__/`). Run the **full E2E suite** (`parent-register.spec.ts` and
`holiday-blocking.spec.ts` drive these pages). `tsc --noEmit` clean.

**Docs:** `docs/features/parent-portal.md` (where the shared helpers/hook live), `docs/design-system.md`
components inventory if it lists label helpers (check first), `docs/TEST_COVERAGE.md` counts (§E),
`CLAUDE.md` row.

---

## §D PR D — Shared backend test helpers

**Branch:** `feature/shared-test-helpers`. Mechanical; do file-by-file, running each file's suite
after editing it.

| # | Change | Verification first |
|---|---|---|
| D1 | `backend/tests/testUtils/clock.js` exporting `freezeAt(iso)` (fakes **only** `Date`, leaves every timer real — required or the mongodb-memory-server driver hangs, see the existing comments in `groupClassSession.service.test.js`) and the pass-through timer list (`REAL_TIMERS`). Replace the copies in the 9 files listed in §0.2-D, **including the two PR #93 added**. | **Verified: all 9 lists are the same 7 timers.** `registration.routes.test.js` freezes in a `beforeEach` and re-sets time with `jest.setSystemTime` — keep that structure, only source the list from the helper. |
| D2 | `backend/tests/testUtils/auth.js` exporting `TEST_PASSWORD` and `loginAgent(app, email)`. Replace the copies in all 22/23 files. | **Verified: all 22 `loginAgent` bodies are identical modulo blank lines; all 23 `TEST_PASSWORD` values are `'correct-password'`.** **`seedUser`/`seedAdmin` are NOT unified** — they differ per file (roles, default emails) and unifying them would be a parameter explosion, not a single source of truth. |
| D3 | `seedClass` → `backend/tests/testUtils/catalog.js` (`seedClass()`); replace all 3. | **Verified: all 3 bodies content-identical** (`Level 'Beginner'/1`, `Location 'Frisco HQ'`, `GroupClass 'Beginner Foil'` capacity 10). |
| D4 | Document the helper inventory **once**: a "Shared test helpers" section in `TESTING_STRATEGY.md` listing `db`, `sessions`, `clock`, `auth`, `catalog`, each with one line on when to use it. | — |

**Explicitly not copying CKQ's `testDates.js`** (§0.4-5).

**Tests:** the whole backend suite passes unchanged under `TZ=UTC`; that is the proof. Count
check after: `grep -rl "async function loginAgent" backend/tests | wc -l` should drop to ~0 (only
documented variants remain) and `grep -rl "doNotFake" backend/tests | wc -l` to 1 (`clock.js`)
plus any file with a genuinely different setup, each with a comment saying why.

---

## §E Doc close-outs (each PR, same PR)

Every PR flips its own row in `CLAUDE.md`'s Documentation Map (BUILT → SHIPPED), updates only
the docs named in its own section, and **re-runs and updates `docs/TEST_COVERAGE.md`** (its
counts are real, re-run per update — every PR here adds or moves tests). **No PR restates a rule that already has a canonical home**
(the attendance/day-vs-time rule lives in ADR 009; the helper inventory in `TESTING_STRATEGY.md`;
error factories in `utils/errors.js`'s own header comment) — link, don't copy.
