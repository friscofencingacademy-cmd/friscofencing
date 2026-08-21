# Admin User Management — Create, Edit, Change Password

**Status: SHIPPED TO PRODUCTION 2026-08-21** (PR #12 to develop, promoted to main in PR #13). Nothing remaining from this plan.
**Executor:** a Claude Code session running the **Sonnet** model.
**Planner:** Fable (this doc).

---

## 0. Execution contract

This is a **single-scope feature**, not the multi-phase autonomous run from the earlier UI adoption plan. Standard flow applies:

1. Owner says `write` → the coordinating (Fable) session dispatches ONE Sonnet subagent with this entire spec.
2. Sonnet implements on branch `feature/admin-user-management`, writes tests, runs all gates, and **does not commit**.
3. Fable reviews the diff against this spec, independently re-runs the gates, and reports back to the owner.
4. **Per CLAUDE.md Hard Rule 5: the owner tests locally before anything is committed.** Only after the owner confirms it works does Fable commit, push, open a PR to `develop`, and merge.

Standard rules apply throughout: never `git add -A`, read every file before editing, no `any` on domain data, no `console.log`, tests required (Hard Rule 4).

---

## 1. What exists today (verified 2026-08-21)

- **`User` model** (`backend/src/models/user.model.js`) is flat — no separate Student model. Fields: `role` (enum `student|parent|coach|admin|superadmin`), `firstName`, `lastName`, `email` (optional, unique+sparse), `passwordHash` (optional — only login-capable roles have one), `parentId` (ObjectId ref User, for students), `skillLevel` (optional enum), `stripeCustomerId` (optional). `toJSON` strips `passwordHash`.
- **Backend today**: only `GET /api/v1/users` exists (`user.routes.js` → `user.controller.js` → inline `User.find(filter)`), gated `requireAuth, requireRole('admin','superadmin')`. **No create, update, delete, or password-reset endpoint for users exists at all.**
- Password hashing: `backend/src/utils/password.js` — `hashPassword`/`comparePassword` via bcryptjs, `SALT_ROUNDS = 10`.
- Public `/auth/register` (`auth.service.js`) always hardcodes `role: 'parent'` — unrelated to this feature, do not touch.
- **Frontend admin CRUD pattern** (established in the CKQ UI adoption plan, Phase 2 — mirror this EXACTLY): see `frontend/app/admin/locations/page.tsx` as the reference file. Pattern: `useLoadState` for the list + local `items` state mirror, one inline modal for create+edit (`dialog.id === null` = create), `AdminPageHeader`, `AdminLoadingRow`/`AdminEmptyRow`, delete-confirm dialog that flips to an error state on a blocked (409) delete, all classes from `frontend/app/components/admin/admin.module.css`.
- **Service layer contract** (`frontend/lib/services/catalog.ts` + `shared.ts`): queries throw, mutations return `MutationResult<T> = {status:'success', data} | {status:'error', message}` via `extractErrorMessage`.
- **Types**: `frontend/lib/types.ts` already has `Role` and `AuthUser` (matches the User model shape).
- **Admin shell nav**: `frontend/app/admin/layout.tsx` — `NAV_SECTIONS` array, currently Programs/Schedule/Places.
- Reference models confirming FK field names for delete guards: `Registration.studentId`, `Subscription.studentId` + `Subscription.parentId`, `TrialClass.studentId`, `GroupClassSchedule.coachId`.

---

## 2. Design decisions (locked)

Adapted from CKQ's real Users-page rules (researched from the live CKQ codebase), simplified for Frisco's flat model, and **deliberately closing two gaps CKQ itself has** (noted below) since we're building this fresh.

| Decision | Rule |
|---|---|
| Who can create whom | `superadmin` can create any role. `admin` can create `student`, `parent`, `coach`, `admin` — **NOT** `superadmin` (backend-enforced, 403). Matches CKQ. |
| Superadmin protection | **Stricter than CKQ** (closing its known gap): a non-superadmin cannot list-with-role-filter, view in an unfiltered "All" listing, edit, delete, or reset the password of any user whose role is `superadmin`. Enforced server-side, not just hidden in the UI. |
| Role after creation | **Immutable.** No role-change UI, and the update endpoint ignores any `role` field in the request body even if sent directly to the API. Matches CKQ. |
| Password | Admin sets it directly in the create form (no invite/email flow needed — Frisco has no email-verification gate on any role). Changing a password is a **separate** action/endpoint from editing profile fields, matching CKQ's split. |
| Self-delete | New safety rule (not in CKQ): a user cannot delete their own account via this page. 400 error. |
| Delete guards | `parent` blocked if any `User` has `parentId` = them. `student` blocked if referenced by any `Registration`, `Subscription`, or `TrialClass`. `coach` blocked if referenced by any `GroupClassSchedule.coachId`. `admin`/`superadmin`: no entity guard (only the self-delete + superadmin-protection rules above apply). |
| Fields shown per role | `student`: firstName, lastName, parent (required picker), email (optional), skill level (optional) — **no password field**. `parent`/`coach`/`admin`/`superadmin`: firstName, lastName, email (required), password (create only, required, min 8 chars). |
| Scope NOT included | Editing a student's `parentId` after creation; bulk actions; CSV import; self-service password reset via email. All out of scope — can be follow-ups. |

---

## 3. Backend changes

**File: `backend/src/services/user.service.js`** (new file)

```js
const User = require('../models/user.model');
const Registration = require('../models/registration.model');
const Subscription = require('../models/subscription.model');
const TrialClass = require('../models/trialClass.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const { hashPassword } = require('../utils/password');

const LOGIN_CAPABLE_ROLES = ['parent', 'coach', 'admin', 'superadmin'];
```

Implement these functions (mirror the existing thrown-error-with-`.status` style from `location.service.js` — no Joi, plain checks):

- **`list(filter, requesterRole)`** — replaces the inline logic currently in the controller. If `requesterRole !== 'superadmin'`: if `filter.role === 'superadmin'` throw 403 ("Forbidden"); otherwise force-exclude superadmin from an unfiltered query (`role: { $ne: 'superadmin' }` when no role filter given, or the requested single role otherwise — since Mongoose filters are exact-match here, just validate then pass through). Return `User.find(mergedFilter)`.
- **`create(data, requesterRole)`**:
  - Validate `role` is one of the 5 valid values; `firstName`/`lastName` non-empty (400 otherwise).
  - If `role === 'superadmin' && requesterRole !== 'superadmin'` → 403 "Admins cannot create superadmin accounts."
  - If `role === 'student'`: require `parentId`; look up that User, 404 if not found, 400 "parentId must reference a parent account" if found but `role !== 'parent'`. Ignore any submitted `password`. `email` optional — if provided, pre-check uniqueness (409, same message style as `auth.service.js`'s register).
  - Else (login-capable role): require `email` and `password` (400 if either missing); pre-check email uniqueness (409); require `password.length >= 8` (400); hash it.
  - `User.create({...})`, return `user.toSafeJSON()`.
- **`update(id, data, requesterRole)`** — edit-profile only, NOT password:
  - Fetch the target user; 404 if missing.
  - If `target.role === 'superadmin' && requesterRole !== 'superadmin'` → 403.
  - Build an update payload containing **only** `firstName`, `lastName`, and (if the target's role is login-capable) `email` — silently drop `role`, `password`, `parentId`, anything else even if present in `data`.
  - If `email` is being changed, pre-check uniqueness against other users (409).
  - `User.findByIdAndUpdate(id, payload, {new:true, runValidators:true})`, return safe JSON.
- **`updatePassword(id, newPassword, requesterRole)`**:
  - Fetch target; 404 if missing. If `target.role === 'superadmin' && requesterRole !== 'superadmin'` → 403.
  - If target's role isn't login-capable → 400 "This account cannot have a password."
  - `newPassword.length >= 8` required (400 otherwise).
  - Hash and `findByIdAndUpdate(id, {passwordHash})`. Return `{success: true}` (no need to return the user).
- **`remove(id, requesterRole, requesterId)`**:
  - `id === requesterId` → 400 "You cannot delete your own account."
  - Fetch target; 404 if missing. If `target.role === 'superadmin' && requesterRole !== 'superadmin'` → 403.
  - Guards by role (409 with a clear count-bearing message, matching `location.service.js`'s phrasing style):
    - `parent`: `User.countDocuments({parentId: id})` > 0 → block.
    - `student`: check `Registration.countDocuments({studentId:id})`, `Subscription.countDocuments({studentId:id})`, `TrialClass.countDocuments({studentId:id})` — any > 0 → block, message naming which.
    - `coach`: `GroupClassSchedule.countDocuments({coachId:id})` > 0 → block.
    - `admin`/`superadmin`: no entity guard.
  - `User.deleteOne({_id:id})`.

**File: `backend/src/controllers/user.controller.js`** — add `create`, `update`, `updatePassword`, `remove` handlers following the exact try/catch → `error.status || 500` pattern already in `list` and in `location.controller.js`. Update `list` to call `userService.list(filter, req.user.role)` instead of the current inline `User.find`.

**File: `backend/src/routes/user.routes.js`** — add:
```js
router.post('/', requireAuth, requireRole('admin', 'superadmin'), create);
router.put('/:id', requireAuth, requireRole('admin', 'superadmin'), update);
router.put('/:id/password', requireAuth, requireRole('admin', 'superadmin'), updatePassword);
router.delete('/:id', requireAuth, requireRole('admin', 'superadmin'), remove);
```

**Tests** (`backend/tests/routes/user.routes.test.js`, `backend/tests/services/user.service.test.js` — follow existing patterns in `backend/tests/`, real `mongodb-memory-server` via `tests/testUtils/db.js`):
- create: each role happy path; admin creating superadmin → 403; student without parentId → 400; student with parentId pointing at a non-parent → 400; duplicate email → 409; password < 8 chars → 400.
- update: profile fields change; role/password fields in payload are silently ignored (assert DB state); admin editing a superadmin → 403; duplicate email on change → 409.
- updatePassword: happy path (verify new password logs in, old one doesn't); target < 8 chars → 400; admin resetting superadmin's password → 403; resetting a student's password → 400.
- remove: happy path per role; self-delete → 400; parent-with-children → 409; student-with-registration/subscription/trial → 409 (one case each); coach-with-schedule → 409; admin deleting superadmin → 403.
- list: admin querying `?role=superadmin` → 403; admin's unfiltered list never contains a superadmin row; superadmin sees everything.

---

## 4. Frontend changes

**File: `frontend/lib/services/users.ts`** (new — same contract as `catalog.ts`)
```ts
export interface CreateUserPayload { role: Role; firstName: string; lastName: string; email?: string; password?: string; parentId?: string; skillLevel?: SkillLevel; }
export interface UpdateUserPayload { firstName: string; lastName: string; email?: string; }
```
`fetchUsers(role?: Role): Promise<AuthUser[]>` (query throws), `createUser`, `updateUser`, `updateUserPassword(id, newPassword)`, `deleteUser` — all mutations return `MutationResult<...>` via `extractErrorMessage`.

**File: `frontend/app/admin/users/page.tsx`** (new)

Structure — Pattern A from `locations/page.tsx`, PLUS role tabs (new sub-pattern for this page only) PLUS a third "change password" dialog:

- Tabs row above the table: `All`, `Parent`, `Coach`, `Admin`, `Student`, and `Superadmin` **only rendered when `useAuth().user.role === 'superadmin'`**. Selected tab drives `fetchUsers(selectedRole)` (pass `undefined` for "All"). Use `?role=` in the URL via `useSearchParams`/`router.replace`, mirroring CKQ.
- Table columns: Name, Role (a small `chip`/`chipMuted` badge), Email (or "—" for a student without one), Actions.
- Row actions: Edit (`Pencil`), **Change Password** (`Key` icon, only shown for login-capable roles), Delete (`Trash2`) — hide/disable Edit/Password/Delete on a row where `row.role === 'superadmin' && currentUser.role !== 'superadmin'` (defense in depth matching the backend).
- **Create/Edit dialog**: role `<select>` shown **only on create** (options = `['student','parent','coach','admin']` plus `'superadmin'` iff current user is superadmin); on edit, render the role as plain text (non-editable), consistent with "role is immutable." Conditionally render fields: if role is `student` → Parent picker (`<select>` populated from `fetchUsers('parent')`), Skill Level (optional select), Email (optional). Else → Email (required), and **only on create** a Password field (required, `type=password`, client-side min-8 hint). On create submit: `createUser(payload)`. On edit submit: `updateUser(id, {firstName,lastName,email?})`.
- **Change Password dialog** (separate, small `dialogSm`): one "New Password" field + a client-side min-8 check, Save → `updateUserPassword(id, value)`, same success/error handling as other dialogs (error banner inline, closes + `retry()`-equivalent isn't needed here since it doesn't change list data — just close on success with a brief inline success state or simply close the dialog).
- Delete-confirm dialog: identical pattern to `locations/page.tsx` (error state flips the dialog to show the backend's 409 message).

**File: `frontend/app/admin/layout.tsx`** — add a new nav section:
```js
{ label: 'People', items: [{ href: '/admin/users', label: 'Users', icon: <Users size={15} /> }] }
```
(`Users` and `Key` are both valid `lucide-react` icons — import alongside the existing icon imports.)

**File: `frontend/app/admin/dashboard/page.tsx`** — add one more quick-link card for "Users" (consistent with the other 5 entities already linked there). Do not add a count fetch for this one unless trivial — a plain link card is enough.

**Tests** (`frontend/app/admin/users/__tests__/page.test.tsx`, follow the existing admin CRUD test pattern — see `frontend/app/admin/locations/__tests__/page.test.tsx` for the MSW/render pattern):
- Tab switching re-fetches with the right role filter; Superadmin tab absent for an admin-role logged-in user, present for superadmin.
- Create: role-conditional fields render correctly (student shows parent picker + no password; parent shows email+password); submit payload asserted exactly; role dropdown excludes `superadmin` when logged in as admin.
- Edit: role field is read-only text, not a select; submit payload contains only firstName/lastName/email.
- Change Password: dialog opens from the Key icon, submits to the password endpoint, not the profile endpoint.
- Delete: happy path removes the row; blocked (409) flips to the "Cannot Delete" error state with the backend message.
- A superadmin-role row's action buttons are hidden/disabled when viewed as `admin`.

---

## 5. Verification (Sonnet runs these; Fable re-runs independently)

- `cd backend && TZ=UTC npm test` — must include the new user tests, full suite green.
- `cd frontend && TZ=UTC npm test -- --ci` — full suite green.
- `cd frontend && npx tsc --noEmit` — 0 errors.
- `cd frontend && npm run build` — succeeds.

## 6. Docs

- `docs/features/admin.md` — add the Users page's behavior spec (columns, role rules, guards) alongside the other admin pages documented there from the prior plan.
- `CLAUDE_HISTORY.md` — one row on ship.

## 7. Report format (Sonnet → Fable)

1. Files created/modified.
2. Every backend authorization/guard rule from §3, confirmed present with the test that proves it.
3. Test results (exact counts, before → after).
4. Any spec deviations and why.
5. `git diff --stat`.

Fable then independently re-verifies (re-run tests, spot-check 2-3 of the guard rules directly), reports to the owner, and **waits for local testing confirmation before committing**, per §0.
