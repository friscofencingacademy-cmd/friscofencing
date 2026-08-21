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

## Schedules (`/admin/schedules`) — deferred edit/delete

Restyled onto the shell + `admin.module.css` table classes + `AdminPageHeader`, but **intentionally stays create + list only**. The create form was moved into a modal for visual consistency with Pattern A, but there is no edit or delete UI, and the backend has no corresponding guard work here — deleting/editing a schedule has ripple effects on already-generated `GroupClassSession` docs and student rosters that are out of scope for this plan. A muted table-footer note communicates this: "Schedules can't be edited once created — create a new one instead." Each row links to `/admin/schedules/:id/sessions`.

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

## Dashboard (`/admin/dashboard`)

Raw list counts only (classes, schedules, locations, levels) fetched in parallel via the Phase-0 catalog/scheduling query services — no derived business metrics, per the backend-source-of-truth-style rule against inventing frontend math. `LoadError` with retry on failure. A quick-links card grid below links to all admin sections (Classes, Levels, Prices, Schedules, Locations, Users).

## `/admin` (index)

Server component that immediately `redirect()`s to `/admin/dashboard`.
