# Implementation plan: orphaned coach references crash multiple pages

**Status:** Approved for implementation. Written 2026-08-27 after live-reproducing the reported
`/private-classes` crash. **Builder: intended for a Sonnet implementation session.** See §7
(Builder instructions) before touching any file.

---

## 0. The bug, confirmed live

```
GET https://friscofencing-backend-git-develop-frisco-fencing.vercel.app/api/v1/private-class-schedules/public
→ 500 {"message":"Cannot read properties of null (reading '_id')"}
```

A `PrivateClassSchedule` document in the staging database references a coach (`coachId`) that no
longer exists in the `User` collection. When `backend/src/services/privateClassSchedule.service.js`'s
`listPublic()` (lines ~111-129) populates `coachId` and the referenced user is gone, Mongoose sets
that field to `null`. The code then does `schedule.coachId._id` unconditionally — throwing exactly
the error above. The frontend's `useLoadState` hook is behaving correctly: it turns any non-4xx
failure into the generic "Something went wrong" message by design
(`frontend/lib/hooks/useLoadState.ts`) rather than showing a raw error. **The bug is entirely
backend-side.**

**Root cause:** `user.service.js`'s coach-delete guard (`remove()`) only counts `GroupClassSchedule`
before allowing a coach to be deleted. It never checks `PrivateClassSchedule`, `CoachContract`, or
`PrivateClassEnrollment` — all of which also carry a `coachId` reference. A coach with private-lesson
data could be deleted anyway, orphaning every document that pointed at them.

**This is not just the one page.** The same "populate a ref, then assume it's non-null" pattern
exists in five backend read paths and surfaces in at least six frontend display spots — see §1.
The fix needs to be systemic, not a single patch, which is why this plan exists instead of a
one-line diff.

---

## 1. Full audit of every `coachId` populate (backend) and every consumer (frontend)

| # | Backend populate site | Semantic role | Frontend consumer | Currently null-safe? |
|---|---|---|---|---|
| 1 | `groupClassSchedule.service.js`'s `listPublic()` | Public booking availability | (public group-class page) | **YES — already filters out `!schedule.coachId` rows.** This is the reference precedent D1 below copies. |
| 2 | `privateClassSchedule.service.js`'s `listPublic()` | Public booking availability | `app/private-classes/page.tsx` | **NO — this is the confirmed crash.** |
| 3 | `privateClassSchedule.service.js`'s `listAll()` | Admin schedule management | `app/admin/private-classes/page.tsx` (Schedules tab, `coachLabel()` line ~171) | NO |
| 4 | `privateClassEnrollment.service.js`'s `populateEnrollment()` (used by `listMine`/admin list) | Parent billing history / admin enrollment management | `app/parent/subscriptions/page.tsx:96`, `app/admin/private-classes/page.tsx` (Enrollments tab, line ~238) | NO |
| 5 | `privateClassEnrollment.service.js`'s `create()` — the atomic-claim populate (line ~97) AND the earlier `schedule.coachId._id` read (line ~66) | New-enrollment creation | N/A (used server-side for `coachContractService.getActiveForCoach()` and the confirmation email) | NO — **a second live crash site**: booking a stale/orphaned slot (e.g. a bookmarked `/parent/register-private?slot=<id>` link, or one exposed via the admin `listAll` view) throws the identical `Cannot read properties of null (reading '_id')` at line 66, before the fix in D3/D4 below even applies. |
| 6 | `coachContract.service.js`'s `list()` | Admin billing-rate contract management (a financial record) | `app/admin/coach-contracts/page.tsx` — list row (line ~165) **and** the deactivate confirmation dialog (line ~302) | NO |
| 7 | `subscription.service.js`'s `populateSubscriptionQuery()` — nested `scheduleId.coachId` | Admin group-class subscription management (a financial record) | `app/admin/subscriptions/page.tsx:44` | NO |
| 8 | `evaluation.service.js`'s `populateEvaluationQuery()` | Trial evaluation record | **No current frontend consumer reads the populated coach name at all** (checked: nothing in `frontend/` renders an evaluation's coach) | N/A — see D6, deliberately out of scope |

---

## 2. Design decisions

### D1 — Two different correct behaviors, not one uniform rule

A null `coachId` means two different things depending on what the list is *for*, and the fix must
match:

- **Booking-availability listings** (row 2 above): a slot with a deleted coach genuinely cannot be
  booked. **Exclude the row entirely** — exactly what `groupClassSchedule.service.js`'s `listPublic()`
  (row 1) already does today. This is the direct fix for the reported crash.
- **Historical / management / financial-record listings** (rows 3, 4, 6, 7): the record must stay
  visible — an admin needs to see an orphaned schedule to clean it up, and a parent's real billing
  history with a since-deleted coach must not silently disappear. **Keep the row, degrade the
  display** to a fallback label instead of crashing.

### D2 — One consistent fallback string, everywhere

Every frontend display spot that needs a fallback uses the exact same text:
**`"Coach no longer available"`** — not a per-page ad hoc phrasing. This is a plain string constant,
inlined at each call site (no shared cross-page util module — this repo's own convention is
per-page local helper functions, e.g. `admin/private-classes/page.tsx`'s existing `coachLabel()`;
follow that, don't introduce a new shared module for one string).

### D3 — Type-widening as the completeness mechanism (not a manual checklist)

`frontend/lib/types.ts` currently types every one of these `coachId` fields as *always* an object
(never `null`) — per Hard Rule 8 ("no `any` on domain data — fix the type, don't cast it"), that
type is simply wrong; it doesn't match what the backend can actually return. Widen each to include
`| null`:

- `AdminSubscriptionScheduleRef.coachId` (feeds `AdminSubscriptionRow`, used by
  `admin/subscriptions/page.tsx`)
- `CoachContract.coachId`
- `PrivateClassEnrollmentRow.coachId`
- `PrivateClassScheduleRow.coachId` (already `AdminSubscriptionPersonRef | string` — add `| null`
  to the union)

**Do this widening FIRST, before touching any consuming page.** Running `npx tsc --noEmit`
immediately afterward will surface every unguarded `.firstName`/`.lastName` access as a compile
error — that error list IS the authoritative, complete set of frontend call sites needing a fix
(more reliable than this plan's own grep-based table in §1, which could be incomplete). Fix every
surfaced error; do not silence any with a cast or a widened return type.

### D4 — Defense-in-depth at enrollment creation, not just at listing

Row 5 in §1 is a second, independent crash site: even after `listPublic()` (D1) stops *showing* an
orphaned slot, a parent could still reach `POST /private-class-enrollments` for that `scheduleId`
directly (a stale bookmarked link, or a slot id copied from the admin `listAll` view, which
deliberately keeps orphaned rows visible per D1). `privateClassEnrollment.service.js`'s `create()`
must treat a schedule whose `coachId` didn't populate as not bookable — the same `notFoundError`
already thrown for a missing/inactive schedule, added right next to that existing check:

```js
const schedule = await PrivateClassSchedule.findById(scheduleId).populate(
  'coachId',
  'firstName lastName email'
);

if (!schedule || !schedule.isActive || !schedule.coachId) {
  throw notFoundError('Private class schedule not found');
}
```

This single added clause also protects line ~66's `coachContractService.getActiveForCoach(schedule.coachId._id)`
from ever running against a null `coachId` — no separate fix needed there.

### D5 — Root-cause fix: close the delete-guard hole

`user.service.js`'s `remove()` coach branch currently checks only `GroupClassSchedule`. Extend it
to check every model with a `coachId` reference that represents a *live or historical* relationship
— `PrivateClassSchedule`, `CoachContract`, `PrivateClassEnrollment` — mirroring the exact
count-then-`conflictError` shape the existing `GroupClassSchedule` check and the student-delete
guard both already use:

```js
if (target.role === 'coach') {
  const scheduleCount = await GroupClassSchedule.countDocuments({ coachId: id });
  if (scheduleCount > 0) {
    throw conflictError(`Cannot delete: ${scheduleCount} schedule(s) reference this coach.`);
  }

  const privateScheduleCount = await PrivateClassSchedule.countDocuments({ coachId: id });
  if (privateScheduleCount > 0) {
    throw conflictError(
      `Cannot delete: ${privateScheduleCount} private class schedule(s) reference this coach.`
    );
  }

  const contractCount = await CoachContract.countDocuments({ coachId: id });
  if (contractCount > 0) {
    throw conflictError(`Cannot delete: ${contractCount} coach contract(s) reference this coach.`);
  }

  const enrollmentCount = await PrivateClassEnrollment.countDocuments({ coachId: id });
  if (enrollmentCount > 0) {
    throw conflictError(
      `Cannot delete: ${enrollmentCount} private class enrollment(s) reference this coach.`
    );
  }
}
```

Order matches how the student guard already stacks its checks (registration-ledger-plan.md's D7
precedent) — each check independent, first non-zero count wins, exact count in the message. Add the
three new model imports at the top of `user.service.js`.

### D6 — `evaluation.service.js` is deliberately NOT touched

Checked (grep across `frontend/`): nothing currently renders an evaluation's populated coach name.
There is no live crash risk today. Leave `evaluation.service.js` as-is — do not add speculative
defensive code for a consumer that doesn't exist. If a future page does render an evaluation's
coach, it inherits D3's type-widening discipline at that time, same as everything else.

### D7 — Data cleanup script (staging), separate from the code fix

The code fix (D1-D5) stops future crashes and closes the hole, but the *already-orphaned*
document(s) currently sitting in the staging database still exist and still need a human decision
— D1 makes them invisible on the public page, but an admin should still be able to find and resolve
them deliberately, not have them sit as silent garbage forever.

New `backend/scripts/lib/findOrphanedCoachReferences.js` + thin wrapper
`backend/scripts/find-orphaned-coach-references.js` (same convention as
`scripts/lib/migrateRegistrationsToLedger.js` — see `docs/plans/registration-ledger-plan.md` D8 for
the established pattern in this repo: `scripts/lib/*.js` holds the real logic, exported as a
function, no CLI concerns; the thin wrapper handles argv/Mongo connection/printing).

**Read-only by design — this script never deletes anything automatically, even with a flag.** It:

1. Scans `PrivateClassSchedule`, `CoachContract`, and `PrivateClassEnrollment` for any `coachId`
   that doesn't resolve to a real `User` with `role: 'coach'`.
2. For each orphaned `PrivateClassSchedule`, reports whether it's currently booked
   (`studentId !== null`) or free (`studentId === null`) — a free orphaned slot is safe to delete
   outright (nothing depends on it); a booked one has a real enrollment/session history attached
   and needs a human decision, not a script's.
3. Prints a full report: model, document id, and (for schedules) booked/free status. No `--live`
   flag, no delete path in this script at all — this is `/audit-live-privateclass`-style read-only
   reporting, matching this repo's "never run scripts against production/staging without explicit
   approval each time" convention. Once the report exists, deleting the specific free/orphaned rows
   it identifies is a manual, reviewed action (a follow-up conversation, not something this script
   does for you).

---

## 3. File-by-file changes

### Backend

1. **`backend/src/services/privateClassSchedule.service.js`** — `listPublic()`: add the same
   `.filter((schedule) => schedule.coachId)` step `groupClassSchedule.service.js`'s `listPublic()`
   already uses (row 1 in §1), before mapping to the response shape. Comment should reference that
   function as the precedent, same as this plan does.
2. **`backend/src/services/privateClassEnrollment.service.js`** — `create()`: the one-line
   `|| !schedule.coachId` addition from D4.
3. **`backend/src/services/user.service.js`** — `remove()`'s coach branch, per D5. Add
   `PrivateClassSchedule`, `CoachContract`, `PrivateClassEnrollment` requires at the top.
4. **`backend/scripts/lib/findOrphanedCoachReferences.js`** + **`backend/scripts/find-orphaned-coach-references.js`** — new, per D7.

No changes to `groupClassSchedule.service.js` (already correct — the precedent), `coachContract.service.js`,
`subscription.service.js`, or `evaluation.service.js` (D6).

### Frontend

5. **`frontend/lib/types.ts`** — the four `| null` widenings from D3. Do this first; let `tsc` find
   the rest.
6. **`frontend/app/admin/private-classes/page.tsx`** — `coachLabel()` (line ~166-172): add a
   null branch returning `'Coach no longer available'`. Enrollments tab (line ~238): replace
   `enrollment.coachId.firstName} {enrollment.coachId.lastName` with a call through the same (or
   an equivalent local) helper.
7. **`frontend/app/admin/coach-contracts/page.tsx`** — new local `coachLabel()`-style helper
   (this page doesn't have one yet), used at both the list row (line ~165) and the deactivate
   dialog (line ~302) — do not fix one and leave the other, they're the same underlying `contract`
   object.
8. **`frontend/app/admin/subscriptions/page.tsx`** — line ~44's existing coach-name helper: add
   the null branch.
9. **`frontend/app/parent/subscriptions/page.tsx`** — line ~96: add a null guard (new local
   helper or inline ternary, whichever this file's existing style favors — read the file first).

Whatever `tsc --noEmit` surfaces beyond this list after step 5 is authoritative — fix it the same
way (D3).

---

## 4. Test plan

Reconciled against `docs/TESTING_STRATEGY.md` — read it before writing any test (real
`mongodb-memory-server` on the backend, MSW on the frontend, no module-boundary mocks, no
`jest.mock` of the models/services under test).

### Backend

**`backend/tests/routes/privateClassSchedule.routes.test.js`** (extend):
- Seed two schedules for the same coach; delete the coach's `User` doc directly (simulating the
  orphaned state — this is what actually happened in staging); assert `GET
  /private-class-schedules/public` returns 200 with the orphaned schedule's coach **excluded**
  from the response, and any of that coach's OTHER still-valid... (n/a, coach is gone entirely —
  just assert the whole coach group is absent, not a 500).
- Assert `GET /private-class-schedules?available=true` (admin `listAll`) **still returns** the
  orphaned schedule (with `coachId: null` in the JSON) — proving the asymmetry (D1) is intentional,
  not a regression.

**`backend/tests/routes/privateClassEnrollment.routes.test.js`** (extend):
- POST `/private-class-enrollments` against a schedule whose coach was deleted after the schedule
  was created → 404 (`'Private class schedule not found'`), not 500. Assert no `PrivateClassEnrollment`
  document was created (the pre-existing atomic-claim rollback path must not be reachable here —
  this should fail before any write happens).

**`backend/tests/routes/user.routes.test.js`** (extend, mirroring the existing "returns 409 when
deleting a coach referenced by a GroupClassSchedule" test at line ~392):
- `returns 409 when deleting a coach referenced by a PrivateClassSchedule`
- `returns 409 when deleting a coach referenced by a CoachContract`
- `returns 409 when deleting a coach referenced by a PrivateClassEnrollment`
- Each asserts the exact count in the 409 message body, same pattern as the existing test.

**`backend/tests/scripts/lib/findOrphanedCoachReferences.test.js`** (new, matching
`tests/scripts/lib/migrateRegistrationsToLedger.test.js`'s sibling pattern):
- Seeds a mix of valid and orphaned `PrivateClassSchedule`/`CoachContract`/`PrivateClassEnrollment`
  docs (orphaned = `coachId` pointing at an id with no matching `User`, or a `User` whose role
  isn't `coach`). Asserts the report correctly separates valid from orphaned, and correctly
  classifies an orphaned schedule as booked vs. free. Asserts the script performs zero writes
  (it has no write path at all — the test proves the DB is byte-identical before/after).

### Frontend

**`frontend/app/private-classes/__tests__/page.test.tsx`** (extend): the public page already
only ever receives a well-formed response from the backend post-fix (D1 excludes orphaned rows
server-side), so no new null-handling test is needed here — the crash is prevented upstream. Add
one regression test instead: MSW returns a `coaches` array with a normal, well-formed entry,
asserting the page still renders correctly (guards against a future regression to the pre-fix
"the whole array assumes every field present" shape).

**`frontend/app/admin/private-classes/__tests__/page.test.tsx`** (extend):
- A schedules-tab fixture row with `coachId: null` renders `"Coach no longer available"` instead
  of throwing.
- An enrollments-tab fixture row with `coachId: null` renders the same fallback text.

**`frontend/app/admin/coach-contracts/__tests__/page.test.tsx`** (extend):
- A contract fixture with `coachId: null` renders the fallback in the list row AND — open the
  deactivate dialog for that row — renders the fallback there too (not just the list; this is the
  regression the original bug's "fix one spot, miss the sibling" risk was about).

**`frontend/app/admin/subscriptions/__tests__/page.test.tsx`** (extend): a subscription fixture
whose `scheduleId.coachId` is `null` renders the fallback instead of throwing.

**`frontend/app/parent/subscriptions/__tests__/page.test.tsx`** (extend): a private-enrollment
fixture with `coachId: null` renders the fallback instead of throwing.

### Coverage + verification (this PR)

```
cd backend  && TZ=UTC npm test
cd frontend && TZ=UTC npm test
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

All four clean. `git status --short` reviewed — only the files §3 lists, plus whatever `tsc`
legitimately surfaced per D3.

---

## 5. What is deliberately NOT in this plan

- `evaluation.service.js` (D6) — no live consumer, no fix.
- Actually deleting the orphaned document(s) already in staging — the script in D7 only reports;
  deleting is a separate, explicitly-approved follow-up once the report exists.
- Any change to how `PrivateClassSchedule`/`CoachContract`/`PrivateClassEnrollment` are *created*
  — this plan only fixes reads of already-orphaned data and closes the deletion hole that creates
  more of it. It does not add new validation to the create paths (they already require a real
  `coachId` at creation time; the problem is only ever the coach being deleted *afterward*).
- Any change to `docs/plans/deployment-launch-plan.md` or Vercel/env config — unrelated.

---

## 6. Docs to update

- `docs/features/private-class.md` — note the public/admin listing asymmetry (D1) and the new
  coach-delete guards (D5), since both are real behavior changes a future reader of that doc would
  otherwise be surprised by.
- `docs/features/admin.md` — if it documents the coach-delete guard's current scope
  (GroupClassSchedule only), correct it to the full D5 list.
- `docs/plans/registration-ledger-plan.md` — no change needed (that plan's D7 precedent is only
  referenced here, not modified).

---

## 7. Builder instructions (Sonnet session)

**Pre-reads (mandatory, in order):**
1. This doc, in full.
2. `docs/TESTING_STRATEGY.md`.
3. Every file listed in §3, in full, before editing it.
4. `backend/src/services/groupClassSchedule.service.js`'s `listPublic()` (lines ~104-134) — the
   exact precedent D1's fix copies.
5. `backend/tests/routes/user.routes.test.js`'s existing "returns 409 when deleting a coach
   referenced by a GroupClassSchedule" test (~line 392) — the exact precedent the three new tests
   in §4 copy.
6. `backend/scripts/lib/migrateRegistrationsToLedger.js` +
   `backend/tests/scripts/lib/migrateRegistrationsToLedger.test.js` — the exact convention D7's
   script and its test follow.

**Rules:**
- One PR, not split — this is one coherent bug fix, unlike the registration-ledger plan's
  multi-PR sequencing.
- Do §3 step 5 (the type widening) FIRST, then run `npx tsc --noEmit` and use its output as the
  authoritative list of remaining frontend work — do not skip this step and rely solely on §1's
  table, which was built by grep and could miss something.
- Match the surrounding code's comment density (this repo comments the WHY heavily on
  data-integrity and billing-adjacent code — keep that up).
- No `console.log` except the established `eslint-disable`-annotated operational-logging pattern.
- Do not commit until the full suite passes under `TZ=UTC` and the diff has been reviewed by the
  owner.
- Report back: files changed, test counts (added/updated/passing), the exact `tsc --noEmit` output
  from before AND after the type-widening step (proving §3 step 5's completeness claim), any
  deviation from this spec with its reason, and the `find-orphaned-coach-references.js` report's
  output when run against staging (read-only — this is safe to run without asking, per D7) so the
  owner knows exactly what's still sitting in the database once the code fix ships.
