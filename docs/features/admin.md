# Admin panel

Per-page behavior spec for the admin section (`frontend/app/admin/`). Shell/design-system structure lives in `docs/design-system.md`'s "Admin shell" section — this doc covers per-page behavior only.

All admin pages are gated by `app/admin/layout.tsx` (admin/superadmin only) and render inside the dark sidebar shell — no page wraps itself in `<ProtectedRoute>`/`<AppShell>` any more.

## Pattern A (CRUD pages)

Locations, Levels, Prices, and Classes all follow the same shape:

- List loaded via `useLoadState` (query service from `lib/services/catalog.ts`), rendered into local `items` state (synced from `useLoadState`'s `data` via an effect) so a delete can remove a row **optimistically** without a full refetch.
- `AdminPageHeader` + `btnPrimary` "Add <Entity>" button opens the create/edit dialog (`dialog.id === null` = create, an id = edit — CKQ's "Pattern A": one dialog for both).
- Table: `AdminLoadingRow` while loading, `AdminEmptyRow` when the list is empty, otherwise rows with `Pencil`/`Trash2` icon buttons per row (`aria-label` includes the row's identifying name for test/a11y targeting).
- Save: on `status: 'error'` the dialog stays open and shows the message inline (`Alert variant="error"`); on success the dialog closes and the list is reloaded via `retry()`.
- Delete: a small confirm dialog (`Delete "<name>"? This cannot be undone.`). On success the row is removed from local state immediately (no refetch). On `status: 'error'` (including a 409 in-use-guard message) the same dialog flips to a "Cannot Delete" state showing the backend message, with a single Close button — the row is NOT removed.

### Locations (`/admin/locations`)

Columns: Name, Address, Timezone. Fields: name, address, timezone (all free text). Backend delete guard: 409 if any `GroupClass` references the location.

### Levels (`/admin/levels`)

Columns: Name, Order. Fields: name, order (number). Backend delete guard: 409 if any `GroupClass` references the level, **or** if a `Price` is configured for it (added in this phase — previously only the GroupClass check existed).

### Prices (`/admin/prices`)

Columns: Level (resolved via a levels lookup), Monthly Fee. Fields: levelId (select), monthlyFee (number). No delete guard — nothing else references a `Price` by id, so it stays freely deletable (verified against every model in `backend/src/models/`).

### Classes (`/admin/classes`)

Columns: Name, Level, Location, Capacity (level/location resolved via lookups). Fields: name, levelId (select), locationId (select), capacity (number). Backend delete guard: 409 if any `GroupClassSchedule` references the class (added in this phase — previously `remove()` had no guard at all).

## Schedules (`/admin/schedules`) — deferred edit/delete (moving a student is now supported elsewhere)

Restyled onto the shell + `admin.module.css` table classes + `AdminPageHeader`, but **intentionally stays create + list only**. The create form was moved into a modal for visual consistency with Pattern A, but there is no edit or delete UI, and the backend has no corresponding guard work here — deleting/editing a schedule has ripple effects on already-generated `GroupClassSession` docs and student rosters that are out of scope for this plan. A muted table-footer note communicates this: "Schedules can't be edited once created — create a new one instead." Each row links to `/admin/schedules/:id/sessions`.

**Amended by the CKQ parity plan (Phase 3):** the narrow case of *moving a single student between two same-level schedules* is no longer deferred — see Subscriptions → Change Schedule below. What stays deferred is editing a schedule's own fields (day/time/coach/capacity) once created; that still has the ripple effects described above and remains out of scope.

## Subscriptions (`/admin/subscriptions`)

Not a Pattern A CRUD page — a list + action-dialogs page over `Subscription` (the group-class billing lifecycle). Backend: `subscription.service.js`'s `listAll`/`cancel`/`reactivate`/`changeSchedule`, routed at `GET/PATCH /api/v1/subscriptions*`.

- **Toolbar**: search input (client debounce 400ms → `q`, matches student/parent name or parent email, filtered in Node after populate — academy scale, not worth a search index), status select (All / Active / Pending cancel / Cancelled). Any filter change resets to page 1.
- **Columns**: Student | Parent (email sub-line) | Class (name + level sub-line) | Schedule (day/time + coach sub-line) | Next billing | Last charge (`$X`, plus a `10% sibling` chip when `lastSiblingDiscountApplied`) | Status chip (`Active` / gold `Cancels <date>` / muted `Cancelled`) | Actions.
- **Actions**: **Change Schedule** (active or pending-cancel), **Cancel** (active only), **Reactivate** (pending-cancel only).
- **Change Schedule dialog** — two steps: *pick* (read-only "Current schedule" box + a "New schedule" select client-filtered to schedules at the same level, excluding the current one — hint text when none match) → *confirm* (before/after class+schedule+coach, plus "Monthly fee unchanged — same level."). A 409 (same-level violation, capacity, duplicate-subscription) renders inline and keeps the dialog open.
- **Cancel dialog** — "Cancel {student}'s subscription? Classes continue through {date}; nothing is refunded and the subscription will not renew." (D8 — no refunds/proration, ever.)
- **Reactivate dialog** — "Remove the pending cancellation? Renewals continue as normal; nothing is charged now."
- **Pagination**: simple Prev/Next on `totalPages`.

Backend `changeSchedule(subscriptionId, newScheduleId)` validation order: subscription active (409 otherwise — a pending-cancel sub CAN still move), target schedule exists and differs, **same level** (resolves both schedules' `classId → levelId`, 409 on mismatch — always price-neutral per D6, no delta charge/proration/sibling-discount recompute), target capacity, no duplicate active subscription on the target. Writes, in order: `Subscription.scheduleId`, the student's active `Registration.scheduleId`, `$pull` the old schedule's roster + its future sessions, `$addToSet`/push the new schedule's roster + its future sessions (the add/remove roster logic is shared via `backend/src/services/roster.service.js`, reused by `registration.service.js` and `renewal.service.js` too — previously duplicated in both). `cancel()` and `reactivate()` now also send confirmation emails (log-only try/catch, never blocks the write) — see `docs/modules/email.md`.

## Coach Contracts (`/admin/coach-contracts`)

Pattern A minus edit. List: coach, `$/hr` billed to parent, `$/hr` coach compensation, default session duration, Active/Inactive status, effective-since date. Add dialog: coach select (from `?role=coach`), both rates, default duration — hint text: "Creating a contract replaces the coach's current active contract" (one active contract per coach, enforced service-side). Deactivate action: confirm dialog, no delete (a contract is an immutable audit record — see `docs/features/private-class.md`).

## Private Classes (`/admin/private-classes`)

`?tab=` (default `enrollments`), synced to the URL. **Enrollments** tab: student/parent/coach/slot/`$X/hr`/status, Cancel action on active rows (same confirm copy as the parent-side cancel: "All upcoming sessions will be removed and the weekly slot released. Completed sessions already charged are unaffected."). **Schedules** tab: every coach's slots (coach/day/time/duration, Available or the enrolled student's name as a chip), Add Slot dialog (coach/day/time/duration — admin creating on a coach's behalf), Delete on free slots only (409 verbatim on an occupied slot, Pattern A "Cannot Delete" state). Full model/pipeline detail: `docs/features/private-class.md`.

## Sessions (`/admin/schedules/:id/sessions`)

Restyled table + header only (no CRUD — sessions are generated automatically when a schedule is created). Each row links to `/sessions/:id/attendance` to mark attendance.

## Attendance (`/sessions/:id/attendance`)

**Left functionally and visually untouched** — this page is shared with the coach role and still renders inside the legacy `AppShell`, per the plan's explicit scope boundary.

## Users (`/admin/users`)

Pattern A plus two new sub-patterns: role tabs above the table, and a third "change password" dialog alongside the usual create/edit and delete dialogs.

- **Tabs**: `All`, `Parent`, `Coach`, `Admin`, `Student`, and `Superadmin` — the Superadmin tab only renders when the logged-in user's own role is `superadmin`. Selecting a tab re-fetches `GET /users?role=<tab>` (no `role` param for "All") and syncs the URL via `router.replace('/admin/users' | '/admin/users?role=<tab>')`.
- **Columns**: Name, Role (`chipMuted` badge), Email (`—` for a student without one), Actions.
- **Row actions**: Edit, Change Password (only for a login-capable role: parent/coach/admin/superadmin — a student never gets the Key icon since it has no password), Delete. All three are omitted (replaced with a muted `—`) on any row where `row.role === 'superadmin'` and the viewer is not a superadmin — frontend defense-in-depth matching the backend's 403.
- **Create/Edit dialog**: the role `<select>` (options: student/parent/coach/admin, plus superadmin only for a superadmin viewer) is shown **only on create**; on edit, role renders as plain read-only text — role is immutable once created, and the update endpoint silently drops a `role` field even if sent directly to the API. Conditional fields: role `student` → Parent picker (`<select>` populated from `fetchUsers('parent')`, required), Skill Level (optional), Email (optional), no password field ever. Any other role on create → Email (required) + Password (required, client-side min-8 hint). On **edit**, only firstName/lastName (+ Email, but only when the target's role is login-capable) are shown/submitted — the Parent picker and Skill Level are create-only, since the backend's `update()` never accepts `parentId` changes (out of scope — see the plan doc) and a student's email can't be changed through this endpoint either (`updateUser` payload is always exactly `{firstName, lastName, email?}`).
- **Change Password dialog**: separate small dialog, one "New Password" field (client-side min-8 check), `PUT /users/:id/password` — distinct from the profile-edit endpoint. Closes on success; no list refetch needed since it doesn't change displayed columns.
- **Delete dialog**: identical Pattern A shape. Backend guards (409): `parent` blocked if any `User.parentId` points at them; `student` blocked if referenced by a `Registration`, `Subscription`, or `TrialClass`; `coach` blocked if referenced by a `GroupClassSchedule.coachId`; `admin`/`superadmin` have no entity guard. A user can never delete their own account (400), and a non-superadmin can never view, edit, password-reset, or delete a `superadmin` row (403), even via a direct API call — see `docs/plans/admin-user-management-plan.md` for the full backend-enforced rule set (deliberately stricter than the CKQ reference this was adapted from).

## Spotlights (`/admin/spotlights`)

Pattern A. Columns: Name, Type, Title, Order, Published (Yes/No). Fields: type (select, coach/student), name (required), title, body (textarea), three optional "Bullet 1/2/3" text inputs (the model's `bullets` max-3 constraint is enforced by only offering 3 fields, rather than a dynamic add/remove list), Image URL, order (number), isPublished (checkbox). Save trims each field and omits blank optional ones (`undefined`, dropped by `JSON.stringify`) rather than sending empty strings. No delete guard — nothing else references a `Spotlight` by id. Backs the public home-page spotlights and `/coaches` — see `docs/features/public-site.md`. Sidebar: new **Content** section.

**Image field**: a plain URL input, plus a file picker next to it ("Or upload a file:") that `POST`s to `/spotlights/upload-image` (multipart, 5MB cap) and fills the URL field with the returned Vercel Blob URL on success — either path writes the same `imageUrl` string, so the two are interchangeable. A thumbnail preview renders below once the field has a value. Save is disabled while an upload is in flight.

## Dashboard (`/admin/dashboard`)

Raw list counts only (classes, schedules, locations, levels) fetched in parallel via the Phase-0 catalog/scheduling query services — no derived business metrics, per the backend-source-of-truth-style rule against inventing frontend math. `LoadError` with retry on failure. No quick-links grid below the counts — the sidebar already reaches every admin section, so a second set of links was redundant (removed 2026-08-21).

## `/admin` (index)

Server component that immediately `redirect()`s to `/admin/dashboard`.
