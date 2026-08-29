# WordPress UI Alignment + Family Scorecard Checkout — Execution Plan

**Status: Phase 1 + Phase 2 BUILT 2026-08-29 (PRs #58 stacked with the Phase 2 PR), Phase 3
not started.** Written 2026-08-29 from a full analysis of the owner's WordPress export
(`friscofencing.WordPress.2026-08-29.xml`, verified against the live site the same day) and
the screenshot mock `C:\Users\mages\ckqtestimages\familypaymentcard.jpg`.

## Phase 1 + 2 completion notes (2026-08-29)

Built and verified exactly as spec'd below, with four real findings caught and corrected
during implementation (not assumed from the plan text) — each documented in place with a
dated comment at its actual fix site, summarized here:

1. **The hero photo was wrong.** The plan's designated hero image
   (`GettyImages-1716935160-1-scaled.jpg`, the WP site's own hero background) turned out, on
   visual inspection via a Playwright screenshot, to be a stock photo of children playing
   **soccer** — leftover "Eagle Elite" multi-sport theme content the WP site itself never
   replaced with real fencing photography, the same class of bug as finding #2 below.
   `Hero.tsx` ships a solid navy gradient band instead of a photo (`.heroBand`) until the
   owner supplies a real one; the file is downloaded and lives on disk, but is not
   referenced by any component. The other three downloaded photos (`who-we-are.png`, the
   three `program-*` images) were visually verified as genuinely fencing-related and are
   used as designed.
2. **The plan's own quoted hero subcopy was fabricated, and the real WP text is also
   boilerplate.** §3.3 item 1 quoted "...a center of excellence for fencing in Frisco" as
   verbatim WP copy; re-extracting the WordPress export's full, untruncated text field found
   the actual source string is "...a center to bring people together through sports" —
   generic multi-sport template copy, never customized, and never what the plan claimed
   either. `Hero.tsx` keeps the pre-existing, accurate, fencing-specific subcopy instead of
   shipping either version. All other quoted WP copy in Phase 2 (chip/headline/Who-we-are
   body/Programs/Facility/Team text) was re-verified against the export's full,
   non-truncated text fields before use — this was the only fabricated one found.
3. **The full-bleed CSS technique needed two follow-up fixes, both caught by an actual
   screenshot, not by code review alone:** (a) `overflow-x: hidden` was first added to
   `AppShell`'s `.content` as the standard companion to the `100vw`-based `.fullBleed`
   trick — but `.content` is the fullBleed sections' direct parent, so it clipped the very
   content the technique was meant to let escape. Moved to `body` in `globals.css` instead.
   (b) Every class combined with `.fullBleed` had to use `margin-top`/`margin-bottom`
   longhands instead of the `margin: X 0` shorthand, since the shorthand's expanded
   `margin-left`/`margin-right: 0` would fight `.fullBleed`'s own `-50vw` margins with no
   reliable winner across two same-specificity rules in different source positions.
4. **A second, previously-hidden a11y violation, found while fixing the first.** Phase 1's
   `.levelFee` gold-contrast fix unmasked a second `color-contrast` finding on Hero's
   temporary photo placeholder — the *original* ratchet (pre-dating this plan) allowlisted
   the whole `color-contrast` rule id rather than the specific violating node, silently
   permitting this second one too. Fixed the underlying CSS (`.photoPlaceholder`'s
   background) and, since Phase 2's real `Hero` no longer renders that element at all,
   removed the ratchet entirely — `public-site.spec.ts`'s home-page a11y check is back to
   zero-tolerance. Full detail in `docs/TESTING_STRATEGY.md`'s "Known, accepted
   accessibility findings."

Verification for both phases: `tsc --noEmit` clean, frontend Jest 277/277, `next build`
succeeds, Playwright e2e 19/19 (2 pre-existing unrelated skips). Backend Jest's 28
failures (registration.routes/scheduleOccurrence/billingDates/realignBillingAnchors)
reproduced identically on the unmodified base commit via `git stash` before Phase 1 — confirmed
pre-existing and unrelated, not introduced by this plan; Phase 2 touched no backend files.
Also visually verified with an ad hoc Playwright screenshot against realistic fixture data
(not committed) — this is how findings #1 and #3 were actually caught, not just reasoned
about.

**Goal:** make the platform's frontend look like the existing `friscofencingacademy.com`
(an Elementor site on the VamTam "Eagle Elite" theme) so visitors experience visual
continuity when the platform replaces WordPress — **without losing any built functionality**
(trial-class flow, register wizard, parent portal, admin panel all keep their exact behavior),
and **without moving one gram of billing/pricing logic into the frontend**.

This plan is written to be executed autonomously (e.g. by Sonnet in auto mode). Each phase is
one PR. Follow the repo's hard rules in `CLAUDE.md` — in particular:

- Feature branch per phase, PR to `develop`. Stage files explicitly (never `git add .`).
- Read every file before editing it.
- Tests before commit; `tsc --noEmit` 0 errors + `next build` success + full backend/frontend
  suites green are hard gates per phase.
- Pre-read the docs listed in CLAUDE.md's "Pre-read requirements" for every area touched
  (`docs/design-system.md`, `docs/features/public-site.md`, `docs/features/parent-portal.md`,
  `docs/TESTING_STRATEGY.md`, and for Phase 3's backend addition
  `docs/decisions/001-in-house-subscription-billing.md`).

---

## 0. Non-negotiable guardrails (apply to every phase)

1. **Backend is the source of truth and the brain; the frontend only shows.** No price math,
   no discount math, no seat/availability math, no date-derived eligibility in any component.
   Every rendered number traces to a named backend response field. Phase 3 deliberately adds
   one small backend field (`savings`) rather than letting the frontend add two numbers together.
2. **Keep every existing flow.** The trial-class flow (`/parent/book-trial`), register wizard
   (`/parent/register`), private-lessons wizard (`/parent/register-private`), portal shell,
   admin shell, and all their step logic/tests survive unchanged in behavior. These phases are
   restyle + recompose only. If a change would alter flow behavior, stop — it's out of scope.
3. **One button, one summary.** Extend `Button` and `OrderSummary`; never fork a second
   implementation.
4. **No raw hex in any `.module.css`** — every new color goes through a `globals.css` token.
5. **Copy rule:** all marketing copy in Phase 2 is taken **verbatim from the live WordPress
   site** (owner-authored, listed in §1.4 below) or already exists in our components. Do not
   invent new claims, numbers, or testimonials.
6. **E2E mandate** (`docs/TESTING_STRATEGY.md`): any changed user-visible label/heading that an
   `frontend/e2e/*.spec.ts` asserts must be updated in the same PR. Known assertion:
   `public-site.spec.ts` checks the hero heading `'Where Frisco learns to fence.'` (3×) and
   headings `'Class Schedule'` / `'Coaching Staff'`.

---

## 1. Ground truth: the current WordPress design

Extracted from the export's active Elementor kit (post 5, "default-kit-2") + inline page
settings on the live home page (post 988920) and camps page (post 989657). Live site verified
to match on 2026-08-29.

### 1.1 Colors

| Role on the WP site | Hex |
|---|---|
| Primary dark (buttons, team band, headings) | `#0E1B2A` navy |
| Accent / CTA / "Join Our Community" band | `#B51726` crimson |
| Section background (alternating) | `#F9F7F4` warm off-white |
| Eyebrow chip behind section labels ("Programs", "Our Team") | `#F0E3E6` pale pink |
| Schedule-table header rows (camps page) | `#00142F` deep navy |
| Surfaces / cards | `#FFFFFF` |

### 1.2 Typography

- **Body:** Inter, 16px, line-height 1.5.
- **Headings:** Big Shoulders Text, weight 600 (H4/H6 use 500), **UPPERCASE**.
  H1 48px (35 tablet / 28 mobile), H2 32px, H3 22px, H4 20px, H6 14px. H5 is Inter 18px.
- **Buttons:** Big Shoulders Text, uppercase, **border-radius 0** (fully square).
- Content container: 1440px max.

### 1.3 Live page structure (the UX to preserve visually)

One-page home (anchor nav: HOME · PROGRAMS · ABOUT THE TEAM · BLOG · CAMPS · CONTACT US):

1. Hero — full-bleed photo, crimson chip "Welcome to Frisco Fencing Academy", big uppercase
   headline ("Olympic Fencing." + animated line), subcopy.
2. Dual CTAs — "TAKE A TRIAL CLASS" (navy) + "ENROLL IN A PROGRAM" (crimson); elsewhere
   "Book Private Class with Coach".
3. "Who we are" — chip + "A Thoughtful Approach to an Olympic Sport" + subcopy + Learn More.
4. Scrolling values marquee — Discipline. Purpose. Guidance. Focus. Confidence. Growth.
5. Programs — chip "Programs", "A clear path for every stage", 3 photo cards
   (Beginner / Intermediate / Advanced), each with copy + "Take Trial Class".
6. Facility — "The new facility - FFA 2.0" + stats row: **10 STRIPS · 5+ dedicated trainers ·
   7 DAYS open all day**.
7. Team — **navy `#0E1B2A` band**, chip "Our Team", "Guided by experience", 3 photo cards
   (Chris Slaughter — Head Coach/Director of Fencer Development; Abel Rodriguez — Coach, Foil
   and Epee; Lauren — Coach).
8. Second marquee — Accountability. Integrity. Teamwork. Respect. Spirit. Self belief.
9. Testimonials + Upcoming Camps sections.
10. Crimson CTA band — "Join Our Community".

Registration on the WP site exits to **ppnsports.com** — the thing this platform replaces. So
"the registration UX changes" is a given; visual continuity is what we're preserving.

### 1.4 Assets to mirror (Phase 0) — all live on the WP host today

| Purpose | URL |
|---|---|
| Logo (SVG) | `https://friscofencingacademy.com/wp-content/uploads/2024/10/FCA_Logo-1.svg` |
| ~~Hero photo~~ | ~~`https://friscofencingacademy.com/wp-content/uploads/2024/12/GettyImages-1716935160-1-scaled.jpg`~~ — **downloaded, verified during Phase 2 build to be a stock photo of children playing soccer (leftover multi-sport theme content), not used.** See the Phase 1+2 completion notes above. `Hero` ships a solid navy gradient instead. |
| Program — Beginner | `https://friscofencingacademy.com/wp-content/uploads/2026/02/beginner_2-scaled.jpg` |
| Program — Intermediate | `https://friscofencingacademy.com/wp-content/uploads/2026/02/intermediate_2-scaled.jpg` |
| Program — Advanced | `https://friscofencingacademy.com/wp-content/uploads/2026/02/Frame-1597882064-2-1.png` |
| Coach — Chris | `https://friscofencingacademy.com/wp-content/uploads/2026/02/chris1.png` |
| Coach — Abel | `https://friscofencingacademy.com/wp-content/uploads/2026/02/abel1.png` |
| Coach — Lauren | `https://friscofencingacademy.com/wp-content/uploads/2026/02/lauren1.png` |
| "Who we are" side photo | `https://friscofencingacademy.com/wp-content/uploads/2026/01/lady_with_fencing-1.png` |
| Socials | Instagram `https://www.instagram.com/official_friscofencing/` · YouTube `https://www.youtube.com/@BrainsBehindBlades` |

---

## 2. Phase 1 — Brand token + typography swap (branch `feature/wp-brand-tokens`)

**The single highest-payoff change.** Because the design system bans raw hex outside
`globals.css`, retheming the entire app (public + portal + admin) is almost entirely a
token-value change.

### 2.1 `frontend/app/globals.css`

Replace the token values (names mostly stay; one rename):

```css
--color-ink: #0e1b2a;        /* navy replaces near-black — buttons, nav, headings, body text */
--color-accent: #b51726;     /* RENAMED from --color-gold; crimson replaces gold */
--color-bg: #f9f7f4;         /* was #faf9f6 — matches WP section background */
--color-chip: #f0e3e6;       /* NEW — eyebrow chip background (WP section labels) */
--color-navy-deep: #00142f;  /* NEW — table header rows / scorecard panel (Phase 3) */
/* --color-white, --color-border, --color-muted, success/error tokens: unchanged */

--radius-sm: 0;              /* WP aesthetic is fully square */
--radius-md: 0;

--sidebar-bg: #0e1b2a;                            /* admin sidebar goes navy */
--sidebar-active: #f2abb2;                        /* light crimson tint — see D2 */
--sidebar-active-bg: rgba(181, 23, 38, 0.18);
```

- **Rename, don't repurpose:** grep-replace every `var(--color-gold)` → `var(--color-accent)`
  across `frontend/**/*.module.css` and any TS usage. Leaving a token named "gold" holding
  crimson is a maintenance trap. Verify with a final grep that `--color-gold` has zero
  remaining references.
- Heading rules in `globals.css`: add `text-transform: uppercase;` to the `h1..h6` block and
  change weights to match WP (h1: 600 — replacing the current 900; h2/h3: 600). Keep the
  existing sizes/margins otherwise; component modules already size their own headings.
- `--shadow-card`'s rgba base color update from `27,26,23` to `14,27,42` (cosmetic, keep 0.08 alpha).

### 2.2 Fonts — `frontend/app/layout.tsx`

Swap `Saira_Condensed`/`Saira` for:

```ts
import { Big_Shoulders_Text, Inter } from 'next/font/google';
const bigShoulders = Big_Shoulders_Text({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-heading', display: 'swap' });
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body', display: 'swap' });
```

Same `--font-heading` / `--font-body` variable names — nothing else changes.

### 2.3 `Button` (`frontend/app/components/ui/Button/`)

- Font: `var(--font-heading)`, `text-transform: uppercase`, slight letter-spacing (`0.5px`),
  `border-radius: 0` (inherits from the radius tokens; make sure no local radius overrides).
- **Add an `accent` variant** — solid `--color-accent` crimson with white text — for the WP-style
  crimson CTAs ("Enroll in a Program"). `primary` stays the dark workhorse (now navy).
- **Restyle `danger` as an outline** (white/transparent background, `--color-error` border +
  text, filled on hover). Rationale: solid crimson is now the *brand CTA* color; a solid red
  destructive button would be visually indistinguishable from a marketing CTA (D3).
- Update `Button`'s unit tests for the new variant; keep the discriminated-union API untouched.

### 2.4 `frontend/lib/childPalette.ts`

The 4 gradient pairs are gold/ink-harmonious; recolor to navy/crimson-harmonious. Use exactly:
`['#16324f', '#0e1b2a']`, `['#b51726', '#7c0f1b']`, `['#55606c', '#2a2d32']`,
`['#c96a74', '#9e3d48']`. Deterministic index assignment logic unchanged. Update its test if
it asserts hex values.

### 2.5 Contrast audit (do, don't skip)

- White on `#B51726` ≈ 7.6:1 — passes AA. White on `#0E1B2A` — passes easily.
- `#F2ABB2` (sidebar active text) on `#0E1B2A` ≈ 8:1 — passes. **Never** use raw `#B51726`
  as *text* on the navy sidebar (≈2.5:1 — fails); that's why the tint token exists (D2).
- Chip text: use `--color-accent` text on `--color-chip` background (≈6.5:1 — passes).

### 2.6 Docs + tests + gates

- Update `docs/design-system.md`: token table (gold→accent rename, new tokens, radius),
  Typography section (Big Shoulders Text/Inter), Button variants (accent, outlined danger),
  and rewrite the Principles bullet that justifies gold-in-small-doses — the principle
  ("accent color in small doses in dense admin UI") survives; the hue and the contrast
  rationale change (crimson passes AA where gold was marginal).
- Run: frontend `npm test`, `tsc --noEmit`, `next build`; backend suite untouched but run it
  anyway; `npx playwright test` (no label changes expected in this phase — fix any
  color-independent breakage only).
- **PR 1 → `develop`.** Visual-only diff; behavior identical.

---

## 3. Phase 2 — Public site restructure to mirror the WP home (branch `feature/wp-public-home`)

Pre-read `docs/features/public-site.md` first (hard rule). Everything stays inside the
established pattern: data from existing `/*/public` endpoints, home page renders nothing on
fetch failure (never `LoadError`), no invented numbers.

### 3.1 Phase 0 assets (first commit of this branch)

Download the §1.4 images into `frontend/public/marketing/` with stable names
(`logo.svg`, `hero.jpg`, `program-beginner.jpg`, `program-intermediate.jpg`,
`program-advanced.png`, `coach-chris.png`, `coach-abel.png`, `coach-lauren.png`,
`who-we-are.png`). They are the owner's own assets on the owner's own host. If any URL 404s,
skip it and leave the component's no-image fallback (see 3.3) — do not substitute stock art.
Compress anything over ~400KB (the `-scaled` variants are large) — `next/image` with
`sizes` hints, or pre-resize to ≤1920w.

### 3.2 `AppShell` public nav (`frontend/app/components/layout/AppShell.tsx`)

- Wordmark → the real `logo.svg` (keep the text wordmark as the `alt`/fallback).
- `PUBLIC_NAV_LINKS`: `Home` (`/`), `Programs` (`/classes`), `Our Team` (`/coaches`),
  `Private Lessons` (existing), then `Log In` + primary CTA **"Take a Trial Class"**
  (`/register` — same destination as today's "Book a Free Trial"; label aligned to the WP
  site's wording, flow unchanged).
- WP labels *not* adopted: BLOG and CAMPS (no backend behind them — linking to nothing or to
  the old WP pages from the new site would be a dead end; camps are explicitly deferred in
  CLAUDE.md scope). CONTACT US on WP is an external ppnsports link — replaced by the footer's
  real contact/address info (3.4).

### 3.3 Home page (`frontend/app/page.tsx` + `app/components/marketing/`)

Recompose in the WP section order. All new components live in `app/components/marketing/`
with styles in `marketing.module.css` (tokens only). Redirect/auth logic in `page.tsx` is
untouched.

1. **`Hero`** — restyle: full-width photo background (`hero.jpg`) with a navy overlay
   (`rgba(14,27,42,0.65)` — token-derived), crimson chip **"Welcome to Frisco Fencing
   Academy"**, uppercase headline. Copy (verbatim WP, owner-authored): headline
   **"Olympic Fencing."** with the existing subcopy replaced by WP's: *"More than a place to
   practice and play. We are proud to serve as a center of excellence for fencing in
   Frisco."* CTAs: **"Take a Trial Class"** (`primary`, → `/register`) + **"Enroll in a
   Program"** (`accent`, → `/register`). No animated-headline widget — a static second line
   is fine (animation is excluded scope, `docs/design-system.md`).
2. **`ValuesMarquee`** *(new)* — pure-CSS infinite horizontal scroll of the WP value words
   (§1.3 items 4 and 8; two instances with the two word sets). Duplicate the word list in
   DOM for the loop seam; `prefers-reduced-motion: reduce` → static row, no animation.
   Decorative: `aria-hidden="true"`.
3. **"Who we are"** — reuse `SpotlightCard`'s two-column pattern or a small new
   `IntroSection`: chip "Who we are", heading "A Thoughtful Approach to an Olympic Sport",
   WP subcopy ("Fencing develops balance, decision-making, respect, and emotional
   control..."), photo `who-we-are.png`, `Learn More` → `/classes`.
4. **`LevelGrid` → program photo cards** — same data contract (`PublicLevel[]` from
   `GET /levels/public`; name/order/monthlyFee rendered verbatim). Restyle each card with a
   photo header: map photos by `order` index to
   `[program-beginner, program-intermediate, program-advanced]`; a 4th+ level (or missing
   file) gets a plain navy header block — **never** hide a level or invent an image. Card
   CTA: "Take a Trial Class" → `/register`. Keep the fee line exactly as returned.
5. **`FacilityBand`** *(new)* — chip "Our Facility", heading "The new facility - FFA 2.0",
   static stats row `10 STRIP · 5+ Dedicated trainers · 7 DAYS open all day` as **static,
   non-animated text** with a source comment (`// Owner-authored copy, verbatim from the
   live WP site 2026-08-29`). This is the same static-copy status as the hero (D4). No
   counters, no animation (excluded scope).
6. **`TeamBand`** *(new)* — navy `--color-ink` full-width band, chip "Our Team", heading
   "Guided by experience". Content = **coach spotlights from
   `GET /spotlights/public?type=coach`** (already fetched on this page) rendered as photo
   cards (imageUrl/name/title verbatim). Section doesn't render when the list is empty (home
   page rule). "View all coaches →" link to `/coaches` stays.
   *Ops note (owner, not code):* create/publish 3 coach spotlights in `/admin/spotlights`
   (Chris Slaughter, Abel Rodriguez, Lauren — §1.3 titles) using the §1.4 photos via the
   existing upload endpoint, on staging + production, so this band matches WP on day one.
7. **Student spotlight** — keep the existing `SpotlightCard type="student"` section as-is
   (this is our verifiable stand-in for WP's testimonial wall, which stays excluded —
   `docs/design-system.md` "Explicitly not adopted").
8. **`StepsRow`** — keep (it documents the real flow); restyle only (chip + uppercase come
   free from Phase 1). Update its CTA label to "Take a Trial Class".
9. **`CtaBand`** — crimson `--color-accent` band, heading **"Join Our Community"**, CTAs
   "Take a Trial Class" (`primary` navy) + "Enroll in a Program" (inverse/white outline).
10. **`SiteFooter`** *(new component replacing the inline footer in `page.tsx`)* — navy band:
    logo, locations from `GET /locations/public` (name · address, verbatim — already
    fetched), social icon links (Instagram/YouTube URLs from §1.4, plain `<a>`s), nav links
    (Programs `/classes`, Our Team `/coaches`, Private Lessons, Log In), `© 2026 Frisco
    Fencing Academy`. Use it on `/`, `/classes`, `/coaches` (footer on flow/auth pages is out
    of scope).

### 3.4 `/classes` and `/coaches`

No structural change (they're utility pages with `LoadError` handling — keep that). Only:
eyebrow chips + heading styles arrive via Phase 1 tokens; add `SiteFooter`; keep the asserted
headings `'Class Schedule'` / `'Coaching Staff'` **unchanged** so e2e keeps passing.

### 3.5 Tests + gates

- Component tests for `ValuesMarquee` (renders words, aria-hidden), `TeamBand`
  (renders spotlights verbatim / renders nothing when empty), `FacilityBand`, `SiteFooter`
  (locations verbatim / omits row when fetch failed), updated `Hero`/`LevelGrid` tests.
- **E2E (same PR, mandatory):** `public-site.spec.ts` — hero heading assertion
  `'Where Frisco learns to fence.'` → `'Olympic Fencing.'` (all 3 occurrences); re-check for
  any "Book a Free Trial" text assertions → "Take a Trial Class". `parent-register.spec.ts`
  and `login.spec.ts`: grep for asserted labels that changed; update in place.
- Update `docs/features/public-site.md` (new components, nav labels, footer, spotlight ops
  note) in the same PR.
- Gates: frontend suite + `tsc` + `next build` + full Playwright run. Backend untouched.
- **PR 2 → `develop`.**

---

## 4. Phase 3 — "Family Scorecard" checkout quote (branch `feature/family-scorecard-quote`)

Source: `familypaymentcard.jpg` — a plan-builder mock with a dark "LIVE QUOTE / FAMILY
SCORECARD" panel: per-athlete tuition, sibling discount line, registration-fee line with
waiver, "Due at enrollment", family total, "You save $X" badge.

**What we adopt:** the scorecard *presentation* — itemized dark quote panel with discount
lines, waiver callouts, a large "due at enrollment" figure, and a savings line.
**What we do not adopt (D5):** everything in the mock that isn't our billing model —
multi-month plan durations (3/6/12-month prepay), "step up" upsell hints, reg-fee tier logic,
and the client-side price math the mock runs. Our billing is monthly, in-house, and
backend-computed (ADR 001/006/007).

The plumbing already exists: `GET /api/v1/registrations/preview`
(`registration.service.js#previewChargeAmount`) already returns `monthlyFee`, `chargeAmount`,
`totalChargeAmount`, `siblingDiscountApplied/Amount/Reason`,
`registrationFeeCharged/Waived/Reason`, `prorated`, `periodEnd` — and
`/parent/register/page.tsx` already fetches it live. This phase is a presentation upgrade
plus one small backend addition.

### 4.1 Backend: add a server-computed `savings` block (SOT rule)

The mock shows "You save $X". Today the waived registration fee's dollar value is not in the
preview response (`registrationFeeCharged` is `0` when waived), so the frontend *cannot* show
waived-fee savings without doing math or knowing the fee setting — both forbidden.

- `backend/src/services/billing/registrationFee.service.js#resolveRegistrationFee`: also
  return `standardAmount` (the configured fee before waiver; `0` when no fee configured).
  Existing callers ignore the extra field — verify none destructure exhaustively.
- `registration.service.js#previewChargeAmount`: extend the return with

  ```js
  savings: {
    siblingDiscount: siblingDiscountAmount,        // 0 when not applied
    registrationFeeWaived: registrationFeeWaived ? registrationFeeStandardAmount : 0,
    total: /* sum of the two, computed HERE, server-side */
  }
  ```

  Nothing about `create()`/the real charge changes — this is preview/display data only.
- Tests (`registration.routes.test.js` or the service's test file, following existing preview
  tests): waived-fee case exposes the standard amount in `savings`; discount+fee case sums
  correctly; zero case returns all-zero `savings`.

### 4.2 Frontend: `OrderSummary` scorecard treatment

`OrderSummary` is the single summary component (flow-kit rule) — upgrade it in place so the
register, book-trial, and private-lessons wizards all inherit the look; their step logic and
the "single CTA lives in the rail" contract are untouched.

- **API (backward-compatible):** `OrderSummaryLine` gains optional
  `kind?: 'default' | 'discount' | 'total' | 'note'`. Existing call sites compile unchanged
  (`kind` omitted ⇒ `default`).
- **Look (tokens only):** panel background `--color-navy-deep`, white text, small uppercase
  overline "Live Quote" above the heading; `discount` lines render in a light crimson tint
  with the leading minus sign exactly as the caller passes it; `total` renders large
  (Big Shoulders, ~28px) with a divider above; `note` renders muted/small (reasons, waiver
  explanations). CTA button and `note` prop behavior unchanged.
- **`/parent/register/page.tsx`:** map the existing preview fields onto the new kinds —
  tuition (+ prorated note), sibling discount (`kind: 'discount'`, with
  `siblingDiscountReason` as a `note` line), registration fee (or, when waived, a `note`
  line with `registrationFeeReason` and a `discount` line for `savings.registrationFeeWaived`),
  **"Due at enrollment"** = `totalChargeAmount` (`kind: 'total'`), and — only when
  `savings.total > 0` — a "You save $`savings.total` today" line, value straight from the
  backend. Same mapping on the post-payment confirmation summary. **Zero arithmetic in the
  page — formatting (`.toFixed(2)`) only.**
- **`/parent/book-trial` + `/parent/register-private`:** inherit the panel restyle
  automatically; touch their line arrays only if something visually breaks (e.g. a
  now-white-on-white value). No `kind` mapping required.
- `lib/types.ts`: extend the preview response interface with the `savings` block (typed
  against the real response — hard rule 8).

### 4.3 Out of scope for this phase (explicitly)

- **Multi-child "family total" in one checkout.** Registration is deliberately one child per
  flow (one-active-subscription guard, per-child ledger — ADR 005/008). A cross-child family
  quote needs a family-quote endpoint and a multi-child flow redesign; if the owner wants it,
  it's its own future plan. The sibling discount still shows correctly per child — including
  the bridge case — because the backend already handles it.
- Plan-duration pickers, prepay discounts, "step up" hints, editable athlete lanes.

### 4.4 Tests + gates

- Frontend: `OrderSummary` tests for the three new kinds; register-page test asserting the
  savings line renders **verbatim from a mocked `savings.total`** (MSW, per
  `docs/TESTING_STRATEGY.md`) and is absent when `savings.total === 0`; existing preview
  tests updated for new lines.
- E2E: `parent-register.spec.ts` — update/extend the summary-rail assertions to the new line
  labels ("Due at enrollment").
- Backend: 4.1 tests; full suite green (the 2 known pre-existing proration failures noted in
  CLAUDE.md are the only tolerated exceptions if still present).
- Docs: `docs/features/parent-portal.md` (flow kit — OrderSummary contract),
  `DATABASE_SCHEMA_DOCUMENTATION.md` untouched (no schema change).
- **PR 3 → `develop`.**

---

## 5. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Rename `--color-gold` → `--color-accent` (grep-replace), not repurpose in place | A token named "gold" holding `#B51726` misleads every future reader; rename is mechanical and verifiable with a final grep |
| D2 | Sidebar active state uses a light crimson tint `#F2ABB2`, not raw crimson | `#B51726` text on the navy sidebar fails WCAG (~2.5:1); the tint passes (~8:1) while keeping the hue family |
| D3 | `danger` Button becomes an outline style | Solid crimson is now the brand CTA color; a solid red destructive button would be indistinguishable from a marketing CTA |
| D4 | Facility stats ship as static owner-authored copy with a source comment, not backend data and not animated counters | Same status as the hero copy; the design system's exclusion targets *animated/unverifiable* counters, and these are the owner's own published claims — copied verbatim, dated |
| D5 | Family Scorecard adopts presentation only; all amounts (including "you save") come from one backend preview response, extended server-side with a `savings` block | Hard rule 7 — the mock computes client-side; we must not. Frontend does formatting only |
| D6 | WP nav items BLOG / CAMPS / external CONTACT US not carried over | No backend behind blog or camps (camps explicitly deferred in CLAUDE.md); contact is served by the real footer; a dead-end nav item is worse UX than a missing one |
| D7 | Trial CTA label aligned to WP's "Take a Trial Class" (was "Book a Free Trial"), same `/register` destination | Visual/wording continuity with the site families already know; flow untouched. Revert is a one-string change if the owner prefers "free" in the label |

## 6. Phase order & rollout

Phases must land in order (2 depends on 1's tokens/variants; 3 uses 1's tokens). One PR
each to `develop`; owner reviews staging previews between phases. Production go-live remains
gated by the separate deployment plan's pending items (Stripe/SMTP env vars — see memory
`production-env-gaps`). Suggested check between Phase 1 and 2: eyeball `/`, `/parent/dashboard`,
`/admin/dashboard` on the `develop` preview to catch any contrast/uppercase regression before
building the new home on top.
