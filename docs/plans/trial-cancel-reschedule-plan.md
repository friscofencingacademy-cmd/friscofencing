# Trial Cancel and Reschedule

**Status (2026-10-28):** PR 1 (backend) MERGED to `develop` as #145; PR 2 (frontend + live gate)
shipped to `develop` the same day at the owner's request — the owner tests on staging. Not in
production; the live gate has not run yet (rollout §3). Live gate: `trial-cancel-reschedule` (`docs/live-gates/trial-cancel-reschedule.md`,
`audit/gates/trial-cancel-reschedule.js`).

**Owner request (2026-10-28):** a parent who scheduled a trial can **cancel** it (back to square
one) or **reschedule** it (back to the wizard with the child chosen, picking level and time
again). Both are offered only before the trial class starts.

---

## 0. Why this is not frontend-only (measured 2026-10-28 against `develop` at `193cd58`)

- `trialClass.routes.js` had two routes: `POST /` (book) and `GET /mine`. Nothing could cancel or
  move a trial.
- A trial is two records: a `TrialClass` row (unique on `studentId`, the one-trial-ever rule) and
  a roster `Visit` (`classType: 'trial'`) on the session. Cancelling must remove the row, or the
  child stays "Trial already booked" forever, and must cancel the Visit, or the child stays on the
  coach's roster.
- `enrollment.trial` (from #140) carried only `startsAt`/`endsAt`, no id to act on.
- A frontend "cancel then book" reschedule could lose the original trial when the new booking
  fails (session started meanwhile, holiday, deleted session). One server call that checks the new
  session first cannot.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | `DELETE /trial-classes/:id` cancels, `PATCH /trial-classes/:id { sessionId }` reschedules. The child's own parent or an admin (403 otherwise; coach, student and kiosk are refused by the role check). No admin buttons this round. |
| D2 | **One rule decides "can this trial still change?"**: `trialClass.service.js`'s `trialChangeBlocker({ session, visitStatus, now })`. Refused when the session is gone (400), its start instant has passed (400 — `startsAt` vs a real `now`, never a day compare), or its Visit is already marked `attended`/`missed` (409). The last case is real: attendance opens at the start of the class's calendar day and the kiosk signs students in before class, so a trial can be marked before it starts. The portal reads the same rule as `enrollment.trial.canChange`, so the buttons never show for a change the server would refuse. |
| D3 | **The `TrialClass` row is the claim; the roster follows it.** Each change first writes the row conditionally on the session its checks ran against (`findOneAndDelete` / `findOneAndUpdate` filtered on `{ _id, sessionId: old }`), so of two racing changes only one wins and the other gets 409 `This trial was just changed somewhere else — reload the page and try again`. Then the roster is reconciled to the row: `visit.service.js`'s `cancelStaleTrialVisits(studentId, keepSessionId)` cancels every still-`scheduled` trial Visit of the child not on the row's current session (read fresh). Marked Visits are never touched. Because each change reconciles after its own writes, racing changes converge on the row's final state (two concurrent-request tests prove it). |
| D4 | **Reschedule checks everything before writing anything**: the trial may still change (D2), the new session exists (404), has not started (400), is not on a holiday (400), and is not the one already booked (400). These are booking's own checks, shared through `loadBookableSession`. After the claim, a late attendance mark (between the checks and the claim) undoes the claim and refuses with 409; a failed write of the new Visit undoes the claim and rethrows. The old Visit is only cancelled by the final reconcile, so every failure leaves the original trial exactly as it was. |
| D5 | Cancel sends **no email** (owner decision). Reschedule sends the new `trialRescheduled` email (new date, the date it moved from, same recipients as the confirmation: the family, cc admin + the new class's coach). Both trial emails go to the **family's** parent, never the requesting admin (booking used to send the admin's own address on an admin booking; fixed). The confirmation email's footer now says the trial can be rescheduled or cancelled from the dashboard. |
| D6 | Unlimited reschedules, each before the class starts. A cancelled trial frees the one-trial-ever slot, so the child can book again from scratch. |
| D7 | `enrollment.trial` becomes `{ _id, sessionId, startsAt, endsAt, canChange }` (`UpcomingTrial` in `lib/types.ts`), still only while `status === 'trial_scheduled'`. `sessionId` lets the reschedule picker leave out the class the trial is already in. One extra batched `Visit` query per household (`getActiveGroupVisitStatusByPair`), never per child. |
| D8 | Frontend: one shared `app/components/portal/TrialActions/` (Reschedule link + Cancel confirm in the shared `Modal`) used by the dashboard card and the child page's Trial Class card. The wizard's reschedule mode is `/parent/book-trial?reschedule=<studentId>`: the child is fixed (one card, chosen, with `Currently <day · time>`), the wizard starts at the level, the current class is not offered, the CTA and title read `Reschedule Trial`, and success reads `Trial class rescheduled!`. A stale link (trial gone, started, or marked) explains why instead of falling back to booking. |
| D9 | Live gate `trial-cancel-reschedule` is `mutates: true` (book, move, cancel; no money) on a **new dedicated audit family** `audit-trial-parent@example.com` / `Audit TrialChild` added to `AUDIT_FAMILIES`. A read-only gate cannot work: the weekly live audit books `Audit ChildOne`'s trial and then enrolls the same child, so no audit child keeps an upcoming trial. The gate ends with no trial on file, so it can run again; `npm run audit:reset` also clears it. |

## 2. Files

**PR 1 — backend**
- `backend/src/services/trialClass.service.js` — `cancel`, `reschedule`, `trialChangeBlocker`, `loadBookableSession` (shared with `create`), `sendTrialEmail` (family parent).
- `backend/src/controllers/trialClass.controller.js`, `backend/src/routes/trialClass.routes.js` — `PATCH`/`DELETE /:id`.
- `backend/src/services/visit.service.js` — `cancelStaleTrialVisits`, `getActiveGroupVisitStatusByPair`.
- `backend/src/services/student.service.js` — `enrollment.trial` gains `_id`, `sessionId`, `canChange`.
- `backend/src/services/mail.service.js`, `backend/src/email/templates.js`, `backend/src/email/sampleData.js` — `trialRescheduled`.
- `backend/scripts/lib/seedAuditFixtures.js` — the gate family (D9).
- Tests: `tests/routes/trialClass.routes.test.js` (every refusal leaves the trial unchanged; the race-only branches pinned by a call-through spy; two concurrent-request races), `tests/services/{visit,student,mail}.service.test.js`, `tests/scripts/lib/{seedAuditFixtures,refreshStagingData}.test.js` (fixture counts).

**PR 2 — frontend + gate**
- `frontend/lib/types.ts` (`UpcomingTrial`), `frontend/lib/apiResponses.ts` (`TrialClassResponse`, `SuccessResponse`), `frontend/lib/services/parent.ts` (`rescheduleTrialClass`, `cancelTrialClass`).
- `frontend/app/components/portal/TrialActions/` (new), `frontend/app/parent/dashboard/page.tsx` (+ `.childCard` wraps on a phone), `frontend/app/parent/child/[id]/page.tsx`, `frontend/app/parent/book-trial/page.tsx`.
- Tests: `TrialActions/__tests__`, the dashboard, child page and book-trial page suites (fixtures now typed `Student`), `lib/services/__tests__/parent.test.ts`, new `frontend/e2e/trial-change.spec.ts` (desktop and phone; added to the `mobile-chrome` project).
- `docs/live-gates/trial-cancel-reschedule.md`, `audit/gates/trial-cancel-reschedule.js`.

## 3. Rollout

1. Merge PR 1, then PR 2, to `develop`.
2. On staging, run `cd backend && npm run audit:seed` once so the gate family exists (the weekly
   live-audit workflow's seed also creates it).
3. Run the gate with the owner watching: `cd audit && npm run gate -- trial-cancel-reschedule --headed --allow-writes`.
4. Promote to `main` only after a `result: pass` record exists (owner rule, 2026-10-27).

No migration: existing `TrialClass` rows and Visits need no change.
