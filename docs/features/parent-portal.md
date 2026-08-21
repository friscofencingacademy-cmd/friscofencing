# Parent portal

Shell structure, context contract, and page inventory for the parent-facing portal (`frontend/app/parent/`). Shell CSS/tokens live in `docs/design-system.md`'s "Portal shell" section — this doc covers the shell's data contract and per-page behavior.

## Shell (`app/parent/layout.tsx`)

Role-gated (parent only — mirrors the admin layout's gate: redirects to `/` for any other role or a logged-out visitor) and wraps every `/parent/*` page in `<ParentPortalProvider><ParentPortalShell>{children}</ParentPortalShell></ParentPortalProvider>`. No parent page wraps itself in `<ProtectedRoute>`/`<AppShell>` any more — `AppShell` now serves coach + logged-out visitors only.

## `ParentPortalContext` (`app/context/ParentPortalContext.tsx`)

Fetches the household's `students`, `subscriptions` (`/registrations/mine`), and `trialClasses` (`/trial-classes/mine`) via `Promise.allSettled` — **not** `Promise.all` — so a temporary billing/trial outage never blocks the children list from rendering, and a students-only household isn't held hostage by a flaky secondary endpoint.

Contract: `{ students, subscriptions, trialClasses, loading, error, reload }`.

- `error` is set **only** when the PRIMARY fetch (`students`) fails. An empty household (zero children, no fetch failure) is explicitly NOT an error.
- A failed secondary fetch (subscriptions or trial classes) silently degrades to `[]` — the rest of the portal still renders with whatever data did load.
- `reload()` re-runs all three fetches (used after a mutation like adding a child).

Every `/parent/*` page that needs household data consumes this context — **no page-level fetching** for students/subscriptions/trials any more (the book-trial/register/payment-method pages still do their own local fetches for page-specific option lists like classes/schedules/prices, which are out of this context's scope).

## `ParentPortalShell` (`app/components/portal/ParentPortalShell/`)

Wraps the generic `PortalLayout` with parent-specific nav groups:

- **HOME** — Dashboard (`/parent/dashboard`).
- **CHILDREN** — custom content: one row per student (initial-letter avatar with a deterministic per-child palette from `lib/childPalette.ts`, 4 gold/ink-harmonious gradient pairs assigned by index) showing a status line — `Enrolled` / `Trial booked` / `Not enrolled` — plus a "+ Add child" row. All rows link to `/parent/children` in this phase; Phase 5 repoints per-child rows to `/parent/child/[id]`.
- **ACADEMY** — Book Trial, Register, Billing (`/parent/subscriptions`), Payment Method.

Header: "Welcome back, {firstName}" + today's date, plus a children-count chip. Mobile bottom nav (≤768px, 4 items): Home, Children, Register, Billing.

## `PortalLayout` (`app/components/portal/PortalLayout/`)

The reusable shell primitive: `{ navGroups, header?, bottomNavItems, children }`. Renders a **light** sidebar (white background, `--color-border` divider, ink text, gold active-left-border — never the admin shell's dark treatment), a right area (optional sticky header + main), and a fixed bottom tab bar on mobile. Active state = longest-href-prefix match of the current pathname, computed independently for the sidebar item set and the bottom-nav item set (they aren't always the same items). Breakpoints: ≥1025px full 220px sidebar; 769–1024px icon-only 64px sidebar; ≤768px sidebar hidden, bottom nav shown.

## Page inventory

| Page | Behavior |
|---|---|
| `/parent/dashboard` | Three states, all driven by `ParentPortalContext` (no page-level fetching): loading spinner; `students.length === 0` → onboarding stepper (Account Created ✓ → Add Your Child, current, CTA → `/parent/children` → Book a Trial, upcoming); else a 2-column grid — left: one at-a-glance card per child (palette avatar, name, status line, and a "Book a free trial →" CTA only on not-yet-enrolled children), right: a Quick Actions card (Book Trial / Register / Payment Method). |
| `/parent/children` | Consumes `students` from context (no own fetch); the inline "Add Child" form calls the `createStudent` mutation service and `reload()`s the context on success — no local student-list state any more. A dedicated `AddChildModal` extraction is Phase 5; the form stays inline for now. |
| `/parent/book-trial` | Unchanged logic — still fetches its own class/schedule/session option lists (page-specific, not household data) and posts to `/trial-classes`. Only unwrapped from `ProtectedRoute`/`AppShell`. |
| `/parent/register` | Unchanged logic (payment-critical: request payload/sequencing untouched per the plan's Phase 4 caution — Phase 4 restyles this into a wizard). Only unwrapped from `ProtectedRoute`/`AppShell`. |
| `/parent/subscriptions` | Unchanged logic. Only unwrapped from `ProtectedRoute`/`AppShell`. |
| `/parent/payment-method` | Unchanged logic (Stripe CardElement flow). Only unwrapped from `ProtectedRoute`/`AppShell`. |
