# Premium Registration & Attendance Plan (Track 2)

Re-architects group-class registration around Frisco's real billing model — one flat monthly fee per level, attend any scheduled session of that level — and introduces the attendance ledger (`Visit`) and trial-evaluation (`Evaluation`) models that model requires. Everything here is verified against both codebases directly (`backend/src/` in this repo, `chesskqwebsite/backend/backend-2.0/src/` locally) during the planning conversation on 2026-08-24 — no field, function, or behavior below is assumed.

Follows [ADR 001](../decisions/001-in-house-subscription-billing.md)'s billing model unchanged (Stripe charges a saved card, never Stripe Subscriptions; renewal is our own job with the same three safeguards). This plan does not touch billing math, Stripe integration, or the renewal job's charge logic — only *what a Subscription points at* and *how attendance is tracked*.

---

## 0. Locked decisions (do not reopen)

1. **No `classId` field, no schedule array, on `Registration`/`Subscription`.** `scheduleId` stays exactly as it is today — required, single ref. Verified directly against CKQ's `Subscription` model: even their premium tier keeps `schedule` as one ref plus a separate `homeSchedule` ref, never an array.
2. **`Visit` and `Evaluation`** — same names as CKQ, trimmed of everything chess/curriculum-specific (no `Service` abstraction, no `Homework`/`Lesson`/`MaterialCollection` refs, no `serviceId`). Fencing has no curriculum system yet, so none of that ports.
3. **`Visit` covers group classes and trials only.** Private lessons keep their existing `PrivateClassSession`/`PrivateClassCharge` system, untouched.
4. **`changeSchedule` is blocked outright** once a subscription is premium — there is no "different schedule" to move to when every subscriber already attends any session of their level. No CKQ-style rate-lock reasoning needed (Frisco's price is flat per level, not per schedule); the block is simply "nothing to change."
5. **No attendance data migration.** Nothing has been marked yet in production/staging — `Visit` starts clean from the first session marked after this ships.
6. **The premium flag is a backend rollback lever, not a live user-facing toggle.** `ENABLE_SCHEDULE_BASED_REGISTRATION` (env var, unset/`false` = premium mode — the live default). The frontend does not read this flag at runtime; it always shows the premium-oriented copy. Flipping the flag back on is a deliberate future deploy decision (a real business change: "we're introducing a non-premium tier again"), not a runtime setting.
7. **The cross-schedule "who can attend as a walk-in" picker is NOT gated on `isPremium`.** Verified directly against CKQ's `getStudentsByLevel`: it returns every student with an *any* active, paid subscription at that level — no premium check. `isPremium` in CKQ only gates student-facing self-service surfaces (dashboard, live-video-room join) that Frisco doesn't have. Frisco's equivalent picker follows the same "any active subscriber at this level" rule.
8. **No soft-delete (`isActive`/`isDeleted`) convention on the new models.** CKQ uses it throughout; Frisco doesn't use that pattern anywhere in its own models (`Registration.status`, `PrivateClassEnrollment.status`, etc. use explicit status enums instead). `Visit.status` and a hard-delete-free `Evaluation` (edit instead of delete) match Frisco's existing convention, not CKQ's.

---

## 1. New model — `backend/src/models/visit.model.js`

Replaces `GroupClassSession.students[].isPresent` as the source of truth for attendance. Verified against CKQ's `visit.model.js` and `visit.service.js` directly; trimmed to what Frisco actually needs.

```js
const visitSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    groupClassSessionId: { type: Schema.Types.ObjectId, ref: 'GroupClassSession', required: true },
    // Denormalized (matches CKQ) — every roster/history query needs "this
    // student's visits for this schedule" without a session lookup first.
    groupClassScheduleId: { type: Schema.Types.ObjectId, ref: 'GroupClassSchedule', required: true },
    classType: { type: String, enum: ['regular', 'trial'], required: true },
    status: { type: String, enum: ['scheduled', 'attended', 'missed', 'cancelled'], default: 'scheduled' },
    markedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    markedVia: { type: String, enum: ['coach', 'admin'], default: null },
    // Set only by addStudentToSession (§3.6) — distinguishes a walk-in from
    // a real roster student for removeStudentFromSession's guard, exactly
    // matching CKQ's isMakeupClass field/comment.
    isMakeupClass: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One Visit per (student, session) among non-cancelled records — a cancelled
// one can be superseded by a fresh upsert (see upsertScheduledVisits).
visitSchema.index({ studentId: 1, groupClassSessionId: 1 });
visitSchema.index({ groupClassSessionId: 1, status: 1 });
visitSchema.index({ studentId: 1, groupClassScheduleId: 1 });
```

No unique index on `(studentId, groupClassSessionId)` — CKQ doesn't have one either (its uniqueness is enforced entirely in `visit.service.js`'s upsert logic, `filter: { student, 'groupClass.sessionId': sessionId }`), and a real unique index would reject the legitimate "cancelled → re-scheduled" transition `upsertScheduledVisits` performs as a second `updateOne`.

---

## 2. New model — `backend/src/models/evaluation.model.js`

The trial-assessment record Frisco has zero equivalent of today (`TrialClass` is booking-only — confirmed, no "evaluat" anywhere in the backend before this plan).

```js
const evaluationSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    coachId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    groupClassSessionId: { type: Schema.Types.ObjectId, ref: 'GroupClassSession', required: true },
    assignedLevelId: { type: Schema.Types.ObjectId, ref: 'Level', required: true },
    notes: { type: String, required: true, maxlength: 1000 },
  },
  { timestamps: true }
);

// Backstop behind the service-layer pre-check (evaluation.service.js's
// createEvaluation) — same two-layer pattern trialClass.service.js already
// uses ahead of TrialClass's own unique index. CKQ has no equivalent index
// (pre-check only); this is a deliberate improvement matching Frisco's own
// established convention, not a CKQ gap being copied forward.
evaluationSchema.index({ studentId: 1, groupClassSessionId: 1 }, { unique: true });
```

No `isActive`/`isDeleted` — a wrong evaluation gets corrected via `PATCH`, matching decision #8.

---

## 3. Backend service changes

### 3.1 `backend/src/services/visit.service.js` (new)

Mirrors `chesskqwebsite/backend/backend-2.0/src/services/visit.service.js` function-for-function, adapted to Frisco's style (custom `Error` + `.status`, no Joi, camelCase `studentId`/`groupClassSessionId` field names instead of CKQ's `student`/`groupClass.sessionId` nesting):

- `upsertScheduledVisits(studentId, sessions, classType)` — `sessions: [{ sessionId, scheduleId }]`. Bulk upsert: creates `status: 'scheduled'` where no non-cancelled Visit exists; reactivates a `cancelled` one back to `scheduled`. Idempotent (`bulkWrite`, `ordered: false`), matching CKQ.
- `createScheduledVisit(studentId, sessionId, scheduleId, classType)` — single-session convenience wrapper.
- `markAttendance(studentId, sessionId, scheduleId, classType, status, markedBy, markedVia)` — upserts to `attended`/`missed`.
- `markAsMakeupClass(studentId, sessionId)` — separate targeted update, called only by `addStudentToSession` (§3.6), exactly matching CKQ's own comment about why this is deliberately not a `markAttendance` parameter (so a later "mark missed" call can never accidentally clear it).
- `cancelVisitsForStudent(studentId, sessionIds)` — bulk set `status: 'cancelled'`.
- `getActiveVisitsForSession(sessionId)` — non-cancelled Visits, populated with student name — this is what a session's roster display now reads instead of the old `session.students`.
- `getVisitsByStudent(studentId)` — attendance history.

### 3.2 `backend/src/models/groupClassSession.model.js` (modify)

**Remove the `students` field entirely.** A session becomes just `scheduleId` + `date` — attendance lives in `Visit`, roster/eligibility is computed live. This is the one schema removal in this plan (nothing to migrate, per decision #5).

### 3.3 `backend/src/services/groupClassSession.service.js` (modify)

- `generateInitialSessions(schedule)` — drop the `studentsSnapshot` logic entirely (no more seeding `session.students` from `schedule.students` — that snapshot concept goes away with the field).
- `getById(id)` — replace `.populate('students.studentId', ...)` with a call to `visitService.getActiveVisitsForSession(id)`, merged into the returned shape as `session.roster` (or however the route response is shaped — kept as a service-return concern, not a schema field).
- `markAttendance(sessionId, studentUpdates, requestingUser)` (rewrite) — same permission logic (admin OR the session's assigned coach), but the "student must already be on the roster" rule changes to match CKQ's `updateStudentAttendance` exactly: for each `studentId` in `studentUpdates`,
  1. If a non-cancelled `Visit` already exists for `(studentId, sessionId)` → upsert its status via `visitService.markAttendance(...)`.
  2. Else, check for an active `Subscription` on `studentId` for *this session's own schedule* (`schedule.students` roster membership) — if found, this is a student whose scheduled Visit somehow wasn't pre-created (shouldn't normally happen once §3.4/§3.7 are in place, but matches CKQ's defensive fallback) → create the Visit via `markAttendance`. Confirmed there is no group-class equivalent of `scripts/extend-private-sessions.js` (`generateInitialSessions` runs exactly once, at schedule creation, generating 8 weeks — a pre-existing gap this plan doesn't introduce or fix), so this branch is a genuine defensive fallback, not something a known Frisco mechanism actively exercises today.
  3. Else → 400 `"Unknown studentId: not on this session's roster — use Add Student to add a walk-in first"` (mirrors today's exact error, just re-scoped to Visit-backed data).

### 3.4 New endpoints on `groupClassSession.service.js`

- `getEligibleStudentsForSession(sessionId)` — the `getStudentsByLevel` equivalent (decision #7: **not** premium-gated). Resolves the session's schedule → `classId` → every `GroupClassSchedule` under that same class → every student with an active, paid `Subscription` on any of those schedules → excludes anyone already having a non-cancelled Visit for this session, and anyone already on *this* session's own schedule roster (they're already shown via the regular attendance list).
- `addStudentToSession(sessionId, studentId)` — validates the student is in the eligible list above (a real check, not just trusting the caller), then `visitService.markAttendance(..., 'attended')` + `visitService.markAsMakeupClass(...)`. Same admin-or-assigned-coach permission as `markAttendance`.
- `removeStudentFromSession(sessionId, studentId)` — finds the Visit, 400s if `classType === 'trial'` ("use trial cancellation instead" — no such endpoint exists yet in Frisco; noted as a gap, not built here since Frisco has no trial-cancel flow today either) or if `!isMakeupClass` ("cannot remove an enrolled student this way"), else cancels it.

### 3.5 `backend/src/services/roster.service.js` (modify)

`addStudentToRoster(schedule, studentId, today)` / `removeStudentFromRoster(schedule, studentId, today)` currently mutate `schedule.students` **and** every future `GroupClassSession.students` entry directly. With `GroupClassSession.students` gone:
- `schedule.students` mutation stays exactly as today (the roster array survives — still needed for capacity checks and "whose home schedule is this").
- The future-sessions loop changes from mutating `session.students` to calling `visitService.upsertScheduledVisits`/`visitService.cancelVisitsForStudent` for that schedule's already-generated future sessions instead. Same callers (`registration.service.js`, `subscription.service.js`'s `changeSchedule` — see §3.8, `renewal.service.js`), same function signatures — internals only.

### 3.6 `backend/src/services/registration.service.js` (modify)

- `create()` — after the existing `Registration`/`Subscription` creation and `addStudentToRoster` call (unchanged structurally — still one schedule, one price lookup, one Stripe charge, exactly as today), set `subscription.isPremium = process.env.ENABLE_SCHEDULE_BASED_REGISTRATION !== 'true'` at creation.
- Nothing else in this function changes — no new required field on the request body, no new Stripe idempotency key shape (still `initial-registration-${studentId}-${scheduleId}`, since the schedule is still the real anchor).

### 3.7 `backend/src/services/trialClass.service.js` (modify)

`create()` currently does `session.students.push({ studentId, isPresent: false })` directly. Replace with `visitService.createScheduledVisit(studentId, sessionId, session.scheduleId, 'trial')`.

### 3.8 `backend/src/services/subscription.service.js` (modify)

`changeSchedule(subscriptionId, newScheduleId)` — add, as the very first check after loading the subscription:

```js
if (subscription.isPremium) {
  throw conflictError('Premium subscriptions attend any scheduled session — there is no schedule to change.');
}
```

Everything below that line stays as today's exact logic (still exercised whenever `ENABLE_SCHEDULE_BASED_REGISTRATION=true` produces a non-premium subscription) — including its own `updateVisitSession`-equivalent step, added alongside the existing roster move: after `removeStudentFromRoster(oldSchedule, ...)` / `addStudentToRoster(newSchedule, ...)`, also call a small `visitService.updateVisitSession(studentId, oldSessionIds, newSessionId)`-style helper so a non-premium student's already-scheduled Visits move with them (mirrors CKQ's `updateVisitSession`). Only reachable in schedule-based mode, since premium subscriptions never reach this code path at all now.

### 3.9 `backend/src/services/renewal.service.js`

No functional change beyond what §3.5's `roster.service.js` update already covers — the cancellation-finalize path already calls `removeStudentFromRoster`, which now also cancels the student's remaining scheduled Visits for free.

### 3.10 New — `backend/src/services/evaluation.service.js`, `controllers/evaluation.controller.js`, `routes/evaluation.routes.js`

Mirrors `chesskqwebsite/backend/backend-2.0/src/services/evaluation.service.js`'s `createEvaluation` logic exactly (verified line-by-line), Frisco-styled:

- `create({ studentId, groupClassSessionId, assignedLevelId, notes }, requestingUser)` — `coachId` is **never** a client-supplied field, always `requestingUser._id` (verified against CKQ's controller: `{ ...req.body, coach: req.user.id }` — the spread order means any body-supplied `coach` is silently overridden, not merely defaulted). Even an admin evaluating on a coach's behalf is recorded as evaluated by that admin, not by the coach — matches CKQ exactly, not a Frisco deviation.
  1. Student exists and `role === 'student'`.
  2. Coach exists and `role` is one of `coach`/`admin`/`superadmin`.
  3. Session exists.
  4. Level exists.
  5. An `attended` `Visit` exists for `(studentId, groupClassSessionId)` — else 400 "Cannot evaluate a student who was not present."
  6. If `requestingUser.role === 'coach'`: must be the session's assigned coach (`schedule.coachId === requestingUser._id`) AND the attended Visit's `classType` must be `'trial'` — else 403. `admin`/`superadmin` unrestricted (matches CKQ exactly).
  7. One evaluation per `(studentId, groupClassSessionId)` — 409 if one already exists (backed by §2's unique index).
  8. Create, then fire-and-forget `mailService.sendTrialEvaluationEmail({ parent, student, coach, level, notes })` (new template, same try/catch-never-throws contract as every other send in `mail.service.js`).
- `getByStudent(studentId)`, `getById(id)`, `update(id, { assignedLevelId, notes }, requestingUser)` (same coach-owns-it-or-admin restriction), no `delete` (decision #8 — an admin corrects via `update`).

Routes: `requireAuth` + `requireRole('coach', 'admin', 'superadmin')` at the route level (the fine-grained "only *this* session's coach, only for a trial" check stays in the service — same reasoning `groupClassSession.routes.js`'s own comment already gives for `markAttendance`).

### 3.11 `backend/src/services/mail.service.js` (modify)

Add `sendTrialEvaluationEmail({ parent, student, coach, level, notes })` — same `sendMailSafely` wrapper every other function here uses, same staging-gate behavior (`docs/modules/email.md`).

---

## 4. The flag

`ENABLE_SCHEDULE_BASED_REGISTRATION` — unset or `'false'` (the live default): `Subscription.isPremium = true` on every new registration, `changeSchedule` blocked, walk-in attendance available. Set to `'true'`: exact today's-behavior schedule-based flow, `isPremium = false`, `changeSchedule` works, no walk-in eligibility check needed (though `addStudentToSession`/`getEligibleStudentsForSession` still function correctly regardless — they were never gated on the flag or on `isPremium`, per decision #7, so nothing breaks either way). Documented in `backend/.env.example` alongside `APP_ENV`'s existing gate comment style.

---

## 5. Frontend changes

- **`frontend/app/parent/register/page.tsx`** — relabel the "Choose a schedule" `FlowSection` title to "Choose your preferred class time," with a line of copy under the select: "You're enrolling in the full {level} program — you can attend any of its scheduled sessions. Pick one as your usual time." `createRegistration({ studentId, scheduleId })` payload is unchanged (§3.6 confirmed no new required field).
- **`/admin/subscriptions`** — Change Schedule action hidden (or shown disabled with a tooltip) on any row where `subscription.isPremium` is true; `docs/features/admin.md`'s Subscriptions section updated to say so.
- **`/sessions/[id]/attendance`** (shared coach/admin page) — reads the new roster shape (`Visit`-backed, from `getById`'s updated response) instead of `session.students`; adds an "Add Student" action opening a small picker fed by `getEligibleStudentsForSession`, calling `addStudentToSession`; a walk-in row gets a "Remove" action calling `removeStudentFromSession` (never shown for a non-`isMakeupClass` row).
- **`/coach/schedules/[id]/sessions`, `/admin/schedules/:id/sessions`** — the "Students" count column now comes from the roster-shape response above instead of `session.students.length`.
- **`/parent/child/[id]`'s Schedule tab** — currently shows "the recurring day/time pattern" for the subscription's one `scheduleId` (per `docs/features/parent-portal.md`). For a premium subscription, extend this to show every schedule under the same class ("Attends any of: Tue 7-8:30pm, Wed 6-8pm, Fri 6-8:30pm, Sat 10:30-1pm"), fetched via the class's schedules the same way the register wizard already does.
- **Evaluation UI** — a coach/admin marking a `trial`-classType Visit `attended` on the attendance page gets an inline "Evaluate" action (level `<select>` + notes `<textarea>`, `POST /evaluations`). No standalone `/admin/evaluations` list page in this pass — deferred, backend-first (flagged in §7).
- **`frontend/lib/types.ts`** — add `Visit`, `Evaluation` types; `GroupClassSession` drops `students`; `Subscription` gains `isPremium: boolean`.

---

## 6. Tests

- `backend/tests/services/visit.service.test.js` (new, `mongodb-memory-server`) — upsert/reactivate/idempotency, `markAsMakeupClass` isolation from a later `markAttendance` call (the exact regression CKQ's own comment calls out).
- `backend/tests/services/evaluation.service.test.js` (new) — the attended+trial gate, coach-owns-session restriction, admin unrestricted, duplicate-evaluation 409.
- `backend/tests/services/groupClassSession.service.test.js` (rewrite) — `markAttendance`'s three-branch logic (§3.3), `addStudentToSession`/`removeStudentFromSession`/`getEligibleStudentsForSession`, including the "not premium-gated" property from decision #7 as an explicit regression test.
- `backend/tests/services/registration.service.test.js` (extend) — `isPremium` set correctly per the flag.
- `backend/tests/services/subscription.service.test.js` (extend) — `changeSchedule` 409s for a premium subscription, still works for a non-premium one.
- `backend/tests/services/trialClass.service.test.js` (extend) — creates a scheduled `Visit` instead of touching `session.students` (field no longer exists).
- `backend/tests/services/roster.service.test.js` (extend) — the Visit-upsert/cancel behavior on the future-sessions loop.
- Frontend: `register/__tests__/page.test.tsx` (copy change), `admin/subscriptions/__tests__/page.test.tsx` (Change Schedule hidden for premium), `sessions/[id]/attendance/__tests__/page.test.tsx` (walk-in picker), new evaluation-form test.

---

## 7. Phased delivery

1. **Phase 1 — Attendance ledger.** `Visit` model + `visit.service.js` + `groupClassSession.model.js`/`.service.js` rewire + `roster.service.js` internals + `trialClass.service.js` cutover. No user-facing change yet beyond the attendance page's new data source — this phase is purely "replace the roster-snapshot mechanism," independent of premium.
2. **Phase 2 — Trial evaluation.** `Evaluation` model + service/controller/routes + mail template + the attendance-page inline Evaluate action.
3. **Phase 3 — Premium itself.** `Subscription.isPremium` + the flag + `changeSchedule` block + `addStudentToSession`/`removeStudentFromSession`/`getEligibleStudentsForSession`.
4. **Phase 4 — Frontend polish.** Register wizard copy, admin Change-Schedule hiding, child-detail Schedule tab's multi-session display.

Phase 1 is the real foundation — Phases 2 and 3 both depend on `Visit` existing. Phase 3 is where "premium" actually takes effect; Phases 1-2 are valuable and shippable on their own regardless of premium timing.

---

## 8. Docs to update (same run, final commit of each phase)

- `docs/features/admin.md` — Subscriptions' Change Schedule behavior, Sessions/attendance page's new walk-in picker.
- `docs/features/parent-portal.md` — Register wizard copy, child-detail Schedule tab.
- A new ADR (`docs/decisions/003-...md`) documenting the premium billing decision itself, once Phase 3 ships — not written in this pass since the user asked specifically for the plan doc; recommended as a immediate follow-up once Phase 3 is real.

---

## 9. Out of scope (explicitly)

- Private-class attendance unification with `Visit` (decision #3).
- Any curriculum/lesson/homework tracking (`Lesson`, `MaterialCollection`, `Homework`, `HomeworkResult` — none of it ports; fencing has no curriculum system).
- Live-video-room / liveboard equivalent (Frisco is in-person only).
- A standalone `/admin/evaluations` report page (deferred past this plan).
- Trial cancellation endpoint (doesn't exist in Frisco today; `removeStudentFromSession`'s trial guard just documents the gap, doesn't close it).
- Attendance data migration/backfill (decision #5 — nothing exists to migrate).
