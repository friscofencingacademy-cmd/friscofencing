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

## Frontend

- **Public nav** (`AppShell`'s logged-out branch): Classes, Coaches, Private Lessons, Log In, Book a Free Trial. Every public CTA points at `/register` — there is no guest booking (`POST /trial-classes` is parent-only).
- **`/classes`**: modeled directly on the pre-existing `/private-classes` page (same `useLoadState` + `LoadError` + grouped-rows shape). Client-side level filter over an already-fetched list (presentation, not invention). Rows grouped by `dayOfWeek` via the shared `DAY_LABELS` constant (`lib/constants.ts` — also now used by `/admin/schedules` and `/coach/schedules`, which each previously declared their own copy).
- **`app/components/marketing/`**: `Hero`, `SpotlightCard` (`align="left"|"right"`, optional `eyebrow`), `StepsRow`, `LevelGrid`, `ScheduleTable`, `CtaBand`, one `marketing.module.css`. `ScheduleTable` and `SpotlightCard` are shared between `/classes`/`/`/`/coaches` respectively.
- **`/register`, `/login`**: both accept `?next=` (register defaults to `/parent/dashboard`, login to `/`) so a Book-a-Trial click from a public page survives the auth round-trip. Both wrap their form in a `<Suspense>` boundary — `useSearchParams()` requires one for `next build`'s static prerendering to succeed.
- **`/coaches`**: every published `type: 'coach'` spotlight, alternating `SpotlightCard` alignment.

## Corrections from the handoff doc

The original handoff (`HANDOFF.md`, authored by Claude Design without full codebase visibility) got two things wrong, caught during verification before any code was written:

1. **"There is no public read surface"** — false. `private-class-schedules/public` (no auth) and the live `/private-classes` page already existed. The new `/*/public` endpoints and `/classes` page were built as siblings of that existing pattern, not invented from scratch.
2. **Route shape** — the handoff proposed a new `backend/src/routes/public.routes.js` mounted at `/api/v1/public`. The existing, already-shipped convention is a `/public` sub-route on each resource's own router; the new endpoints follow that instead, to avoid a second parallel convention.

The registration capacity gap (above) was discovered independently while verifying the availability feature, not called out by the handoff.
