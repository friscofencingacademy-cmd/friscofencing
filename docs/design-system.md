# Frisco Fencing Academy — Design System

Short by design — this is a data-dense admin/CRM app with no public marketing site in MVP scope, not a full product design system. Extend this file if a pattern repeats a third time; don't pre-build for patterns that don't exist yet.

## Brand direction

Colors and fonts are inspired by FencerIQ (a related fencing product), rebalanced for sustained daily use rather than a marketing landing page: **near-black is the primary workhorse color** (buttons, nav, most interactive elements), **gold is a small-dose accent only** (badges, active states, the wordmark dot) — never the dominant interactive color. Two reasons: `#C8A000` with white text sits near the edge of WCAG AA contrast for normal text, and a loud accent color used everywhere in a dense CRUD UI (many buttons/badges visible at once) fatigues faster than it would on a single marketing hero.

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

Never write a raw hex code in a component's `.module.css` — reference a token.

## Typography

**Saira Condensed** (700/900, `--font-heading`) for headings, buttons, nav — bold and condensed, matches the athletic brand tone. **Saira** (400/500/600, `--font-body`) for everything else. Both loaded via `next/font/google` in `app/layout.tsx`.

## CSS approach

**CSS Modules only — no Bootstrap, no Tailwind.** One shared `app/components/ui/shared.module.css` holds common classnames (`.pageHeader`, `.pageTitle`, `.pageSubtitle`, `.table`, `.emptyState`, `.formField`, `.formLabel`, `.formInput`, `.formSelect`) used directly across pages — the same "shared module of classnames" pattern CKQ uses for `admin.module.css`, chosen over a heavier generic `<Table>`/`<FormField>` component since table/form shapes vary enough per page that a data-driven abstraction wasn't worth the complexity for an MVP this size.

## Shared components (`frontend/app/components/ui/`)

| Component | Use |
|---|---|
| `Button` | **The only button.** Polymorphic (`as="button"` or `as="a"` + `href`) discriminated union — using `href` on button-mode or omitting it on anchor-mode is a compile-time type error, not a runtime bug. Variants: `primary` (ink bg/white text), `secondary` (white bg/ink border+text), `ghost` (transparent/muted border), `danger` (white bg/error border+text). Sizes: `sm`/`md`/`lg`. Supports `loading`, `disabled`, `fullWidth`. Never write a new `.btnPrimary`-style class in a page's own CSS module — import `Button`. |
| `Alert` | `variant="success"` (`role="status"`) or `variant="error"` (`role="alert"`) — the `role` distinction matters for assistive tech (errors interrupt, status updates don't). Replaces ad hoc `<p role="alert">` scattered across pages. |
| `Card` | Simple bordered/shadowed surface wrapper. |

## Layout (`frontend/app/components/layout/AppShell.tsx`)

One top nav bar + centered content wrapper (`min(1100px, 100%)`). As of the CKQ UI adoption plan (Phase 1), AppShell serves **coach + logged-out visitors only** — admin/superadmin now get the dedicated dark sidebar shell below (their `NAV_LINKS_BY_ROLE` entries are empty arrays), and parent gets the portal shell (Phase 3). A `Welcome, {firstName}` + logout button still renders on the right for the roles that use it.

## Admin shell (`frontend/app/admin/layout.tsx` + `layout.module.css`)

Dark sidebar shell for `admin`/`superadmin` only (role-gated in the layout itself — a non-admin visitor is redirected to `/` and sees no flash of admin chrome). Structure:

- **Sidebar** (`--sidebar-w` 220px desktop): brand block (wordmark + gold dot, role label) → nav list → sidebar footer (`Welcome, {firstName}` + logout). Dashboard renders standalone above the collapsible sections; sections are **Programs** (Classes, Levels, Prices), **Schedule** (Schedules), **Places** (Locations) — hardcoded in `NAV_SECTIONS` inside `layout.tsx`, not data-driven (5 items across 3 sections doesn't earn a config layer). A section auto-opens when it contains the active route (`useEffect` on `pathname`) and collapses the others.
- **Active state**: exact match for `/admin/dashboard`, prefix match (`pathname.startsWith(href)`) for everything else — so `/admin/schedules/abc/sessions` still highlights "Schedules". Active links carry `aria-current="page"`.
- **Breakpoints**: ≥1024px full sidebar with labels; 768–1023px icon-only sidebar (`--sidebar-icon-w` 64px, labels/section-labels hidden via CSS, not React); ≤767px sidebar becomes a fixed off-canvas drawer (`left: -100%` → `left: 0`) behind a semi-transparent overlay, opened by a sticky top bar (`--topbar-h` 52px) hamburger button.
- **`admin.module.css`** is the admin design system — buttons, table, dialog/modal, form, chips, stat cards, quick-link cards (Phase 1/2). Use it for every admin page. Use the portal-facing `shared.module.css` only for non-admin authenticated pages (parent/coach) — never mix the two in one page. `AdminPageHeader` (`{title, count?, subtitle?}`) and `AdminTableRows` (`AdminLoadingRow`, `AdminEmptyRow`) are the shared primitives every admin page composes.
- Admin pages no longer wrap themselves in `<ProtectedRoute>`/`<AppShell>` — the layout provides both the role gate and the chrome.

## Shell tokens (`frontend/app/globals.css`, added for the CKQ UI adoption plan)

Added alongside the original palette above — used by the admin sidebar shell (Phase 1) and the parent portal shell (Phase 3). Adapted from CKQ's own shell tokens per `docs/plans/ckq-ui-adoption-plan.md` §1's brand-adaptation table: same geometry/structure, Frisco's ink/gold colors instead of CKQ's navy/sky.

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

The parent portal sidebar itself renders on a **light** surface (`--color-white` background, `--color-border` divider) — only the admin sidebar uses the dark `--sidebar-bg` treatment. See "Shells" below (added as each phase ships).

## Explicitly not adopted from CKQ (scope, not oversight)

Bootstrap, Playfair-style display serif, the discovery/calendar page patterns, the four-surface notification hierarchy, animated stat bars, stylelint CI enforcement of these rules. All exist to serve a public marketing site and portal-scale feature set this MVP doesn't have. Revisit if/when this project grows a public site.
