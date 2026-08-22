# Frisco Fencing Academy — Design System

Short by design — this is primarily a data-dense admin/CRM app, plus a small public marketing surface (`/`, `/classes`, `/coaches`, `/register`, `/login`, see `docs/features/public-site.md`), not a full product design system. Extend this file if a pattern repeats a third time; don't pre-build for patterns that don't exist yet.

## Principles

- **CSS Modules only.** No Bootstrap, no Tailwind, no MUI. Never write a raw hex code in a component's `.module.css` — reference a token.
- **Near-black is the primary workhorse color** (buttons, nav, most interactive elements), **gold is a small-dose accent only** (badges, active states, the wordmark dot) — never the dominant interactive color. Two reasons: `#C8A000` with white text sits near the edge of WCAG AA contrast for normal text, and a loud accent color used everywhere in a dense CRUD UI (many buttons/badges visible at once) fatigues faster than it would on a single marketing hero. Colors and fonts are inspired by FencerIQ (a related fencing product), rebalanced for sustained daily use rather than a marketing landing page.
- **One button, one alert, one card.** `Button`/`Alert`/`Card` are the only implementations of each — never hand-roll a new `.btnPrimary`-style class or an ad hoc `<p role="alert">` in a page's own module.
- **Two shells, deliberately different.** Admin gets a dark "back office" sidebar; the parent portal gets a light "member area" sidebar with a gold active accent. Never mix `admin.module.css` and the portal-facing `shared.module.css` in one page — see "Shells" below for which to use where.
- **Errors render inline, never as a modal.** A failed query renders `LoadError` in place of the content that failed to load; a failed mutation shows its message in the same dialog/form the user was already looking at. A modal is for a user-initiated action (create/edit/delete), never for reporting a load failure.

## Tokens (`frontend/app/globals.css`)

| Token | Value | Usage |
|---|---|---|
| `--color-ink` | `#1B1A17` | Primary buttons, nav background, headings, body text |
| `--color-gold` | `#C8A000` | Accent only — badges, active states, wordmark dot |
| `--color-bg` | `#FAF9F6` | Page background |
| `--color-white` | `#FFFFFF` | Card/surface backgrounds |
| `--color-border` | `#E2E0DB` | Table/card borders |
| `--color-muted` | `#6B6B63` | Secondary/meta text |
| `--color-success` / `--color-success-bg` | `#1F7A4D` / `#E9F4EE` | Success banners |
| `--color-error` / `--color-error-bg` | `#B3261E` / `#FBEAE9` | Error banners, destructive actions |

Spacing: `--space-1` through `--space-6` (4px–32px). Radius: `--radius-sm` (4px), `--radius-md` (8px). Shadow: `--shadow-card`.

**Shell tokens** (admin sidebar shell + parent portal shell — added for the CKQ UI adoption plan, `docs/plans/ckq-ui-adoption-plan.md`). Adapted from CKQ's own shell tokens per the plan's §1 brand-adaptation table: same geometry/structure, Frisco's ink/gold colors instead of CKQ's navy/sky.

| Token | Value | Usage |
|---|---|---|
| `--sidebar-w` | `220px` | Desktop sidebar width (admin + portal) |
| `--sidebar-icon-w` | `64px` | Tablet icon-only sidebar width |
| `--topbar-h` | `52px` | Mobile top bar height (admin shell) |
| `--bottomnav-h` | `60px` | Mobile bottom tab bar height (portal shell) |
| `--sidebar-bg` | `#1B1A17` (`--color-ink`) | Admin sidebar background (dark) |
| `--sidebar-text` | `rgba(250,249,246,.72)` | Sidebar nav link text |
| `--sidebar-muted` | `rgba(250,249,246,.45)` | Sidebar section labels / secondary text |
| `--sidebar-border` | `rgba(255,255,255,.08)` | Sidebar dividers |
| `--sidebar-active` | `#C8A000` (`--color-gold`) | Active nav item accent (text + left border) |
| `--sidebar-active-bg` | `rgba(200,160,0,.12)` | Active nav item background wash |

The parent portal sidebar itself renders on a **light** surface (`--color-white` background, `--color-border` divider) — only the admin sidebar uses the dark `--sidebar-bg` treatment.

## Typography

**Saira Condensed** (700/900, `--font-heading`) for headings, buttons, nav — bold and condensed, matches the athletic brand tone. **Saira** (400/500/600, `--font-body`) for everything else. Both loaded via `next/font/google` in `app/layout.tsx`.

## Shells

Three shells coexist, each serving a distinct role set. Never mix a page from one shell's design language with another shell.

### `AppShell` (`frontend/app/components/layout/AppShell.tsx`) — coach + logged-out only

One top nav bar + centered content wrapper (`min(1100px, 100%)`). As of the CKQ UI adoption plan (Phase 1/3), AppShell serves **coach and logged-out visitors only** — admin/superadmin and parent moved to their own dedicated shells below (their `NAV_LINKS_BY_ROLE` entries are now empty arrays, the component itself was kept rather than deleted since coach still needs it). A `Welcome, {firstName}` + logout button renders on the right for the roles that use it. The logged-out branch renders the **public nav** instead (`PUBLIC_NAV_LINKS`): Classes, Coaches, Private Lessons, then Log In + Book a Free Trial (primary) — see `docs/features/public-site.md`.

### Admin shell (`frontend/app/admin/layout.tsx` + `layout.module.css`) — dark, "back office"

Role-gated in the layout itself (admin/superadmin only — a non-admin visitor is redirected to `/` and sees no flash of admin chrome). Structure:

- **Sidebar** (`--sidebar-w` 220px desktop): brand block (wordmark + gold dot, role label) → nav list → sidebar footer (`Welcome, {firstName}` + logout). Dashboard renders standalone above the collapsible sections; sections are **Programs** (Classes, Levels, Prices), **Schedule** (Schedules), **Places** (Locations) — hardcoded in `NAV_SECTIONS` inside `layout.tsx`, not data-driven (5 items across 3 sections doesn't earn a config layer). A section auto-opens when it contains the active route (`useEffect` on `pathname`) and collapses the others.
- **Active state**: exact match for `/admin/dashboard`, prefix match (`pathname.startsWith(href)`) for everything else — so `/admin/schedules/abc/sessions` still highlights "Schedules". Active links carry `aria-current="page"`.
- **Breakpoints**: ≥1024px full sidebar with labels; 768–1023px icon-only sidebar (`--sidebar-icon-w` 64px, labels/section-labels hidden via CSS, not React); ≤767px sidebar becomes a fixed off-canvas drawer (`left: -100%` → `left: 0`) behind a semi-transparent overlay, opened by a sticky top bar (`--topbar-h` 52px) hamburger button.
- Admin pages no longer wrap themselves in `<ProtectedRoute>`/`<AppShell>` — the layout provides both the role gate and the chrome.

### Portal shell (`frontend/app/components/portal/PortalLayout/` + `ParentPortalShell/`) — light, "member area"

Deliberately the visual opposite of the admin shell's dark treatment — a light sidebar with a gold active-left-border reads as "member area", a dark one as "back office." Two layers:

- **`PortalLayout`** is the generic, role-agnostic primitive: `{ navGroups: {label?, items?, content?}[], header?, bottomNavItems, children }`. `navGroups` items render as standard sidebar links; a group's `content` (e.g. per-child rows) renders instead of `items` when present. Active state = **longest-href-prefix match of the current pathname**, computed independently for the sidebar's item set and the `bottomNavItems` set (they're often different lists, e.g. bottom nav has no per-child rows).
- **`ParentPortalShell`** wraps `PortalLayout` with the parent's specific groups/header/bottom-nav (see `docs/features/parent-portal.md` for the exact nav structure) and reads from `ParentPortalContext`.

Breakpoints mirror the admin shell's geometry but with the light surface: ≥1025px full 220px sidebar; 769–1024px icon-only 64px; ≤768px sidebar hidden entirely, replaced by a fixed bottom tab bar (`--bottomnav-h` 60px).

Per-child avatars use a **deterministic index-based palette** (`lib/childPalette.ts`, 4 gold/ink-harmonious gradient pairs) — the same child always gets the same color across sessions, never a random/hash-based assignment that could flicker between renders.

## Page patterns

### Admin CRUD — Pattern A (`docs/features/admin.md` for full per-page detail)

One dialog handles both create and edit (`dialog.id === null` means create); a separate small confirm dialog handles delete and flips to a "Cannot Delete" state (single Close button, backend's message shown verbatim) when the backend returns a 409 in-use guard. Delete removes the row from local state optimistically on success — no full-list refetch. `AdminPageHeader` (`{title, count?, subtitle?}`) and `AdminTableRows` (`AdminLoadingRow`, `AdminEmptyRow`) are the shared primitives every admin page composes.

### Portal dashboard

Three states, always in this order of precedence: loading → empty (onboarding stepper, when this is the very first meaningful list) → populated (a card grid). Never skip the empty state to show a populated-but-zero-items table — an onboarding stepper with a clear next action converts better than a table with a header row and nothing under it.

### Public marketing pages (`docs/features/public-site.md` for full detail) — the one deliberate exception to "LoadError always"

`/` composes `Hero`, `SpotlightCard`, `StepsRow`, `LevelGrid`, `CtaBand` (`app/components/marketing/`) from `/*/public` (no-auth) backend endpoints. **On the home page only**, a failed section fetch renders nothing — never `LoadError` — because a marketing page must not show a stranger an error card; a section with no data (or a failed fetch) simply doesn't render, the same rule as "no data." `/classes` and `/coaches` are utility pages, not marketing, and use `LoadError` normally. Every rendered value on these pages traces to a `/*/public` response field — no client-side price/availability/seat-count math, ever (mirrors the billing-SOT rule below, extended to the public catalog).

### Flow wizard (`docs/features/parent-portal.md`'s "Flow kit" section for full component contracts)

The pattern for any multi-step form (currently: Book a Trial, Register). `FlowMain` provides the shell — breadcrumb, title, optional numbered stepper, and a two-column layout (step content + a **sticky summary rail that owns the single advance/submit CTA for that step** — never render a second submit button inside the step content itself). The final step collapses to `singleColumn` and swaps the step content for `FlowConfirmation`. Step state is local (`useState`, never URL/query-driven except for an optional `?child=` deep-link preselect), so back-navigation is free — nothing needs to be persisted or refetched across steps.

## Components inventory

| Component | Location | Use |
|---|---|---|
| `Button` | `app/components/ui/Button/` | **The only button.** Polymorphic (`as="button"` or `as="a"` + `href`) discriminated union — using `href` on button-mode or omitting it on anchor-mode is a compile-time type error, not a runtime bug. Variants: `primary`/`secondary`/`ghost`/`danger`. Sizes: `sm`/`md`/`lg`. Supports `loading`, `disabled`, `fullWidth`. |
| `Alert` | `app/components/ui/Alert/` | `variant="success"` (`role="status"`) or `variant="error"` (`role="alert"`) — the `role` distinction matters for assistive tech (errors interrupt, status updates don't). |
| `Card` | `app/components/ui/Card/` | Simple bordered/shadowed surface wrapper. |
| `LoadError` | `app/components/ui/LoadError/` | `{ message?, onRetry?, compact? }` — the ONLY way a failed query renders; pairs with `useLoadState`. Never a modal. One documented exception: the home page (`/`) — see "Public marketing pages" above. |
| `useLoadState` / `getErrorMessage` | `lib/hooks/useLoadState.ts` | Generic async query hook (`{ data, error, isLoading, retry }`) + a status-code-aware error-message extractor (backend message for a user-facing 4xx, generic text otherwise). |
| `AdminPageHeader` / `AdminTableRows` | `app/components/admin/` | Admin-only page-header and loading/empty table-row primitives. |
| `PortalLayout` / `ParentPortalShell` | `app/components/portal/` | Portal shell primitives — see "Shells" above. |
| `AddChildModal` | `app/components/portal/AddChildModal/` | `{ onClose, onSuccess }` — the one place a household adds a child; used from 3 call sites (children page, sidebar, dashboard empty state). |
| Flow kit (`FlowMain`, `FlowStepper`, `FlowSection`, `ChildPickerCards`, `OrderSummary`, `FlowConfirmation`) | `app/components/portal/flow/` | See "Flow wizard" pattern above. |
| Marketing kit (`Hero`, `SpotlightCard`, `StepsRow`, `LevelGrid`, `ScheduleTable`, `CtaBand`) | `app/components/marketing/` | Public-site presentational components — see "Public marketing pages" above and `docs/features/public-site.md`. |
| `lib/services/{catalog,scheduling,parent,spotlights}.ts` | `lib/services/` | Query-throws / mutation-never-throws contract — see `docs/TESTING_STRATEGY.md`'s error-handling contract for how to test each side. Each file's `── Public (no auth) ──` block groups the unauthenticated `/*/public` fetchers separately from the authenticated ones. |
| `lib/types.ts` | `lib/` | Domain interfaces typed against real backend responses — the single source of truth for a `Location`/`Student`/`Subscription`/etc. shape on the frontend. |

## Anti-patterns

Things that have shown up before (in CKQ, or would be an easy mistake to reintroduce here) — don't do these:

1. **Raw hex in a component's `.module.css`.** Always reference a token (`var(--color-ink)`, not `#1B1A17`) — a rebrand or a dark-mode pass later has one place to change, not a grep-and-pray.
2. **Hand-rolled `.btnPrimary`-style class in a page's own module.** Import `Button`. If `Button` genuinely can't express what's needed, that's a signal to extend `Button`, not to bypass it once.
3. **`jest.mock` at the service boundary to stub an HTTP call.** Mock at the network boundary (MSW) instead — see `docs/TESTING_STRATEGY.md`'s Mocking rules for the full reasoning and the narrow named exceptions (Next.js router, Stripe `CardElement`).
4. **Inline styles for anything reusable across more than one place.** A one-off `style={{ marginTop: 'var(--space-4)' }}` on a single page is fine; a layout pattern used on 3+ pages belongs in a `.module.css` class.
5. **Per-page duplicate domain interfaces.** Don't redeclare `interface Location { _id, name, address, timezone }` inside a page file — import it from `lib/types.ts`. A duplicate definition is exactly how a page silently drifts from what the backend actually returns.
6. **A modal (or a full-page takeover) for a load failure.** A failed query renders `LoadError` in place of the content — see Principles above.
7. **A duplicate CSS Modules class name defined twice in the same file** (the exact bug CKQ shipped in its own `admin.module.css` — two separate `.pageHeader` rules, the second silently overriding the first for any file importing both meanings). `admin.module.css` here defines `.pageHeader` exactly once, as the title+subtitle block only — the title-row-plus-action-button layout is `.pageHeaderRow`, a distinct name.

## Pre-merge checklist

Before opening a PR that touches any page/component covered by this doc:

- [ ] No raw hex codes introduced in any `.module.css` — grep the diff for `#[0-9a-fA-F]{3,6}` outside of a token definition in `globals.css`.
- [ ] No new `.btnPrimary`/`.btnSecondary`-shaped class — uses `Button`.
- [ ] Admin page uses `admin.module.css` + `AdminPageHeader`/`AdminTableRows`; portal page uses `shared.module.css`/portal component styles. Not both in one page.
- [ ] Any new domain shape used across more than one file is added to `lib/types.ts`, not redeclared locally.
- [ ] A failed query renders `LoadError` (with `onRetry` wired to the hook's `retry()`), never a modal or a blank page.
- [ ] A failed mutation shows `result.message` inline (dialog/form `Alert`), and the mutation function itself never throws — verified by a test asserting the UI "shows an inline error ... without crashing," per `docs/TESTING_STRATEGY.md`.
- [ ] `tsc --noEmit` is 0 errors and `next build` succeeds before merging (both are hard CI gates, not advisory).

## Explicitly not adopted from CKQ (scope, not oversight)

Bootstrap, Playfair-style display serif, the discovery/calendar page patterns, the four-surface notification hierarchy, **animated stat bars/counters**, testimonial walls, stylelint CI enforcement of these rules, CKQ's membership/premium-upsell machinery, view-as impersonation, and agent chat. The animated-stats and testimonial-wall exclusions are a deliberate call on the now-shipped public site (`docs/features/public-site.md`), not an MVP-scope placeholder — every public page's copy/numbers must trace to a real backend field, which rules out an unverifiable counter or a vague-praise carousel by construction, not just by taste. The rest exist to serve a portal-scale feature set this app doesn't have; revisit only if that changes.
