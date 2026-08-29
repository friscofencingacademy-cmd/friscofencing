# Public site (marketing + catalog)

The logged-out, unauthenticated surface: `/`, `/classes`, `/coaches`, `/register`, `/login`, plus the existing `/private-classes` (shipped earlier, CKQ parity Phase 4). Built against a Claude Design handoff (`HANDOFF.md`), corrected in two places against the real codebase before implementation — see "Corrections from the handoff doc" below.

## Hard rule

**Backend is the source of truth; the frontend never derives.** No client-side price math, no seat-count arithmetic, no invented copy. Every rendered number/string on a public page traces to a `GET /*/public` response field. `docs/design-system.md`'s "Public marketing pages" section documents the one exception to the `LoadError`-always rule (the home page renders nothing on a failed section fetch, rather than an error card, since a stranger should never see an error card).

## Backend: `/*/public` endpoints (no auth)

Each existing resource router gets a `/public` sub-route (registered before its own `/:id`), matching the convention already established by `private-class-schedules/public` — **not** a separate `/api/v1/public/*` router, despite what the original handoff proposed.

| Endpoint | Returns |
|---|---|
| `GET /levels/public` | `[{ name, order, monthlyFee }]` — excludes any level with no configured `Price`, rather than showing a missing/invented fee. |
| `GET /locations/public` | `[{ name, address, timezone }]` |
| `GET /group-class-schedules/public` | `[{ className, levelName, locationName, coachName, dayOfWeek, startTime, endTime, availability }]` — `availability` is `'open' \| 'full'`, server-derived via `groupClassSchedule.service.js`'s `computeAvailability(schedule, groupClass)`. No ids, no roster, no capacity number. |
| `GET /spotlights/public?type=coach\|student` | `[{ name, title, body, bullets, imageUrl }]` — published only, ordered, verbatim strings. |

`computeAvailability` is also now the single implementation used by `subscription.service.js`'s `changeSchedule` capacity check (previously an inline duplicate) and by a **new** guard added to `registration.service.js`'s `create()` — before this work, a class could be overbooked via direct registration because only `changeSchedule` enforced capacity. Registering into a full schedule now returns `409 "This class is full"` before the Stripe charge.

## `Spotlight` model (GAP-2)

Editorial content, admin-authored, deliberately **not** linked to `User` by ObjectId — coupling it to an account row would mean either polluting `User` with marketing fields or auto-publishing a minor's record. Fields: `type` (`coach`|`student`), `name`, `title`, `body`, `bullets` (max 3, validated), `imageUrl`, `isPublished` (default `false`), `order`. Admin CRUD at `/admin/spotlights` (Pattern A, sidebar under a new **Content** section) — see `docs/features/admin.md`.

`imageUrl` can be filled in two ways: pasted directly, or via `POST /spotlights/upload-image` (admin/superadmin, multipart, 5MB cap), which uploads to **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`, provisioned via `vercel blob create-store`) and returns the file's public URL. The stored blob pathname is a random UUID, never the uploader's original filename. `@vercel/blob`'s `put()` has no test-mode equivalent (unlike Stripe) — it's mocked at the module boundary in `spotlight.routes.test.js`, a named exception in `docs/TESTING_STRATEGY.md`.

## Frontend

- **Public nav** (`AppShell`'s logged-out branch): Home, Programs (`/classes`), Our Team (`/coaches`), Private Lessons, Log In, Take a Trial Class. Every public CTA points at `/register` — there is no guest booking (`POST /trial-classes` is parent-only). Labels rebranded 2026-08-29 (`docs/plans/wordpress-ui-alignment-plan.md`, Phase 2) to mirror the live WP site's own nav wording; "Classes"/"Coaches"/"Book a Free Trial" were the pre-rebrand labels.
- **`/classes`**: modeled directly on the pre-existing `/private-classes` page (same `useLoadState` + `LoadError` + grouped-rows shape). Client-side level filter over an already-fetched list (presentation, not invention). Rows grouped by `dayOfWeek` via the shared `DAY_LABELS` constant (`lib/constants.ts` — also now used by `/admin/schedules` and `/coach/schedules`, which each previously declared their own copy). Ends in `SiteFooter` (fetches `/locations/public` alongside its existing data).
- **`app/components/marketing/`**: `Hero`, `ValuesMarquee`, `IntroSection`, `LevelGrid`, `FacilityBand`, `TeamBand`, `SpotlightCard` (`align="left"|"right"`, optional `eyebrow`), `StepsRow`, `CtaBand`, `SiteFooter`, one `marketing.module.css`. `ScheduleTable` and `SpotlightCard` are shared between `/classes`/`/`/`/coaches` respectively. `SiteFooter` is used on exactly `/`, `/classes`, `/coaches` — never on flow/auth pages (`/register`, `/login`, `/private-classes`).
- **`/register`, `/login`**: both accept `?next=`, which wins over the role-based default landing page (`ROLE_LANDING_PATH` in `lib/constants.ts` — admin/superadmin to `/admin/dashboard`, coach to `/coach/schedules`, parent to `/parent/dashboard`) added so a signed-in visitor never sees an interim "Welcome" screen. So does visiting `/` while already signed in. Both `/register` and `/login` wrap their form in a `<Suspense>` boundary — `useSearchParams()` requires one for `next build`'s static prerendering to succeed.
- **`/coaches`**: every published `type: 'coach'` spotlight, alternating `SpotlightCard` alignment. Also fetches `/locations/public` for `SiteFooter` (added Phase 2 — previously this page fetched only spotlights).

### Home page (`/`) — restructured to mirror the live WP site, Phase 2

`docs/plans/wordpress-ui-alignment-plan.md`, Phase 2 (2026-08-29). Section order: `Hero` → `ValuesMarquee` (row 1) → `IntroSection` ("Who we are") → `LevelGrid` (levels.length > 0 only) → `FacilityBand` → `TeamBand` (coach spotlights) → `ValuesMarquee` (row 2) → student `SpotlightCard` (unchanged from before this phase) → `StepsRow` → `CtaBand` → `SiteFooter`. All the "backend is SOT, no invented copy" rules above still apply — every new section either renders real backend data or the owner's own static copy, captured verbatim from the live WP site and dated in each component's comment.

- **Full-bleed bands**: `Hero`, `ValuesMarquee`, `TeamBand`, `CtaBand`, and `SiteFooter` break out of `AppShell`'s padded, `max-width:1100px` `.content` wrapper via `marketing.module.css`'s `.fullBleed` utility (the classic `width:100vw` + `left:50%`/`margin:-50vw` technique, independent of the parent's own width). `overflow-x: hidden` lives on `body` (`globals.css`), not on `.content` — `.content` is the fullBleed sections' direct parent, so putting it there would clip the very content the technique is meant to let escape (a real bug hit and fixed during this build, not a hypothetical). Every base class combined with `.fullBleed` sets its own vertical margin via `margin-top`/`margin-bottom` longhands, never the `margin: X 0` shorthand — the shorthand would also zero out `.fullBleed`'s `margin-left`/`margin-right`, and CSS Modules gives no reliable guarantee about which of two same-specificity rules in different source positions wins.
- **`Hero` is not a photo hero**, despite the original plan calling for one: the plan's designated hero image (the WP site's own hero background) turned out to be a stock photo of children playing soccer — leftover multi-sport theme content the WP site never replaced with real fencing photography, caught by an actual screenshot check during this build, not assumed. Ships as a solid navy gradient band instead (`.heroBand`) until a real photo is available; the other three downloaded photos (`who-we-are.png`, the three `program-*` images) were visually verified as genuinely fencing-related and are used as designed.
- **`TeamBand`** and **`SpotlightCard`** both render an admin-entered `imageUrl` via a plain CSS `background-image` div, never `next/image` — `imageUrl` is an arbitrary admin-entered URL (pasted, or a Vercel Blob upload), and `next/image` requires every remote source host to be allowlisted in `next.config.js`'s `remotePatterns`, which an unbounded admin-entered URL can't satisfy. `LevelGrid`'s and `IntroSection`'s photos ARE `next/image` (local files under `frontend/public/marketing/`, no remote-host concern).
- **`FacilityBand`'s stats** (10 strips / 5+ trainers / 7 days) are static, owner-authored copy verbatim from the live WP site, not backend data and not animated counters — same status as `Hero`'s copy, still excluded from the design system's animated-counters ban because these are dated, sourced, real published claims rather than an invented/unverifiable metric.
- **`frontend/public/marketing/`**: downloaded WP assets — `logo.svg`, `who-we-are.png`, `program-{beginner,intermediate,advanced}.{jpg,png}` (all referenced in code), plus `coach-{chris,abel,lauren}.png` (NOT referenced in code — staged for the owner to upload via `/admin/spotlights`' image-upload endpoint to publish the three coach Spotlights `TeamBand` needs to render anything).

## Corrections from the handoff doc

The original handoff (`HANDOFF.md`, authored by Claude Design without full codebase visibility) got two things wrong, caught during verification before any code was written:

1. **"There is no public read surface"** — false. `private-class-schedules/public` (no auth) and the live `/private-classes` page already existed. The new `/*/public` endpoints and `/classes` page were built as siblings of that existing pattern, not invented from scratch.
2. **Route shape** — the handoff proposed a new `backend/src/routes/public.routes.js` mounted at `/api/v1/public`. The existing, already-shipped convention is a `/public` sub-route on each resource's own router; the new endpoints follow that instead, to avoid a second parallel convention.

The registration capacity gap (above) was discovered independently while verifying the availability feature, not called out by the handoff.
