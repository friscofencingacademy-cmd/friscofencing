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

One top nav bar + centered content wrapper (`min(1100px, 100%)`), used by every authenticated page. Role-aware nav links (admin/superadmin, coach, parent each see a different link set — see `AppShell.tsx`'s `NAV_LINKS_BY_ROLE`), a `Welcome, {firstName}` + logout button on the right. No public marketing site means no need for CKQ's multi-tier container/Section system — one content-width constant is enough.

## Explicitly not adopted from CKQ (scope, not oversight)

Bootstrap, Playfair-style display serif, the discovery/calendar page patterns, the four-surface notification hierarchy, animated stat bars, stylelint CI enforcement of these rules. All exist to serve a public marketing site and portal-scale feature set this MVP doesn't have. Revisit if/when this project grows a public site.
