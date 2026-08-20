# CKQ UI Adoption Plan — Admin Sidebar Shell, Parent Portal, Testing & Docs Organization

**Status: APPROVED FOR AUTONOMOUS EXECUTION** (owner approval 2026-08-20).
**Executor:** a Claude Code session running the **Sonnet** model, working in `C:\Users\mages\friscofencing`.
**Planner:** Fable (this doc). The executing session implements; it does not re-litigate the design.

---

## 0. Execution contract — READ FIRST

You (the executing session) run **all 7 phases (0–6) sequentially, without stopping for user approval between phases**. The owner has pre-approved this entire plan; their instruction to execute it is the standing `write` for every file change the plan specifies.

**Owner-granted overrides of CLAUDE.md hard rules, valid ONLY within this plan's scope:**
- You may fix failing tests without stopping for approval (normally forbidden). Diagnose root cause, fix properly, log it in your phase report. Never weaken/delete an assertion to make it pass — fix the code or the test's setup.
- You may commit, push, open PRs, and merge each phase to `develop` without per-phase owner sign-off.

**Rules that still hold, NO exceptions:**
- **NEVER merge or push to `main`.** All 7 phases land on `develop` only. Production promotion is a separate owner decision after this run.
- Never `git add .` / `git add -A` — stage files explicitly by name.
- Never touch the production database or any Vercel settings.
- No `console.log` in production code. No `any` on domain data — fix the type against the real backend shape.
- Read every file before editing it. Follow existing patterns.
- **Payment-critical caution:** Phase 4 restyles the registration/trial flows UI-ONLY. The API endpoints, request payloads, and all backend payment code must remain byte-identical in behavior. If a payload must change, STOP and report — do not improvise.

**Per-phase loop (repeat for each phase):**
1. `git checkout develop && git pull origin develop`
2. `git checkout -b feature/ui-phase-<N>-<short-name>` — VERIFY with `git branch --show-current` before any edit
3. Do the phase's pre-reads (listed per phase). CKQ reference files live in `C:\Users\mages\chesskqwebsite\websitepublic\website2.0` — read them for structure/patterns; you are adapting, never copy-pasting CKQ brand values.
4. Implement per spec. Write the phase's tests.
5. **Gates — ALL must pass before commit:**
   - `cd backend && npm test` (only if the phase touches backend)
   - `cd frontend && npm test`
   - `cd frontend && npx tsc --noEmit` → **0 errors** (from Phase 0 onward this is a hard gate)
   - `cd frontend && npm run build`
6. Append the phase's row to `CLAUDE_HISTORY.md`; make the phase's doc updates (listed per phase).
7. Commit (explicit file staging; message format below), push, `gh pr create --base develop`, `gh pr merge --merge`, `git checkout develop && git pull`, delete the feature branch.
8. Record the phase's report section (accumulate for the final report), then start the next phase.

Commit message format: `<type>: <summary>` body listing key changes, ending with:
`Co-Authored-By: Claude Sonnet <noreply@anthropic.com>`

**Hard stop conditions (the ONLY reasons to halt and report to the owner):** a gate that cannot go green after genuine root-cause fixing; a required backend behavior change beyond what a phase specifies; anything destructive or production-touching. Otherwise: make the reasonable call, log it, continue.

**Final deliverable** after Phase 6: the consolidated report specified in §10.

---

## 1. Locked decisions (owner-approved — do not reopen)

| Decision | Choice |
|---|---|
| Visual identity | **CKQ layout & UX patterns, Frisco brand** — keep Frisco tokens (ink `#1B1A17`, gold `#C8A000` accent-only, Saira/Saira Condensed). Never import CKQ colors (navy/sky/blue) or fonts (Outfit/Playfair). |
| CSS foundation | **CSS Modules only.** No Bootstrap, no Tailwind, no MUI. |
| Admin shell | CKQ-style dark sidebar shell: 220px desktop → 64px icon-only tablet → mobile drawer + top bar. |
| Parent portal | CKQ-style `PortalLayout`: grouped sidebar + per-child rows + mobile bottom tab bar. |
| Admin CRUD | CKQ "Pattern A": one inline modal for create+edit (`dialog.id === null` = create), small delete-confirm dialog, optimistic row removal. This delivers the missing edit/delete. |
| Schedule edit/delete | **Still deferred** (ripple effects on generated sessions/rosters). Schedules stay create+list in this plan. |
| Coach pages | **Out of scope.** Coach keeps the existing top-bar AppShell. Do not break coach pages. |
| Icons | `lucide-react` (same as CKQ). |
| Services contract | CKQ's: **queries throw** on failure; **mutations never throw**, returning `{ status: 'success', ... } \| { status: 'error', message }`. |

**Brand adaptation table (use everywhere a CKQ reference shows its own palette):**

| Role | CKQ value (do not use) | Frisco value |
|---|---|---|
| Sidebar background | `#0f172a` navy | `--color-ink` `#1B1A17` |
| Sidebar text / muted | `#94a3b8` / `#64748b` | `rgba(250,249,246,.72)` / `rgba(250,249,246,.45)` (define as tokens) |
| Sidebar active accent | `#38bdf8` sky | `--color-gold` `#C8A000` |
| Active item bg | `rgba(56,189,248,.08)` | `rgba(200,160,0,.12)` |
| Sidebar border | `rgba(255,255,255,.08)` | same (works on ink) |
| Content area bg | `#f1f5f9` | `--color-bg` `#FAF9F6` |
| Headings/nav font | system | `--font-heading` (Saira Condensed) |
| Body font | system | `--font-body` (Saira) |

---

## 2. Current state (verified 2026-08-20 — trust this, but pre-read anyway)

- Frontend: Next.js 14 App Router, 17 pages, all wrapped per-page in `<ProtectedRoute><AppShell>`. `AppShell` (`frontend/app/components/layout/AppShell.tsx`) is a top bar only — **no sidebar exists anywhere**. Nav config: `NAV_LINKS_BY_ROLE` inside AppShell.
- UI components: `Button` (4 variants), `Alert` (success/error), `Card`, `shared.module.css` (pageHeader/table/form classes). Only 5 CSS module files total; pages use inline styles for layout.
- Admin pages (`app/admin/{locations,levels,classes,schedules,prices}/page.tsx` + `schedules/[id]/sessions`): **create + list only, no edit/delete UI**. Backend `PUT /:id` and `DELETE /:id` routes exist for all five entities with admin/superadmin guards.
- Parent pages: `children`, `book-trial`, `register`, `subscriptions`, `payment-method`. No dashboard, no child detail page. Pages call `lib/api.ts` (axios) directly with local try/catch.
- Tests: frontend 11 files/~41 tests (MSW wildcard-host handlers `http.get('*/auth/me')`, real `AuthProvider` wrapper, `jest.mock('next/navigation')`); backend 19 files/95 tests (supertest + mongodb-memory-server via `tests/testUtils/db.js`). **AppShell has zero test coverage.**
- Known issue to fix in Phase 0: `npx tsc --noEmit` in frontend fails with ~66 errors — all missing jest-dom matcher types in test files.
- Docs: `docs/TESTING_STRATEGY.md` (17 lines), `docs/design-system.md` (48 lines), `docs/decisions/001-in-house-subscription-billing.md`, `docs/plans/`. **Missing:** `docs/TEST_COVERAGE.md`, `docs/features/`, `docs/modules/`, `docs/decisions/README.md`.

**CKQ reference files** (read-only source of structural truth; base `C:\Users\mages\chesskqwebsite\websitepublic\website2.0\src\app`):
- Admin shell: `(nonheadless)/admin/layout.tsx` + `layout.module.css`
- Admin design system: `components/admin/admin.module.css`; primitives `components/admin/AdminPageHeader.tsx`, `AdminTableRows.tsx`
- Admin CRUD Pattern A: `(nonheadless)/admin/locations/page.tsx`; delete-confirm + list patterns: `(nonheadless)/admin/users/page.tsx`
- Portal layout: `components/portal/PortalLayout/index.tsx` + `portal-shell.module.css`; parent shell: `components/portal/ParentPortalShell/index.tsx`
- Parent context: `context/ParentPortalContext.tsx`; error kit: `hooks/useLoadState.ts`, `components/portal/ui/LoadError/index.tsx`
- Flow kit: `components/portal/ui/flow/` (FlowMain, FlowStepper, FlowSection, pickers, OrderSummary, FlowConfirmation)
- Parent dashboard: `(nonheadless)/portal/@parent/dashboard/page.tsx`

---

## 3. Phase 0 — Foundations

**Branch:** `feature/ui-phase-0-foundations`
**Pre-reads:** `frontend/tsconfig.json`, `frontend/jest.setup.js`, `frontend/lib/api.ts`, every `backend/src/controllers/*.js` response shape you type against, 2–3 existing page files to see current inline API calls, CKQ `hooks/useLoadState.ts` + `LoadError/index.tsx`.

1. **Dependency:** `cd frontend && npm install lucide-react` (regenerate `package-lock.json` — frisco frontend uses npm, no yarn.lock here).
2. **Fix jest-dom types (66 tsc errors):** create `frontend/types/jest-dom.d.ts` containing `import '@testing-library/jest-dom';` and ensure `tsconfig.json` `include` covers `types/**/*.d.ts`. Verify `npx tsc --noEmit` → 0. If any non-jest-dom errors remain, fix them properly (no `any`-casts).
3. **`frontend/lib/types.ts`:** domain interfaces typed against the REAL backend responses (read the controllers/models, not guesses): `AuthUser`, `Location`, `Level`, `GroupClass`, `GroupClassSchedule`, `GroupClassSession`, `Price`, `Student`, `TrialClass`, `Registration`, `Subscription`, `PaymentMethodInfo`. Move duplicated inline interfaces out of pages progressively as later phases touch them (don't sweep all 17 pages now).
4. **`frontend/lib/services/`** — one file per domain: `catalog.ts` (locations, levels, groupClasses, prices), `scheduling.ts` (schedules, sessions, attendance), `parent.ts` (students, trialClasses, registrations, subscriptions, paymentMethods). Contract:
   - Query functions (`fetchX`): call `api.get`, return typed data, **let errors throw**.
   - Mutation functions (`createX/updateX/deleteX/...`): try/catch, return `{ status: 'success', data? }` or `{ status: 'error', message }` where message = `error.response?.data?.message ?? '<generic verb failure>'`. **Never throw.**
5. **`frontend/lib/hooks/useLoadState.ts`:** `useLoadState<T>(fetcher, deps) => { data, error, isLoading, retry }`. Behavior (mirror CKQ): fetcher kept in a ref (callers needn't memoize); `data` reset to `null` at start of each fetch; `retry()` bumps an internal attempt counter in deps; no caching/dedup. Also export `getErrorMessage(err): string` — return backend `error.response.data.message` only for 4xx except 404; otherwise a generic "Something went wrong — please try again."
6. **`frontend/app/components/ui/LoadError/`** (`LoadError.tsx` + module CSS): `{ message?, onRetry?, compact? }`, `role="alert"`, message + secondary "Try again" `Button`. Inline replacement for failed content — never a modal.
7. **`frontend/app/globals.css`** — append shell tokens on `:root`: `--sidebar-w: 220px; --sidebar-icon-w: 64px; --topbar-h: 52px; --bottomnav-h: 60px; --sidebar-bg: #1B1A17; --sidebar-text: rgba(250,249,246,.72); --sidebar-muted: rgba(250,249,246,.45); --sidebar-border: rgba(255,255,255,.08); --sidebar-active: #C8A000; --sidebar-active-bg: rgba(200,160,0,.12);`
8. **Tests:** `useLoadState` (success, error, retry, data-reset-on-refetch), `getErrorMessage` (400-with-message / 404 / 500 / network), `LoadError` render + retry click, one service file exercised through MSW (query throws on 500; mutation returns `{status:'error'}` on 500 — assert it does NOT throw).
9. **Docs:** append the new tokens to `docs/design-system.md`.

---

## 4. Phase 1 — Admin sidebar shell

**Branch:** `feature/ui-phase-1-admin-shell`
**Pre-reads:** CKQ `(nonheadless)/admin/layout.tsx` + `layout.module.css` + `components/admin/admin.module.css` + `AdminPageHeader.tsx` + `AdminTableRows.tsx`; frisco `AppShell.tsx`, `ProtectedRoute.tsx`, `app/page.tsx`, all 6 admin page files.

1. **`frontend/app/admin/layout.tsx`** (`'use client'`) — the shell. Structure (adapt CKQ, frisco brand):
   - Role gate: while `AuthContext.loading` render a minimal loading screen; if no user or role not in `['admin','superadmin']`, `router.push('/')` in an effect and render `null`.
   - `NAV_SECTIONS` hardcoded in this file (CKQ convention): Dashboard rendered standalone above sections (exact-match active), then sections **Programs** (Classes `/admin/classes` icon `Swords`, Levels `/admin/levels` icon `GraduationCap`, Prices `/admin/prices` icon `DollarSign`), **Schedule** (Schedules `/admin/schedules` icon `CalendarDays`), **Places** (Locations `/admin/locations` icon `MapPin`). Dashboard icon `LayoutDashboard`. All items roles `['admin','superadmin']`.
   - Active logic: `pathname === href || (href !== '/admin/dashboard' && pathname.startsWith(href))`.
   - Accordion: `openSections` state; effect on `[pathname]` auto-opens the section containing the active route and closes others.
   - Mobile: `mobileOpen` state; top bar (hamburger + "FRISCO FENCING" wordmark) shows <768px; overlay click and nav-link click close the drawer.
   - Sidebar top = brand block (wordmark + gold dot, role label under it); bottom = sidebarFooter with `Welcome, {firstName}` + logout button (reuse `AuthContext.logout`).
2. **`frontend/app/admin/layout.module.css`** — CKQ geometry with frisco tokens: `.layout{display:flex;min-height:100vh}`; `.sidebar{width:var(--sidebar-w);position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--sidebar-bg)}`; `.main{flex:1;padding:var(--space-5);background:var(--color-bg);min-width:0}`. Breakpoints: `@media (max-width:1023px)` icon-only 64px (hide labels/chevrons, center icons); `@media (max-width:767px)` column layout, sticky top bar `var(--topbar-h)`, sidebar `position:fixed;left:-100%;width:var(--sidebar-w);transition:left .25s;z-index:200` + `.sidebarMobileOpen{left:0}` + overlay `rgba(0,0,0,.5)` z-199, and re-show labels inside the open drawer.
3. **Unwrap admin pages:** remove `<ProtectedRoute>` + `<AppShell>` wrappers from all 6 admin page files (the layout now provides both chrome and gating). Page content otherwise unchanged in this phase.
4. **`frontend/app/admin/page.tsx`:** server component, `redirect('/admin/dashboard')`.
5. **`frontend/app/admin/dashboard/page.tsx`:** minimal — `AdminPageHeader title="Dashboard"`, a stat-card row (counts of classes / schedules / locations / levels from the Phase-0 catalog/scheduling query services via `useLoadState`, `LoadError` on failure), and a quick-links card grid to the five admin sections. Raw list counts only — no derived business metrics.
6. **`frontend/app/components/admin/admin.module.css`** (~350–450 lines, frisco-token'd): sections for page header row, buttons (`btn`, `btnPrimary`, `btnSecondary`, `btnDanger`, `btnDangerFilled`, `btnSm`, `btnIcon`, `btnIconEdit`, `btnIconDelete`, `actionBtns`), table (`tableWrap`, `table`, `tHead`, `th`, `td`, `trHover`, `tdRight`, `cellMuted`), states (`loadingCell`, `emptyCell`, `spinner`, `spinnerSm`), dialog (`overlay` z-400, `dialog` max-500px `role="dialog"`, `dialogSm` 380, `dialogHeader`, `dialogBody`, `dialogFooter`, `dialogClose`), form (`formGroup`, `formRow`, `label`, `input`, `select`, `errorText`, `formHint`), minimal chips (`chip`, `chipActive`, `chipMuted`), stat cards for the dashboard. **Every color via `var(--...)` tokens — zero raw hex.** Define once; do not duplicate class names (CKQ has a known double-`.pageHeader` bug — don't replicate it).
7. **`frontend/app/components/admin/AdminPageHeader.tsx`** (`{title, count?, subtitle?}` — subtitle defaults to `` `${count} total` `` when count given) and **`AdminTableRows.tsx`** (`AdminLoadingRow({colSpan})`, `AdminEmptyRow({colSpan, message?})`).
8. **`AppShell.tsx`:** remove the `admin`/`superadmin` entries from `NAV_LINKS_BY_ROLE` (admins no longer use the top bar). In `app/page.tsx`, ensure the admin role's home cards point to `/admin/dashboard`.
9. **Tests:** admin layout — renders sections for admin, redirects parent to `/`, active item by pathname, mobile drawer open/close, logout wired; dashboard — loading row → counts render, error → `LoadError` with retry; redirect page. Update any existing admin page tests broken by the unwrap (they render page components directly with MSW — removing wrappers should be low-impact; if a test asserted AppShell chrome, adjust the assertion, don't delete the test).
10. **Docs:** `docs/design-system.md` — new "Admin shell" section (structure, tokens, breakpoints, when to use `admin.module.css` vs `shared.module.css`).

---

## 5. Phase 2 — Admin CRUD rebuild (delivers edit/delete)

**Branch:** `feature/ui-phase-2-admin-crud`
**Pre-reads:** CKQ `admin/locations/page.tsx` (Pattern A) + `admin/users/page.tsx` (delete pattern); frisco backend `src/services/{location,level,groupClass,price,groupClassSchedule}.service.js` + their routes/controllers; all frisco admin pages; `backend/tests/routes/*.routes.test.js` patterns.

**Backend first — in-use delete guards.** For each entity, `remove` must refuse deletion with a `409` + clear message when referenced: Location (referenced by any GroupClass), Level (by any GroupClass or Price), GroupClass (by any GroupClassSchedule), Price (freely deletable unless a model reference exists — verify in code). Verify existing service behavior before writing; add guards only where missing. Backend tests: one delete-success + one delete-blocked (409) per guarded entity, plus existing suites stay green.

**Frontend — rebuild 4 pages onto Pattern A** (`locations`, `levels`, `prices`, `classes`), each:
- State: `items`, `loading`, `pageError`, `dialog: { open, id: string|null, form }`, `dialogError`, `saving`, `deleteTarget: {id, name} | null`, `deleting`, `deleteError`.
- `load()` via the Phase-0 query service inside `useLoadState` OR a local async fn (pick ONE convention: use `useLoadState` + `LoadError` for the list, local state for dialogs — apply identically across all 4 pages).
- Header: `AdminPageHeader` + `btnPrimary` "Add <Entity>" opening the dialog with `id: null`.
- Table: `tableWrap/table` classes, `AdminLoadingRow`/`AdminEmptyRow`, per-row `btnIconEdit` (opens dialog prefilled, `id` set) and `btnIconDelete` (sets `deleteTarget`), icons `Pencil`/`Trash2`.
- Create/edit modal: inline in the page (CKQ convention — no shared Modal component), overlay click-away (disabled while saving), `dialogHeader` title switches "Add"/"Edit", `dialogBody` with form fields + `<Alert variant="error">` for `dialogError`, `dialogFooter` Cancel + Save (`saving ? 'Saving…' : dialog.id ? 'Save Changes' : 'Create'`). Submit → `create`/`update` mutation service → on `status==='error'` set `dialogError`; on success close + `reload()`.
- Delete confirm: `dialogSm` — `Delete "<name>"? This cannot be undone.` Cancel + `btnDangerFilled`. On success remove the row optimistically. On `status==='error'` (incl. the new 409 messages) flip the same dialog to an error state (title "Cannot Delete", body = message, single Close button).
- Move page-local interfaces to `lib/types.ts`; all API calls through services.

**Schedules page:** restyle onto shell + new table classes + `AdminPageHeader`; keep create form (modal-ify it for consistency); **no edit/delete** — add a muted table-footer note "Schedules can't be edited once created — create a new one instead." Sessions page (`admin/schedules/[id]/sessions`): restyle table + header only. Attendance page (`app/sessions/[id]/attendance`): **leave functionally untouched** (shared with coach; still uses AppShell).

**Tests per rebuilt page:** list render, create (POST payload exact), edit (prefill + PUT payload exact), delete happy path (row removed), delete-blocked 409 (error dialog shows backend message), dialog error on failed save. Frontend suite + backend suite green.

**Docs:** create `docs/features/admin.md` — per-page behavior spec (columns, dialogs, guards, deferred schedule-edit note).

---

## 6. Phase 3 — Parent portal shell, context, dashboard

**Branch:** `feature/ui-phase-3-parent-shell`
**Pre-reads:** CKQ `PortalLayout/index.tsx` + `portal-shell.module.css`, `ParentPortalShell/index.tsx`, `ParentPortalContext.tsx`, `@parent/dashboard/page.tsx`; frisco parent pages (all 5) noting every endpoint they call; `AuthContext.tsx`.

1. **`frontend/app/components/portal/PortalLayout/`** (component + `portal-shell.module.css`): props `{ navGroups: {label?: string; items?: NavItem[]; content?: ReactNode}[], header?: ReactNode, bottomNavItems: NavItem[], children }`. Renders sidebar (light surface — white bg, `--color-border` right border, ink text, gold active-left-border; the DARK treatment is admin-only), right area (header bar + main), and a fixed bottom tab bar ≤768px (`--bottomnav-h`, icon + tiny label, gold active). Breakpoints: ≥1025 sidebar 220px sticky; 769–1024 icon-only 64px; ≤768 sidebar hidden + bottom nav shown. Active = longest-href-prefix match of pathname.
2. **`frontend/app/components/portal/ParentPortalShell/`**: wraps `PortalLayout` with groups — **HOME**: Dashboard `/parent/dashboard` (icon `Home`); **CHILDREN**: custom content = one row per `students` entry (initial-letter avatar with deterministic per-child palette — add `lib/childPalette.ts` with 4 gold/ink-harmonious gradient pairs assigned by index — name + meta line "Trial booked" / "Enrolled" / "Not enrolled") linking to `/parent/children` in this phase (Phase 5 repoints to `/parent/child/[id]`), plus an "+ Add child" row linking to `/parent/children`; **ACADEMY**: Book Trial `/parent/book-trial` (`CalendarPlus`), Register `/parent/register` (`ClipboardList`), Billing `/parent/subscriptions` (`CreditCard`), Payment Method `/parent/payment-method` (`Wallet`). Header: "Welcome back, {firstName}" + today's date; children-count chip. Bottom nav (4): Home, Children, Register, Billing.
3. **`frontend/app/context/ParentPortalContext.tsx`:** provider fetching via `Promise.allSettled`: students, subscriptions, trial classes (reuse the exact endpoints the current pages call — verify in pre-read). Exposes `{ students, subscriptions, trialClasses, loading, error, reload }`. `error` only when the PRIMARY fetch (students) fails — empty household is NOT an error. Secondary fetch failures degrade to `[]`.
4. **`frontend/app/parent/layout.tsx`:** role gate (parent only — mirror admin layout's gate) + `<ParentPortalProvider><ParentPortalShell>{children}</ParentPortalShell></ParentPortalProvider>`. Remove `<ProtectedRoute>`+`<AppShell>` wrappers from all 5 parent pages.
5. **`frontend/app/parent/dashboard/page.tsx`:** three states — context `loading` → spinner; `students.length === 0` → EmptyState onboarding stepper (`Account Created` ✓ → `Add Your Child` (current, CTA button → `/parent/children`) → `Book a Trial` (todo)); else 2-col grid: left = one at-a-glance card per child (palette avatar, name, status line: scheduled-trial info if trial && no active registration, else active registration summary, else "Not enrolled" + green "Book a free trial →" CTA), right rail = Quick Actions card (Book Trial / Register / Payment Method links). Data from context only — **no fetching in the page**.
6. `AppShell.tsx`: remove `parent` entries from `NAV_LINKS_BY_ROLE` (AppShell now serves coach + logged-out only). `app/page.tsx`: parent home cards → `/parent/dashboard`.
7. **Children page:** consume context (`students`, `reload()` after add) instead of its own fetch; restyle onto portal card/table classes; keep the add-child form inline (modal comes in Phase 5).
8. **Tests:** PortalLayout (groups render, active state, bottom nav ≤768 presence), ParentPortalShell (child rows + meta states), context (allSettled isolation: students-fail → error; subscriptions-fail → students still render), dashboard (all 3 states), updated page tests (wrap in provider or mock context — prefer rendering with real provider + MSW).
9. **Docs:** create `docs/features/parent-portal.md` (shell structure, context contract, page inventory); design-system.md "Portal shell" section.

---

## 7. Phase 4 — Registration flow wizards

**Branch:** `feature/ui-phase-4-flows`
**Pre-reads:** CKQ `components/portal/ui/flow/` (all files) + `@parent/register/trial/page.tsx`; frisco `parent/book-trial/page.tsx` + `parent/register/page.tsx` + their tests (payload assertions!) + `parent/payment-method/page.tsx`.

1. **`frontend/app/components/portal/flow/`** (+ `flow.module.css`): `FlowMain` (`{crumbs, eyebrow, title, steps?, current, summary?, singleColumn?, children}` — two-col grid: content + sticky summary rail, collapses to single column on confirmation), `FlowStepper` (numbered circles, gold active, check when done), `FlowSection` (`{title, children}`), `ChildPickerCards` (radio-card per child with palette avatar), `OrderSummary` (`{lines: {label, value}[], cta, ctaDisabled, ctaLoading, onCta, note?}` — THE advance/submit button lives here), `FlowConfirmation` (success panel with detail lines + next-step links). Breadcrumb inline in FlowMain (Home → flow name).
2. **Book-trial → 3-step wizard** (Who → Pick a class → Confirmation): step state local (`useState(0)`), module-level `STEPS`. Step 0 `ChildPickerCards` (from context; deep-link `?child=` preselect). Step 1 = existing class→schedule→session cascade restyled as `FlowSection`s. Summary rail shows child + selection; CTA advances/submits. **The POST endpoint and payload stay byte-identical** — existing tests asserting the payload must pass with only render-flow updates.
3. **Register → 4-step wizard** (Who → Class → Review & Pay → Done): same rules. The saved-payment-method guard moves to the Review step (no card → inline notice + link to `/parent/payment-method`, CTA disabled). **Payment-critical: request payloads and sequencing unchanged.**
4. **Payment-method page:** restyle onto portal card patterns (heading, card-on-file display, Stripe CardElement section) — logic untouched.
5. **Tests:** flow components (stepper states, CTA disabled/loading, summary lines); both wizards — full walk-through with MSW asserting the exact POST payloads (reuse/adapt the existing payload assertions), back-navigation preserves selections, guard behavior on register.
6. **Docs:** parent-portal.md — flows section; design-system.md — flow pattern.

---

## 8. Phase 5 — Child detail page + AddChildModal

**Branch:** `feature/ui-phase-5-child-detail`
**Pre-reads:** CKQ `@parent/child/[id]/page.tsx` + `ProfileHeader.tsx` (URL-param tab pattern); frisco context, children page, backend student/trial/registration/subscription endpoints (what per-child data actually exists).

1. **`frontend/app/parent/child/[id]/page.tsx`:** client page reading `students.find(s => s._id === id)` from context (no new fetch; if child not found after loading → inline "Child not found" + link back). Header: palette avatar, name, meta (level if present, trial/enrollment status pill). **Tabs via `?tab=` URL param** (Links with `role="tab"`, `aria-selected`), validated against a Set: **Overview** (trial status card, active registration/subscription card incl. schedule days + cancel entry point linking to Billing) and **Schedule** (upcoming sessions derived from the child's registration's schedule data available in context — display-only; if the data isn't in context, show the schedule's recurring day/time pattern rather than adding endpoints).
2. **`frontend/app/components/portal/AddChildModal/`:** extract the children page's add-child form into a modal (portal dialog styles); used by: children page ("Add child" button), ParentPortalShell sidebar "+ Add child" row (becomes a button opening it), dashboard empty-state CTA. `onSuccess` → context `reload()`.
3. Sidebar child rows + dashboard child cards now link to `/parent/child/[id]`.
4. **Tests:** child page (both tabs, invalid tab falls back to overview, not-found state), AddChildModal (POST payload, reload called, validation error display), sidebar row navigation.
5. **Docs:** parent-portal.md updated (child page + modal).

---

## 9. Phase 6 — Testing & docs organization (CKQ-style)

**Branch:** `feature/ui-phase-6-docs-testing`
**Pre-reads:** CKQ workspace docs at `C:\Users\mages\chesskqwebsite\docs\`: `TESTING_STRATEGY.md`, `TEST_COVERAGE.md`, `decisions/README.md`, `design-system.md` (section structure). Frisco: everything under `docs/`, both test suites.

1. **`docs/TESTING_STRATEGY.md`** — expand (~150–250 lines), frisco-adapted CKQ rules: layer definitions (backend unit/services/route-integration via memory-server; frontend component/hook/util); mocking rules (**MSW at the network boundary — never `jest.mock` a service module for HTTP**; `jest.mock` IS correct for `next/navigation`, context providers in isolation tests, Stripe Elements; never assert "service was called"); interaction rule (`userEvent.setup()` only, no `fireEvent` for clicks/typing in new tests); date rules (never sample the real clock against a "today"-computing subject — freeze with `jest.useFakeTimers().setSystemTime()`; fixture instants at midday UTC `T12:00:00Z`; run suites with `TZ=UTC` to reproduce CI); typed fixtures (real domain types from `lib/types.ts`, no `any` — an ill-typed fixture means the type is wrong); naming/placement conventions (current frisco patterns, codified); isolation rules; what-NOT-to-test list; the error-handling contract (queries throw / `LoadError` inline / mutations return status objects) and how to test each side.
2. **`docs/TEST_COVERAGE.md`** — CKQ skeleton: per-repo `##` with **Current State** (one bold headline count line — run both suites and record REAL numbers + date + `TZ=UTC` note), layer table (Layer | Location | What it tests | DB?), Coverage Gaps (list untested pages/components honestly — include anything this plan's phases left untested), Intentionally Skipped (attendance page restyle, schedule edit, coach pages — with reasons), Improvement Plan (short).
3. **`docs/decisions/README.md`** — index table (`# | Title | Status | Date`) listing ADR 001 and the new **`002-ckq-ui-adoption.md`** you write now: records the locked decisions of §1 (CKQ structure/frisco brand, CSS modules only, services contract, Pattern A CRUD, deferred schedule-edit) with rationale. Status definitions list (Proposed/Accepted/Superseded).
4. **`docs/design-system.md`** — consolidate to CKQ's shape at frisco scale: Principles → Tokens → Shells (admin dark sidebar / portal light sidebar / AppShell legacy-coach) → Page patterns (admin CRUD Pattern A; portal dashboard; flow wizard) → Components inventory → **Anti-patterns** (seed ~6: raw hex in module CSS; hand-rolled `.btnPrimary`; `jest.mock` at service boundary; inline styles for reusable layout; per-page duplicate domain interfaces; modal for load errors) → Pre-merge checklist.
5. **`CLAUDE.md`** — update: Documentation Map rows for all new/changed docs; add a **pre-read requirements table** (touching admin pages → `docs/features/admin.md`; parent portal → `docs/features/parent-portal.md`; any test → `TESTING_STRATEGY.md`; CSS → `design-system.md`); mark this plan SHIPPED in the map.
6. **`CLAUDE_HISTORY.md`** — ensure one row per phase exists (added at each phase's ship; backfill any missing).
7. Gates still run (docs-only phase normally skips tests, but run both suites + tsc once more as the final full-green confirmation for the report).

---

## 10. Final report (deliver to the owner after Phase 6)

One consolidated message containing:
1. **Per-phase table:** phase | PR # | merged | files touched | test delta (suite counts before→after) | notable decisions made autonomously | anything deferred/skipped and why.
2. **Final gate outputs:** backend suite count, frontend suite count, `tsc --noEmit` = 0, `next build` OK.
3. **Staging walkthrough checklist for the owner** (bullet list): admin login → sidebar, dashboard, each CRUD page incl. edit + delete + blocked-delete; parent login → dashboard (empty + populated), child sidebar rows, child detail tabs, add-child modal, trial wizard, register wizard, mobile-width bottom nav.
4. **Honesty section:** real bugs found and fixed during the run; known gaps not fixed; any spec deviations with reasons.
5. Reminder that everything is on `develop`/staging only, and production promotion (`develop → main`) awaits the owner's explicit approval.

---

## Out of scope (do not build)

Coach pages/shell · student portal · CKQ's view-as impersonation, premium/membership machinery, 4-layer alert hierarchy, agent chat · Bootstrap · stylelint CI · schedule edit/delete · attendance page redesign · any backend change beyond Phase 2's delete guards · production merge.
