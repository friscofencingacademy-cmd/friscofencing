# Booking & Private-Class Fixes Plan — five owner-reported issues (2026-08-31)

**Status: PLANNED — no code written yet.**

Origin: owner walkthrough of staging on 2026-08-31 surfaced five issues. Each was traced to a
concrete root cause in current source before this plan was written (file/line references below are
against `develop` @ `5df72e7`). Three are frontend UX, two are backend data-lifecycle — and two of
the five (Issues 3 and 4) turned out to share one underlying bug in the staging wipe.

Pre-reads done for this plan: `docs/features/parent-portal.md`, `docs/features/private-class.md`,
`docs/features/admin.md` (via plan context), `docs/TESTING_STRATEGY.md`, `docs/design-system.md`
(required again at build time before touching any CSS in PR A).

---

## The five issues

| # | Symptom (owner's words, paraphrased) | Root cause | PR |
|---|---|---|---|
| 1 | Selecting an already-registered child in the register wizard only fails at the final "Register & Pay" step | Wizard never reads the server-computed `student.enrollment` | A |
| 2 | "Register & Pay" button invisible — dark blue on a dark blue card | Shared `opacity: 0.5` disabled style composites crimson into the navy quote panel | A |
| 3 | Bad private-class data (enrollment with an unavailable coach for Sana Sarath) survives the staging clear | `wipeDatabase()` only wipes collections whose **models happen to be require()d**; plus the legacy import re-creates a slotless private enrollment every refresh | B |
| 4 | After cancelling a private enrollment, the schedule can't be deleted — "student is still enrolled" | Delete guard 409s on the denormalized `studentId` field; cancel frees slots by `enrollmentId` — stale claims (created by Issue 3's wipe gap) never clear | B |
| 5 | Admin Charge dialog's confirm button is always greyed out | By design (Guard B — one payment per subscription per calendar month); the *explanation* is nearly invisible | C |

---

## Issue 1 — Show an existing registration the moment a child is selected

### Root cause

`frontend/app/parent/register/page.tsx` never reads `student.enrollment`, even though the backend
already computes and attaches it to every child in `GET /students/mine`
(`student.service.js`'s batched `attachEnrollment()` — see `docs/features/parent-portal.md`):

```ts
enrollment: {
  status: 'enrolled' | 'trial_scheduled' | 'trial_completed' | 'not_enrolled';
  canBookTrial: boolean;
  schedule: { dayOfWeek, startTime, endTime } | null;  // set only when 'enrolled'
}
```

So an already-enrolled child sails through Who → Level → start date → payment method, and only the
one-active-subscription-per-student guard (ADR 005) stops them with a 409 at `POST /registrations`.
The backend guard is correct and stays exactly as is — this is purely a "tell the parent in step 1,
not at payment" frontend fix. **Zero new backend work; the data is already in
`ParentPortalContext.students`.**

### Design

1. **Chip on the card (Who step).** `ChildPickerCards` gains an optional prop:

   ```ts
   getBadge?: (student: StudentBase) => string | null;
   ```

   Rendered as a small muted chip inside the card when non-null. The component keeps taking
   `StudentBase` (it still never reads `enrollment` itself — the *page* decides the badge from the
   full `Student`, preserving the existing prop-narrowing comment's intent). Book-a-Trial and
   Register-Private pass nothing and render byte-identically.

2. **Blocking notice on selection.** In the register page, when
   `selectedStudent?.enrollment.status === 'enrolled'`, render an inline notice **in place of the
   "Choose your level" section** (the Level/date/payment sections simply never mount for that
   child):

   > **Sana is already enrolled** — Every Wednesday, 4:00 – 5:00 PM.
   > Manage or cancel this registration in [My Registrations](/parent/subscriptions).

   - Day/time formatted from `enrollment.schedule` via the existing `DAY`-label + `formatTime`
     helpers (display only, no derivation). `schedule` can be `null` on an orphaned reference
     (parent-portal doc's degradation contract) — the notice then renders without the day/time
     line, never crashes.
   - The stepper stays at "Level" (`currentStep` derivation unchanged) — the parent can click a
     different child; nothing is disabled at the picker level, because a family with one enrolled
     and one new child must still be able to register the new one.
   - The `?child=` deep link hits the same `selectedStudent` check, so a stale dashboard link to an
     enrolled child lands on the notice too.
   - Only `'enrolled'` blocks. `trial_scheduled` / `trial_completed` / `not_enrolled` proceed
     unchanged — a trial child registering for real is the main conversion path.
3. **The summary rail's CTA is moot for an enrolled child** (no session can be picked, so
   `ctaDisabled` already holds), but for belt-and-braces the page also keeps `sessionId` unset —
   no new gating logic needed.

Book-a-Trial needs nothing: its CTA is already gated by the server's `canBookTrial`.

### Files

- `frontend/app/components/portal/flow/ChildPickerCards.tsx` — optional `getBadge` prop + chip.
- `frontend/app/components/portal/flow/flow.module.css` — chip style (reuse the existing muted-chip
  pattern; design-system pre-read before styling).
- `frontend/app/parent/register/page.tsx` — enrolled-child notice + section gating; passes
  `getBadge`.

### Testing (Issue 1)

- **Component** — `frontend/app/parent/register/__tests__/page.test.tsx`, new nested
  `describe('RegisterPage — already-enrolled child (booking-and-private-class-fixes plan §1)')`:
  - Fixtures: extend the suite's `GET /students/mine` MSW handler with one child whose
    `enrollment` is `{ status: 'enrolled', canBookTrial: false, schedule: { dayOfWeek: 3,
    startTime: '16:00', endTime: '17:00' } }` and one `not_enrolled` child. Typed against the real
    `Student` from `lib/types.ts` — no `any` (Hard Rule 8 / typed-fixtures rule).
  - Asserts (rendered results, never mock-call args):
    1. The enrolled child's card shows the "Already enrolled" chip; the other card doesn't.
    2. Clicking the enrolled card (via `userEvent.setup()`) renders the notice text with a real
       `href="/parent/subscriptions"` link, and `Choose your level` is **not** in the document.
    3. `?child=<enrolledId>` deep link (mutable `mockSearchParams`, reset in `afterEach`) lands on
       the same notice.
    4. Enrolled child with `schedule: null` (orphaned ref) renders the notice **without crashing**.
    5. Regression: the `not_enrolled` child still advances to Level (existing flow tests must stay
       green untouched — the payload-assertion tests in particular, which are payment-critical).
- **E2E** — `frontend/e2e/parent-register.spec.ts` (**mandated same-PR update** — CLAUDE.md
  pre-read table: this spec covers the register wizard): one new test. Mock the students payload so
  one child is enrolled; assert chip visible → click → notice shown, level radiogroup absent, and
  the second child still reaches the date picker. Keep the existing `page.clock` pinning
  convention — no wall-clock sampling.

---

## Issue 2 — "Register & Pay" has no contrast on the quote panel

### Root cause

The CTA is already brand crimson (`OrderSummary.tsx:79`, `variant="accent"` = `#B51726`) — but it
sits **disabled for most of the flow** (until a start date is picked *and* a card is on file,
`register/page.tsx:513`), and the shared disabled style is `opacity: 0.5`
(`Button.module.css:18`). Crimson at 50 % opacity composited over the panel's `#00142F` deep navy
produces ≈`#5B162B` — ~1.2:1 against the panel, i.e. the exact "dark blue button in a dark blue
card" the owner saw. Even fully enabled, solid `#B51726` on `#00142F` is only ~1.9:1 **shape**
contrast (WCAG 1.4.11 wants ≥3:1 for UI component boundaries; the white *label* on crimson is
fine at ~10:1).

### Design

Scoped fixes in `flow.module.css` under `.summaryCtaWrap` — the shared `Button` variants stay
untouched, because `opacity: 0.5` is correct on every light surface in the app; only the dark
quote panel needs a dark-surface treatment. All three wizards (Register, Book-a-Trial,
Register-Private) inherit it automatically, since the CTA always renders through `OrderSummary`.

1. **Disabled state** (the state the owner actually saw): kill the opacity composite —
   `opacity: 1`, `background: rgba(255, 255, 255, 0.14)`, `color: rgba(255, 255, 255, 0.6)`.
   Reads unmistakably as "a button waiting for the form above to be completed." (Disabled controls
   are exempt from WCAG contrast minimums — the goal here is *visibility as a shape*, which the
   translucent-white pill delivers where 50 %-crimson-on-navy does not.)
2. **Enabled state**: keep solid brand crimson (it's the WP site's own CTA color, per the Phase-3
   rebrand decision recorded in `OrderSummary.tsx`'s comment) but give the button a visible
   boundary ring on the navy panel: `box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.45)` (or
   border-equivalent). White at 45 % over `#00142F` clears the 3:1 non-text bar against the panel;
   exact alpha to be verified at build time with real ratio math, per the design-system pre-merge
   checklist — verified values recorded in the CSS comment the way `flow.module.css:165` already
   does for this panel.

### Files

- `frontend/app/components/portal/flow/flow.module.css` only. (`docs/design-system.md` pre-read
  required at build time.)

### Testing (Issue 2)

- **CSS-only — no new Jest assertions**, by explicit strategy rule: never assert on class names or
  computed styles; existing tests assert on `disabled`/text/ARIA and must stay green untouched
  (the same property that made the Phase 1–5 restyles test-transparent).
- Contrast ratios verified numerically at build time and recorded in the CSS comment (the
  existing convention for this exact panel). Note: an axe scan cannot cover this — disabled
  controls are exempt from `color-contrast`, and 1.4.11 component-boundary contrast isn't an
  automated axe rule — so the numeric verification *is* the check, not a placeholder for one.
- Full frontend suite + `tsc --noEmit` + `next build` + full E2E as PR-A gates.

---

## Issue 3 — Staging clear leaves private-class data behind (and creates some)

### Root cause — two distinct mechanisms, found by tracing, not assumed

**(a) The wipe silently skips unregistered collections.**
`backend/scripts/lib/wipeDatabase.js` iterates `mongoose.connection.collections` — which only
contains collections for **models that have been `require()`d somewhere in the running process**.
`refresh-staging-data.js`'s require graph (via `runLegacyImport.js:16-25`) registers `User`,
`Level`, `Location`, `GroupClass`, `Price`, `GroupClassSchedule`, `CoachContract`,
`PrivateClassEnrollment`, `Registration`, `Subscription` — but **not `PrivateClassSchedule`,
`PrivateClassSession`** (nor `TrialClass`, `Visit`, `Evaluation`, `Holiday`… unless some service
in the graph happens to pull them in). So "wipe every collection (no exceptions)" — the script's
own stated contract — has never been true: every refresh wipes `users` and re-creates coaches and
students with **new `_id`s**, while surviving `privateclassschedules` / `privateclasssessions`
rows keep pointing at the **old, now-nonexistent** ids. That is exactly the orphaned
"coach not available" schedule data the owner is seeing, and it re-forms on every refresh.

**(b) The legacy import re-creates a private enrollment every refresh.**
`runLegacyImport.js:375-390` creates a `PrivateClassEnrollment` for every CSV row flagged
`hasPrivateClass` — concretely, the one legacy private-class student, **Sana Sarath (PIN 6221)**,
pinned to coach `chris` at the `PRIVATE_CLASS_CONTRACT` placeholder rate
(`legacy-import.config.js:180-189`). This enrollment is born **active with no schedule slot and no
sessions** — half-baked state no real flow can produce, and the other half of the "bad data in
Private class" report.

### Design

1. **Make `wipeDatabase()` authoritative.** Enumerate collections from the **database itself**
   (`mongoose.connection.db.listCollections()`), not from mongoose's registered-model registry,
   skipping only `system.*` namespaces. This wipes what is actually there — regardless of which
   models the caller's require graph happened to load — and is future-proof for every model added
   later (e.g. `Holiday`, currently in flight on the holiday-blocking branch, which would have hit
   this same trap). The "no allowlist, no exceptions" doc comment finally matches reality. The
   staging/local-only guard in the CLI wrappers is untouched.
2. **Gate the import's private-enrollment creation behind config, default off.**
   `legacy-import.config.js` gains `IMPORT_PRIVATE_CLASS_ENROLLMENTS: false`;
   `runLegacyImport` skips the `hasPrivateClass` branch when false and counts it in the summary
   (`privateClassEnrollmentsSkipped`) so the refresh output stays honest rather than silently
   dropping a line. Rationale: the owner has declared this data unwanted on staging ("clear all
   private class enrollments and schedules"), and a slotless active enrollment is half-state that
   confuses every page that renders it. The flag (rather than deleting the code) keeps the go-live
   option open: if the real production import should carry Sana's private enrollment after all,
   it's a one-line config flip — an owner decision to make at go-live, recorded here.
3. **`reset-customer-data.js` stays as-is.** Its user-scoped semantics are correct for its own job
   (delete non-kept users + their data). The owner's "clear staging script" is
   `refresh-staging-data.js` (CLAUDE-documented as "the ONE command"), and with (1) fixed, a
   refresh genuinely zeroes all private-class collections before reseeding.

### Files

- `backend/scripts/lib/wipeDatabase.js` — `listCollections()`-based enumeration.
- `backend/scripts/lib/runLegacyImport.js` — flag check + `privateClassEnrollmentsSkipped` summary
  field.
- `backend/scripts/legacy-import.config.js` — the flag, with a comment recording the go-live
  decision point.
- `backend/scripts/refresh-staging-data.js` — print the skipped count in Step 4 output.

### Testing (Issue 3)

- **`backend/tests/scripts/lib/wipeDatabase.test.js`** — new nested
  `describe('wipeDatabase — unregistered-collection regression (booking-and-private-class-fixes plan §3)')`:
  - Seed one doc through a registered model **and** insert one directly via
    `mongoose.connection.db.collection('privateclassschedules').insertOne(...)` *without ever
    requiring that model* — reproducing the exact gap. Run `wipeDatabase()`; assert **both**
    collections are empty and the results object reports both counts. (Real
    `mongodb-memory-server`, never mocked models, per strategy.)
  - Existing tests stay green (the return shape — `{ collectionName: deletedCount }` — is
    preserved).
- **`backend/tests/scripts/lib/runLegacyImport.test.js`** — extend:
  - Flag **off** (new default): a `hasPrivateClass` CSV row imports the student but creates **zero**
    `PrivateClassEnrollment` docs; summary reports `privateClassEnrollmentsCreated: 0`,
    `privateClassEnrollmentsSkipped: 1`.
  - Flag **on**: existing behavior asserted unchanged (enrollment created, idempotent on re-run).
- **`backend/tests/scripts/lib/refreshStagingData.test.js`** — if it currently asserts the
  end-to-end summary, extend it to assert zero private-class docs exist after a refresh whose CSV
  contains the `hasPrivateClass` row.

---

## Issue 4 — Cancelled enrollment, but the schedule still says "student is still enrolled"

### Root cause

A guard/free asymmetry, made visible by Issue 3's stale data:

- Cancel frees slots by matching **`enrollmentId`**:
  `privateClassEnrollment.service.js:207` — `updateMany({ enrollmentId: enrollment._id }, { $set: { studentId: null, enrollmentId: null } })`.
- Delete 409s on the raw denormalized **`studentId`** field:
  `privateClassSchedule.service.js:99` — `if (schedule.studentId) throw conflictError('Slot has an enrolled student')`.

Any slot whose `studentId` is set but whose `enrollmentId` doesn't point at a live enrollment —
exactly what the wipe gap manufactures (old-id claims), and what any future partial-write could
leave behind — is permanently undeletable: no cancel can ever free it, and the guard never
re-checks reality.

### Design

Make the delete guard check the **truth** (is there an *active* enrollment claiming this slot?)
instead of the denormalized field, and self-heal stale claims:

```
remove(id, requestingUser):
  … existing 404 / ownership checks unchanged …
  if (schedule.studentId || schedule.enrollmentId):
    enrollment = schedule.enrollmentId
      ? await PrivateClassEnrollment.findById(schedule.enrollmentId)
      : null
    if (enrollment && enrollment.status === 'active'):
      throw 409 'Slot has an enrolled student'      // real claim — unchanged behavior
    // stale claim: enrollment cancelled, or missing, or enrollmentId null
    // while studentId is set — free it and fall through to the delete
  delete
```

- The cancel path **stays keyed by `enrollmentId`** — deliberately. Freeing by `studentId` there
  would be the unsafe direction: a student can hold two enrollments with different coaches, and a
  `studentId`-keyed free could release a slot belonging to the *other, still-active* enrollment.
  The guard side is the correct place to consult reality.
- Applies to both callers of `remove()` (admin page's Schedules tab, coach's own slot delete) —
  one service fix, no route/controller changes, no frontend changes (the admin page already
  refetches after a delete).

### Files

- `backend/src/services/privateClassSchedule.service.js` — `remove()` guard rework.

### Testing (Issue 4)

- **`backend/tests/routes/privateClassSchedule.routes.test.js`** — new nested
  `describe('DELETE /private-class-schedules/:id — stale-claim self-heal (booking-and-private-class-fixes plan §4)')`:
  1. Slot claimed by an **active** enrollment → still 409 (existing behavior; keep/extend the
     existing assertion).
  2. Slot claimed by a **cancelled** enrollment (seed slot with `studentId` + `enrollmentId`, then
     set the enrollment's `status: 'cancelled'` directly — simulating the pre-fix cancel that
     didn't free it) → **200**, slot gone from the DB.
  3. Slot with `studentId` set but `enrollmentId: null` (denormalization drift) → 200, slot gone.
  4. Slot with `enrollmentId` pointing at a **deleted** enrollment doc → 200, slot gone.
  5. Ownership unchanged: a non-owning coach still 403s on all of the above; admin succeeds.
  - All via Supertest against real `mongodb-memory-server` (auth → controller → service → model),
    fixtures as plain Mongoose `.create()` calls, `afterEach` `clearTestDB()`.

---

## Issue 5 — Admin Charge confirm always greyed out

### Root cause — working as designed; the design is just mute about it

The disable chain (`admin/subscriptions/page.tsx:551-558`) traces to
`renewal.service.js:290` — `due = subscription.nextBillingDate <= today`. Every subscription the
owner tested was charged at registration, so its `nextBillingDate` is the 1st of *next* month:

- **Full month** → `!preview.due` → blocked ("not due yet").
- **Prorated from today** → `preview.monthAlreadyPaid` (ledger-sourced, Guard B's
  one-payment-per-subscription-per-calendar-month invariant) → blocked.
- **Record offline payment** → inherits the same period gate, **plus** requires a non-empty note
  and a positive amount (`manualInvalid`, line 544).

This is the invariant deliberately built after the real $403.82 double-charge incident
(`docs/plans/payment-airtight-plan.md`). The button enables exactly when a charge is legitimate:
the subscription is genuinely due (on/after the 1st, before the renewal run), in dunning, or
finalizing a pending cancellation. **No override is added — superadmin included** (an override is
precisely how a second same-month charge happens). What's broken is the communication: the only
explanation is a barely-visible muted line (`page.tsx:1140-1149`) below the fold of the dialog.

### Design

Frontend-only, in the Charge dialog:

1. **A prominent, always-visible explanation whenever every path is blocked.** When
   `outcome === 'previewable'`, not in dunning, not finalizing, and the effective period is
   blocked, render an `Alert` at the **top** of the dialog body (above the method radios):
   - Not due: *"Already paid through this period — next charge is due {nextBillingDate}. The
     Confirm button enables on that date."*
   - Month already paid (prorated path): keep the existing already-paid Alert but promote its
     placement to the same top slot, including the ledger facts it already shows (amount, date,
     method).
   All strings composed from fields the preview already returns — no new backend data, no
   frontend billing arithmetic (Hard Rule 7).
2. **A note hint on the manual path.** When the *only* thing holding the button is the empty
   note (`manualInvalid` with a due period), show a small inline hint under the Note field —
   *"A note is required to record an offline payment."* — so a due-period manual recording never
   *looks* stuck.
3. Keep the existing muted "Not due until…" line removed/absorbed into (1) rather than duplicated.

### Files

- `frontend/app/admin/subscriptions/page.tsx` — dialog rendering only; `chargeConfirmDisabled`
  logic untouched.

### Testing (Issue 5)

- **`frontend/app/admin/subscriptions/__tests__/page.test.tsx`** — extend the existing
  charge-dialog `describe` (MSW preview fixtures, real round-trips):
  1. Preview fixture: `due: false`, future `nextBillingDate`, `monthAlreadyPaid` set → opening the
     dialog shows the explanation Alert (assert on its text incl. the formatted date) and Confirm
     is `disabled`.
  2. Preview fixture: due, method switched to manual, note empty → hint text visible, Confirm
     disabled; typing a note (`userEvent`) → hint gone, Confirm enabled.
  3. Regression: dunning and finalize-cancellation fixtures do **not** render the "already paid"
     Alert (those states have their own existing Alerts — assert they still render).
- Existing dialog tests (options, prefill, submit paths) stay green — no gating logic changed.
- Not E2E-mandated (no `frontend/e2e/*.spec.ts` covers the admin subscriptions page — Phase 2
  gap, tracked in `docs/plans/e2e-testing-plan.md`).

---

## PR breakdown & sequencing

| PR | Branch | Scope | Suites gating it |
|---|---|---|---|
| **A** | `feature/register-wizard-enrolled-guard` | Issues 1 + 2 (register wizard + flow kit + CSS) | Full frontend Jest, `tsc --noEmit`, `next build`, full E2E (`parent-register.spec.ts` updated in-PR) |
| **B** | `feature/staging-wipe-and-slot-guard` | Issues 3 + 4 (wipe fix, import flag, delete-guard self-heal) | Full backend suite under `TZ=UTC` (script-lib + route-integration suites above) |
| **C** | `feature/charge-dialog-messaging` | Issue 5 (dialog messaging) | Frontend Jest for the admin subscriptions page, `tsc --noEmit`, `next build` |

No ordering dependency between PRs; B should merge before the staging reset below is re-run.
Per the hard rules: tests land with each PR, owner tests locally before any commit, and nothing
here is committed until the owner says so.

## Staging cleanup rollout (after PR B merges to develop)

1. Run `node scripts/refresh-staging-data.js --people=<current CSV>` against staging — with the
   fixed wipe it now genuinely empties `privateclassschedules` / `privateclasssessions` (and every
   other previously-skipped collection), and with the flag off the import creates **zero**
   private-class enrollments. Step-1 output should list the private-class collections with real
   deleted counts this time — that line is the verification the fix ran.
2. Run `node scripts/find-orphaned-references.js` (read-only) — expect a clean scan.
3. Owner spot-check: `/parent/subscriptions` for Sana's family shows no private-lesson row;
   `/admin/private-classes` Schedules tab — any manually-created test slot with a stale claim can
   now be deleted (Issue 4's fix), or is gone with the wipe.

## Doc close-outs (same PRs)

- `docs/features/parent-portal.md` — Register wizard section: the enrolled-child chip + notice
  (PR A).
- `docs/features/private-class.md` — route table's `DELETE /private-class-schedules/:id` row: the
  guard is now "no **active** enrollment claims the slot; stale claims self-heal" (PR B).
- `docs/features/admin.md` — Subscriptions/Charge dialog: blocked-state messaging (PR C).
- `CLAUDE_HISTORY.md` + CLAUDE.md plan-table row on completion, per convention.
