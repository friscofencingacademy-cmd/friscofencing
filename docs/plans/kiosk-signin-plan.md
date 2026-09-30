# Kiosk Sign-In — one front-desk tablet, a kiosk-only login, name-search attendance

**Status:** PR 1 (backend) MERGED to `develop` as #111 (2026-09-29). PR 2 (frontend) BUILT 2026-09-30 on
`feature/kiosk-signin-frontend`, pending owner local testing + review, not committed. Revision 2
replaced revision 1's CKQ-style device pairing with a dedicated low-privilege `kiosk` login (owner
decision 2026-09-29, §11). As-built notes: §12 (PR 1), §13 (PR 2). No data migration.

**Owner's ask (2026-09-29):** one tablet at the front desk. A student searches their name; if
their subscription is active their name shows; they tap it; the system asks "Are you X?" (a
setting decides whether that step exists); "X signed in" shows and disappears after ~5 seconds;
their attendance for the day is marked. Students must not be able to reach anything else in the
admin side from that tablet. Keep it simple — solve an attendance problem, nothing more.

---

## 0. Pre-reads (mandatory for the implementing agent — `CLAUDE.md` HARD RULES apply throughout)

| Before touching… | Read |
|---|---|
| Anything | `CLAUDE.md` (HARD RULES 1–12 — `write` is the only trigger; tests before commit; never auto-fix a failing test; explicit `git add`) |
| The `Visit` ledger, `markAttendance`, `addStudentToSession` | `docs/decisions/010-universal-visit-ledger.md`, `docs/features/admin.md` §Attendance, `backend/src/services/visit.service.js` (the ONLY writer of `Visit`) |
| Roles, `User.ROLES`, `/admin/users` | `backend/src/utils/roles.js`, `backend/src/services/user.service.js`, `docs/features/admin.md` §Users |
| `Setting` | `docs/features/admin.md` §Settings, `backend/src/services/setting.service.js` |
| Login / role redirect, admin shell | `docs/TESTING_STRATEGY.md` E2E section — `login.spec.ts` and `admin-shell.spec.ts` must be updated in the same PR (`CLAUDE.md` pre-read table) |
| Any test | `docs/TESTING_STRATEGY.md` (MSW at the network boundary; date rules; error-handling contract) |
| Any page / `.module.css` | `docs/design-system.md` (`Button`, `Alert`, `LoadError`, tokens only, anti-patterns, pre-merge checklist) |
| A new field or enum value | `DATABASE_SCHEMA_DOCUMENTATION.md` |

---

## 1. The design in one paragraph

An admin creates one user with the new role **`kiosk`** on `/admin/users` (email + password, like
a coach). Staff log that account in on the tablet once; it lands on `/kiosk` and can do exactly two
things: read the searchable student list, and sign a student in. The `kiosk` role is not an admin
role, so every admin page redirects it away and every admin endpoint answers 403 — "students can't
reach the admin side" is enforced by the server, not by trusting the tablet. On a tap, the server
finds the student's class today that hasn't ended and marks them present through the existing
attendance ledger, recording which account did it.

---

## 2. What Frisco already has (verified 2026-09-29)

- **Attendance ledger:** `Visit`, one row per student per session; `visit.service.js` is the only writer; `markAttendance(studentId, sessionId, scheduleId, classType, status, markedBy, markedVia)` upserts. Walk-ins (a student attending a sibling schedule of their class) get `isMakeupClass: true` via `addStudentToSession`; eligibility = an active `Subscription` on any schedule of the same `classId` (ADR 003 §5), computed by `getEligibleStudentsForSession`.
- **Attendance guard:** `assertSessionAcceptsAttendance(session)` — holiday check + "the session's day has started" (`isAttendanceOpen`, A-D1). Coach attendance stays whole-day.
- **Sessions:** `GroupClassSession { scheduleId, date (day sentinel), startsAt, endsAt }`; schedule → `classId` → `GroupClass { name, levelId, locationId }`.
- **Subscriptions:** `status: 'active'|'cancelled'`, at most one active per student (ADR 005). No payment-status field — a subscription in retry is still `active`.
- **Auth:** JWT in the httpOnly `accessToken` cookie (7 days, `utils/jwt.js` / `auth.controller.js`), `requireAuth` + `requireRole(...roles)`. Admin policy: `utils/roles.js` (`ADMIN_ROLES = ['admin','superadmin']`). Roles: `User.ROLES`. Login-capable roles: `user.service.js`'s `LOGIN_CAPABLE_ROLES`.
- **Frontend role plumbing:** `Role` type (`app/context/AuthContext.tsx` and `lib/types.ts`), `ROLE_LANDING_PATH` (`lib/constants.ts`, used by `/login` and `/`), `AppShell`'s `NAV_LINKS_BY_ROLE: Record<Role, …>`, `ProtectedRoute({ allowedRoles })` (unauthenticated → `/login`, wrong role → `/`), the admin layout's own admin/superadmin gate, `/admin/users`' `CREATABLE_ROLES` / `LOGIN_CAPABLE_ROLES` / role labels.
- **Login-only (no role) endpoints** — the complete list (`grep "requireAuth," src/routes | grep -v requireRole`): catalog reads (`/group-classes`, `/group-class-schedules`, `/levels`, `/locations`, `/prices` list + by id), `/group-class-sessions` reads (by-schedule, by-class, by id — the last includes roster names), `/auth/me`, and four session mutations (`PATCH …/attendance`, `GET …/eligible-students`, `POST …/students`, `DELETE …/students/:id`) that are gated in the service by `assertCoachOrAdmin`. **A `kiosk` account can therefore read exactly what any parent login already can, and nothing more** (K2).

---

## 3. Decisions

### K1 — A `kiosk` role, not device pairing
New role value `'kiosk'` on `User.ROLES`. It is login-capable (email + password) and **not** in `ADMIN_ROLES`. Created by an admin or superadmin on `/admin/users` like any coach account. No new model, no cookie other than the existing `accessToken`, no pairing code, no tablet-management page. (Revision 1's pairing is recorded in §11.)

### K2 — What the kiosk account can and cannot do (the security boundary)
- **Can:** `GET /kiosk/state`, `POST /kiosk/sign-in` (`requireRole('kiosk', ...ADMIN_ROLES)` — admins may use the page too, for testing or as a fallback).
- **Cannot:** any admin page (the admin layout redirects every non-admin role — existing behavior) and any admin endpoint (every one is `requireRole(...ADMIN_ROLES)` or `'superadmin'` — existing). Attendance/walk-in mutations reject it in the service (`assertCoachOrAdmin` — existing).
- **Can also read** the login-only endpoints in §2 — the same data any parent account already reads today. Not new exposure; noted so nobody is surprised. Tightening those reads for every role is a separate question, out of scope here.
- A regression test asserts the `kiosk` account gets 403 from a representative admin endpoint in each area (users, settings, subscriptions charge, holidays, audit runs) and from `PATCH /group-class-sessions/:id/attendance` (§5.5).
- **Recommended on the tablet anyway:** Guided Access (iPad) / a kiosk browser (Android/Fire) pinned to `/kiosk`, so the screen can't wander. It is no longer the security boundary — K2 is — just the tidy way to run a front-desk tablet.

### K3 — Who is searchable
Every student with an **active** `Subscription` (any schedule), plus anyone holding a non-cancelled `Visit` for a group session **today** (a trial student on their trial day, a coach-added walk-in). Subscription entries win on overlap (they carry the level name). Sorted by first, then last name. **Academy-wide**, not per location — Frisco has one location and the kiosk account has none; if a second location ever gets its own tablet, add a `locationId` to that account then (§9).
The tablet shows **no names until at least 2 characters are typed** (Mindbody's behavior — a front-desk screen that walk-in visitors can see shouldn't list every enrolled child by default).

### K4 — The server picks the session; no sign-in after the class ends
The tablet sends only a `studentId`. `resolveTodaySession(student, now)`:
1. Today's sessions (`date === todayDateOnly()`), none on an academy holiday.
2. **Eligible:** the student has a non-cancelled `Visit` for it, OR their active subscription is on its schedule, OR the walk-in rule allows it (`listWalkInEligibleStudents` — the one home of that rule, extracted from `getEligibleStudentsForSession`).
3. **Still open:** `!hasSessionEnded(session, now)` — exactly at `endsAt` still counts; arriving early on the day is fine.
4. **Pick:** the student's own-Visit session first, then the start nearest to `now`. No class picker on the tablet.
5. **Nothing:** `409 "<First> has no class today"` if step 2 found nothing; `409 "<First>'s class today has already ended"` if step 3 removed everything. Shown inline on the tablet.
The coach's page stays whole-day (a coach saw the student; a student can't self-mark after class). `hasSessionEnded` is a 3-line exported helper next to `isAttendanceOpen`; no other "started/ended" call site is refactored (§9).

### K5 — The mark reuses the ledger; the account that did it is recorded
`markKioskAttendance(studentId, sessionId, markedBy)` in `groupClassSession.service.js`: same holiday + day guard; already `attended` → `{ alreadySignedIn: true }`, no write; own Visit → marked on it with its `classType` kept (a trial stays `trial`); otherwise must pass the walk-in rule and is marked exactly like `addStudentToSession` (`isMakeupClass: true`), so a coach can undo it the same way. `markedVia: 'kiosk'`, **`markedBy: <the kiosk account's user id>`** (revision 1 had `null` — there was no user). The mark failing is an error on the tablet, never a false "signed in".

### K6 — Confirmation is a setting, default on
`Setting.kioskConfirmationRequired: Boolean, default true`, returned by `GET /kiosk/state` (so the tablet picks up a change on its next poll) and edited on the existing superadmin `/admin/settings` page. Off = tapping a name signs in immediately.

### K7 — The tablet page
`frontend/app/kiosk/page.tsx`, chrome-less (no `AppShell`), wrapped in `ProtectedRoute allowedRoles={['kiosk','admin','superadmin']}`. Phases: `loading` → `search` → `confirm` (skipped when `confirmationRequired` is false) → `signingIn` → `success` → back to `search` after `SUCCESS_DISMISS_MS = 5000` or a tap. Polls `GET /kiosk/state` every 30 s while on `search`, and on `visibilitychange`. A 401 mid-session (the 7-day login expired) → `router.push('/login?next=/kiosk')`. Search = case-insensitive `startsWith` on first or last name, ≥ 2 characters. Success card: "**{First Last} signed in**", class name, `formatTime(startTime)`–`formatTime(endTime)`; the `alreadySignedIn` variant: "**{First}, you're already signed in for today.**" No logout button on the page (a student shouldn't sign the tablet out); staff log out by visiting `/login`.

### K8 — Session length: the standard 7 days
The kiosk login lasts 7 days like everyone's; staff re-enter the password about weekly. A longer kiosk-only token is possible later (one branch in `jwt.js` + the cookie max-age) but is not built now (§10 open item).

### K9 — Two PRs, no migration
PR 1 backend, PR 2 frontend. One new enum value on `User.role`, one on `Visit.markedVia`, one `Setting` field with a default. Nothing to backfill.

---

## 4. PR 1 — backend (`feature/kiosk-signin-backend`, rework of the uncommitted revision-1 tree)

### 4.1 Delete (revision-1 files, never committed)
`src/models/kioskDevice.model.js`, `src/utils/kioskCredentials.js`, `src/middlewares/kioskDeviceAuth.js`, `tests/utils/kioskCredentials.test.js`, `tests/middlewares/kioskDeviceAuth.test.js`. Remove the device functions from `kiosk.service.js` (`toPublicDevice`, `createDevice`, `regeneratePairingCode`, `revokeDevice`, `listDevices`, `pairDevice`) and from the controller/routes; remove the `KioskDevice` section from `DATABASE_SCHEMA_DOCUMENTATION.md`.

### 4.2 `src/models/user.model.js` — MODIFY
`ROLES = ['student', 'parent', 'coach', 'admin', 'superadmin', 'kiosk']`, with a comment: the front-desk sign-in account (this plan, K1) — login-capable, not an admin role.

### 4.3 `src/services/user.service.js` — MODIFY
`LOGIN_CAPABLE_ROLES` gains `'kiosk'` (so create requires email + password, and password reset works). Delete: a `kiosk` user has no entity guard (like admin). Creating one: admin or superadmin (only superadmin is restricted today — unchanged).

### 4.4 `src/services/groupClassSession.service.js` — keep revision 1's additions, one change
Keep `hasSessionEnded`, `listWalkInEligibleStudents` (extracted, `getEligibleStudentsForSession` calls it), and `markKioskAttendance` — which gains a third parameter `markedBy` and passes it to `visitService.markAttendance` instead of `null`.

### 4.5 `src/services/kiosk.service.js` — REWRITE (sign-in half only)
- `getDirectory()` — K3, academy-wide: active subscriptions (student + schedule → class → level name) ∪ non-cancelled Visits for today's sessions; `role: 'student'` only; deduped; sorted.
- `getKioskState()` → `{ students, confirmationRequired, serverTime }`.
- `resolveTodaySession(student, now = new Date())` — K4, academy-wide (no location filter).
- `signIn(user, { studentId }, now = new Date())` — 400 malformed id, 404 not a student, K4 resolve, `markKioskAttendance(student._id, session._id, user._id)`, returns `{ student, session: { _id, className, startTime, endTime, coachName }, alreadySignedIn }` (`startTime`/`endTime` are the schedule's `"HH:mm"`, which `lib/formatTime.ts` takes).

### 4.6 `src/controllers/kiosk.controller.js` + `src/routes/kiosk.routes.js` — REWRITE
| Route | Guard | Body | Response |
|---|---|---|---|
| `GET /kiosk/state` | `requireAuth, requireRole('kiosk', ...ADMIN_ROLES)` | — | `{ students, confirmationRequired, serverTime }` |
| `POST /kiosk/sign-in` | same | `{ studentId }` | `{ student, session, alreadySignedIn }`; 400 / 404 / 409 (K4 messages) / 400 holiday-or-day guard / 403 not eligible |
No cookie handling of its own. `app.js` mount stays.

### 4.7 Kept unchanged from revision 1
`Visit.VISIT_MARKED_VIA` gains `'kiosk'`; `Setting.kioskConfirmationRequired` + `setting.service.js` get/update + validation.

### 4.8 Backend tests
- **Delete:** `tests/utils/kioskCredentials.test.js`, `tests/middlewares/kioskDeviceAuth.test.js`, and the device-management `describe` in `tests/services/kiosk.service.test.js`.
- **`tests/services/kiosk.service.test.js`** — keep every directory and sign-in test from revision 1 (they already pass `now` explicitly and were mutation-checked), adapted to the new signatures (no `device`; `signIn(kioskUser, …)`), and: `markedBy` equals the kiosk user's id; the "another location" case becomes "a subscriber at a second location is listed and can sign in" (academy-wide, K3) — or is dropped if the owner prefers per-location later.
- **`tests/routes/kiosk.routes.test.js`** — rewrite: a `kiosk` login reads state and signs in; the sign-in shows as present on `GET /group-class-sessions/:id`; admin and superadmin may use both endpoints; parent and coach get 403; no login gets 401; 409 message body; malformed id 400. **Plus the K2 lock-down test:** the kiosk login gets 403 from `GET /users`, `GET /settings`, `POST /subscriptions/:id/charge`, `POST /holidays`, `GET /audit-runs`, and `PATCH /group-class-sessions/:id/attendance`.
- **`tests/routes/user.routes.test.js`** (or `user.service.test.js`) — an admin can create a `kiosk` user with email + password; creating one without a password 400s (login-capable); a kiosk user can log in; deleting one has no guard.
- **`tests/utils/roles.test.js`** — must still pass (`ADMIN_ROLES` ⊂ `User.ROLES`); add an assertion that `hasAdminRole({ role: 'kiosk' })` is false.
- **Kept from revision 1:** `groupClassSession.service.test.js` additions (hasSessionEnded boundary, walk-in parity, guard 400s, 403 — `markKioskAttendance` calls gain a `markedBy`), `visit.service.test.js` (`'kiosk'` markedVia), `setting.routes.test.js`.
- Re-run the four mutation checks from revision 1 (`>=` boundary, no end cut-off, no own-session preference, no walk-in stamp) — each must fail a test.

### 4.9 PR 1 docs
`DATABASE_SCHEMA_DOCUMENTATION.md` (`User.role` gains `kiosk`; `Visit.markedVia` `kiosk` with `markedBy` = the kiosk account; `Setting.kioskConfirmationRequired`; no `KioskDevice`), ADR 012 rewritten to this design (§11 records the pairing detour), `docs/decisions/README.md` row, `CLAUDE_HISTORY.md`, `docs/TEST_COVERAGE.md` counts, this plan's status + as-built notes.

---

## 5. PR 2 — frontend (`feature/kiosk-signin-frontend`, stacked on PR 1)

### 5.1 Role plumbing (every `Record<Role, …>` must compile)
- `Role` gains `'kiosk'` in `app/context/AuthContext.tsx` **and** `lib/types.ts`.
- `lib/constants.ts` `ROLE_LANDING_PATH.kiosk = '/kiosk'` (so `/login` and `/` both send the tablet to `/kiosk`).
- `AppShell` `NAV_LINKS_BY_ROLE.kiosk = []`.
- `/admin/users`: `CREATABLE_ROLES` and `LOGIN_CAPABLE_ROLES` gain `'kiosk'`; role label **"Kiosk (sign-in tablet)"**; the `isRole` guard accepts it; a `kiosk` tab only if the page's tab list is role-driven (follow the page's existing pattern — do not add a bespoke tab).
- `e2e/fixtures/auth.ts` `Role` + `ROLE_LANDING_PATH` gain `kiosk`.

### 5.2 `lib/types.ts` + `lib/services/kiosk.ts`
Types: `KioskDirectoryEntry { studentId; firstName; lastName; levelName: string | null }`, `KioskState { students; confirmationRequired; serverTime }`, `KioskSignInResult { student; session: { _id; className; startTime; endTime; coachName }; alreadySignedIn }`; `Setting` gains `kioskConfirmationRequired`. Service: `fetchKioskState()` (query — throws), `kioskSignIn(studentId)` → `MutationResult<KioskSignInResult>` (never throws, `extractErrorMessage`).

### 5.3 `app/kiosk/page.tsx` + `kiosk.module.css`
Per K7. `Button`, `Alert` (`role="alert"` for sign-in errors), `LoadError` for a non-401 state failure, `next/image` for `/marketing/logo.svg`. Test ids: `roster-search`, `roster-row`. Rows ≥ 56 px (touch). Token-only CSS (`--color-*`, `--space-*`, `--radius-*`, `--font-heading`/`--font-body`); headings take the global `h1` size. No `localStorage`.

### 5.4 `app/admin/settings/page.tsx`
A "Kiosk" group under the fee fields: checkbox "Ask students to confirm their name on the sign-in tablet" (`id="kiosk-confirmation-required"`), hint "Off = tapping a name signs the student in immediately. The tablet picks up the change within 30 seconds." Saved by the existing single Save. Subtitle "Registration fee · Kiosk".

### 5.5 Frontend tests
- `lib/services/__tests__/kiosk.test.ts` — query rejects on error; mutation success/error branches.
- `app/kiosk/__tests__/page.test.tsx` — no rows before 2 characters ("Type your name to sign in"); filter by first-or-last `startsWith`; tap → confirm → "Not me" returns; "Yes" posts `{ studentId }` → success card → back to search after 5 s (fake timers); `confirmationRequired: false` posts on tap with no dialog; `alreadySignedIn` copy; 409 message inline and the search still works; 30 s poll picks up a flipped `confirmationRequired`; `visibilitychange` refetches; a non-401 failure → `LoadError` + retry; a 401 → redirect to `/login?next=/kiosk`.
- `app/admin/settings/__tests__/page.test.tsx` — checkbox reflects and saves the field.
- `/admin/users` test — a Kiosk account can be created (email + password required).
- `tsc --noEmit` 0 errors, `next build` green.

### 5.6 E2E
- `e2e/kiosk.spec.ts` (new, `loginAs(page, 'kiosk')`): type "av" → "Ava Student" → confirm → sign-in body `{ studentId }` asserted → success → `page.clock` +5 s → search again; confirmation off → no dialog; 409 → inline message.
- `login.spec.ts` — a `kiosk` login redirects to `/kiosk`.
- `admin-shell.spec.ts` — a `kiosk` login visiting `/admin/dashboard` is sent away (same shape as its existing non-admin test).

### 5.7 PR 2 docs
`docs/features/admin.md` (Users: the Kiosk role; Settings: the toggle; Attendance: `markedVia: 'kiosk'` rows and undoing a kiosk walk-in), `docs/design-system.md` (Page patterns: "Kiosk — chrome-less, token-only, touch-first"), `docs/TESTING_STRATEGY.md` E2E table, `docs/TEST_COVERAGE.md`, `CLAUDE.md` (documentation map + pre-read row for `/kiosk`), `CLAUDE_HISTORY.md`.

---

## 6. Revision-1 code on the branch today — keep / change / delete

| Revision-1 piece | Fate |
|---|---|
| `hasSessionEnded`, `listWalkInEligibleStudents`, `markKioskAttendance` | **Keep** (`markKioskAttendance` gains `markedBy`) |
| `Visit.markedVia` `'kiosk'`, `Setting.kioskConfirmationRequired` + service | **Keep** |
| `kiosk.service.js` directory + resolve + sign-in | **Keep, simplify** (academy-wide, no device) |
| `kiosk.controller.js`, `kiosk.routes.js` | **Rewrite** (2 routes, role guard, no cookie) |
| `KioskDevice` model, `kioskCredentials.js`, `kioskDeviceAuth.js`, device endpoints | **Delete** |
| Their tests (credentials, middleware, device `describe`, pairing route tests) | **Delete** |
| Every sign-in / directory / boundary test | **Keep, adapt** |
| ADR 012, schema doc | **Rewrite** to this design |

---

## 7. Rollout (owner)

0. **Hard dependency:** the weekly group-session generation cron (`docs/plans/deployment-launch-plan.md` follow-ups) is live — sessions only exist 8 weeks past a schedule's creation, and without today's session a student gets "has no class today". Until then, check today's sessions exist for every schedule that meets today.
1. `/admin/users` → Add User → role **Kiosk (sign-in tablet)**, e.g. `frontdesk@friscofencingacademy.com`, a strong password.
2. On the tablet, open the site and log in as that account → it lands on `/kiosk`.
3. Pin the tablet to that page (Guided Access / kiosk browser) and keep it on the charger. Don't let the browser clear cookies on exit.
4. About weekly, when the tablet shows the login page, a staff member logs back in (K8).
5. Staging check: sign a test student in → they show as present on the session's attendance page; sign in again → "already signed in", still one attendance row.

---

## 8. How this compares to facility check-in kiosks (Kicksite, Mindbody, Zen Planner)

| Standard behavior | Here |
|---|---|
| Name search | ✅ (≥ 2 characters before names show) |
| Confirm step | ✅ setting, default on (no photo — Frisco has no photo field) |
| Duplicate check-in is a no-op | ✅ one Visit per student per session |
| System resolves the class | ✅ K4 |
| Check-in closes when class ends | ✅ K4 (no opening window — early arrival on the day is fine) |
| Auto-return to the start screen | ✅ 5 s |
| Kiosk runs as a restricted staff "kiosk mode" login | ✅ K1/K2 — the same model Mindbody/Zen Planner use |
| Payment/membership alerts at check-in | ❌ deliberately — a lapsed subscriber just isn't listed |
| Family (multi-sibling) check-in | ❌ two siblings = two taps |

---

## 9. Out of scope

Per-location kiosks (add `locationId` to the kiosk account when a second location needs one); a longer kiosk-only login (K8); tightening the login-only read endpoints for all roles (K2); a `hasSessionStarted` helper or refactoring the existing `startsAt` comparisons (they are correct and tested; "started" and "ended" are two different rules); a class picker; sign-out / left-early; private-lesson sign-in; parent notifications of a sign-in.

---

## 10. Open items for the owner (defaults are built if unanswered)

| # | Question | Default |
|---|---|---|
| K3 | Trial students / walk-ins booked today are searchable too? | **Yes** |
| K3 | Hide the list until 2 characters are typed? | **Yes** |
| K3 | Academy-wide list (one location today)? | **Yes** |
| K6 | Toggle on the superadmin-only Settings page? | **Yes** |
| K7 | Admins may also use `/kiosk` (testing / fallback)? | **Yes** |
| K8 | Standard 7-day login (weekly re-login on the tablet)? | **Yes** |
| §7.0 | Session-generation cron ships before go-live? | **Yes — hard dependency** |

---

## 11. History — why revision 1 (device pairing) was dropped

Revision 1 ported CKQ's classroom-tablet pairing: a `KioskDevice` collection, an 8-character one-time pairing code, a hashed device secret in an httpOnly `ffa_kiosk` cookie, device auth middleware, and an admin "Kiosk Tablets" page. It was built and fully tested on 2026-09-29 (backend 84 suites / 1125 tests green; the Step-0 baseline was 80 / 1045), then the owner pointed out it was more than one front-desk tablet needs. CKQ needs pairing for a fleet of classroom tablets; Frisco has one. A dedicated `kiosk` login gives the same guarantee that mattered — the tablet cannot reach anything but attendance — using the login system that already exists, with no new collection, cookie, or admin page. Everything that was the attendance logic itself carries over unchanged (§6).

Lesson recorded: port a reference system's *goal*, then check whether its *mechanism* was sized for a different problem.

---

## 12. PR 1 as-built notes (revision 2, 2026-09-29)

- **Deleted** (never committed): `KioskDevice` model, `kioskCredentials.js`, `kioskDeviceAuth.js`, their two test files, the device-management tests, the pairing/cookie route tests; ADR 012 renamed to `012-kiosk-signin-kiosk-role.md` and rewritten.
- **Added:** `'kiosk'` on `User.ROLES` and `LOGIN_CAPABLE_ROLES`; `kiosk.routes.js` is two routes behind `requireRole('kiosk', ...ADMIN_ROLES)`; `markKioskAttendance(studentId, sessionId, markedBy)` records the tablet's account.
- **Tests:** `kiosk.service.test.js` (19 — directory, state, every K4 rule, academy-wide), `kiosk.routes.test.js` (6 — incl. `markedBy`, admin fallback, parent/coach 403, and the K2 lock-down: the kiosk login gets 403 from `GET/POST /users`, `GET/PATCH /settings`, `POST /subscriptions/:id/charge`, `POST /holidays`, `GET /audit-runs`, `PATCH …/attendance`), `user.routes.test.js` (+3: create kiosk account and log in, email+password required, delete with no guard), `roles.test.js` (`hasAdminRole` false for `kiosk`), plus revision 1's `groupClassSession`, `visit`, `setting` tests.
- **Full backend suite:** **82 suites / 1084 tests, all green** (`TZ=UTC npx jest`, Tue 2026-09-29 ~6:40 pm Central) — the Step-0 baseline 80 / 1045 plus 2 new suites and 39 new tests. One earlier full run that evening had **1 failure in `renewal.service.test.js`** (a file this PR does not touch); it passed 23/23 alone and the next full run was fully green. Its message wasn't captured. That run fell in the Tuesday-after-4-pm window `duplication-cleanup-status` memory flags for this exact suite (a real-clock Tuesday 16:00 class), so it is most likely that known, tracked flake — not a kiosk regression — but that is unproven; its fix belongs to duplication-cleanup PR D (a frozen clock), not here.
- **Mutation-checked:** the four sign-in mutations (boundary `>=`, no end cut-off, no own-session preference, no walk-in stamp) each fail a test. Wrongly adding `'kiosk'` to `ADMIN_ROLES` fails the 4 admin-gated lock-down cases by name (users list/create, holidays, coach attendance) while the 4 superadmin-only ones correctly stay 403; opening `PATCH /settings` to any login fails exactly its case.
- **CI fix (PR #111, first CI run):** the lock-down test first sent its 8 requests at once (`Promise.all`); on the CI runner one dropped (`read ECONNRESET`) — a test-design flaw, not a product one (every completed request was a 403). Rewritten as an `it.each` table, one sequential case per area (backend now **82 suites / 1091 tests, all green**), and the rule "concurrent requests only in a race test" added to `docs/TESTING_STRATEGY.md`'s Isolation rules. The other four `Promise.all`-over-requests tests in the suite were checked: each is a genuine race test, left as is.

## 13. PR 2 as-built notes (frontend, 2026-09-30)

- **Baseline** (clean `develop`): frontend Jest **65 suites / 530 tests**; E2E **36 passed + 2 known skips**.
- **After PR 2:** Jest **67 suites / 554 tests**, all green; E2E **41 passed + 2 known skips** (4 new kiosk tests incl. `login.spec.ts`'s kiosk case, 1 new `admin-shell.spec.ts` case); `tsc --noEmit` clean; `next build` succeeds (the E2E run builds it).
- **Built:** `kiosk` in both `Role` types, `ROLE_LANDING_PATH.kiosk = '/kiosk'`, `AppShell` entry; `/admin/users` offers **Kiosk (sign-in tablet)** (login-capable, no own tab); `lib/kiosk.ts` (timings + `MIN_SEARCH_LENGTH` — moved out of the page because an App Router page file may only export its component); `lib/services/kiosk.ts`; `app/kiosk/page.tsx` + token-only `kiosk.module.css`; the Settings checkbox; default `/kiosk/state` E2E mock.
- **Defects found while testing and fixed in this PR:** (1) a fetch loop — `loadState` depended on the router object, so any render that produced a new router re-ran the load effect (70 requests in a test whose mock router wasn't stable; Next's own router happens to be stable, but the page no longer relies on that — the router is held in a ref); (2) "Are you Ava Anderson ?" — a JSX line break put a visible space before the "?"; (3) the 2-character rule was encoded twice (the filter and the display branch), so breaking one was masked by the other — now one `searching` definition.
- **Mutation-checked:** min-length rule, ignoring the confirmation setting, no auto-dismiss, no poll, unhandled 401, and the fetch-loop regression each fail a test.
- **E2E note:** Next.js renders its own `role="alert"` route announcer, so an alert assertion must be filtered by text (`getByRole('alert').filter({ hasText })`).
- **Pre-existing, not fixed here:** `npx tsc --noEmit -p e2e/tsconfig.json` reports 5 `TS2740` errors (`@axe-core/playwright`'s `Page` type vs `@playwright/test`'s) in `admin-shell.spec.ts`, `calendar.spec.ts`, `public-site.spec.ts` — identical on `develop` without this PR. The app's own `tsc --noEmit` doesn't cover `e2e/`, so CI doesn't see them.
