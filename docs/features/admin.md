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

## Dashboard (`/admin/dashboard`)

Raw list counts only (classes, schedules, locations, levels) fetched in parallel via the Phase-0 catalog/scheduling query services — no derived business metrics, per the backend-source-of-truth-style rule against inventing frontend math. `LoadError` with retry on failure. A quick-links card grid below links to all five admin sections.

## `/admin` (index)

Server component that immediately `redirect()`s to `/admin/dashboard`.
