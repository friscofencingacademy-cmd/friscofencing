# ADR 012: Front-desk kiosk sign-in — a kiosk-only login, name search + confirm, no PIN

**Status:** Implemented (backend, PR 1 of `docs/plans/kiosk-signin-plan.md`) — 2026-09-29. Frontend is PR 2.

## Context

The owner wants one tablet at the front desk: a student finds their name, taps it, confirms, and their attendance for the day is marked. The tablet sits where students and visitors can touch it, so whatever it is logged in as must not be able to reach anything else on the admin side.

CKQ (`chesskqwebsite`, ADR `backend-018`) solved a related problem for a fleet of classroom tablets with device pairing: a device collection, a one-time pairing code, and a device-secret cookie. That was ported first here, and was then judged too much for a single front-desk tablet (see Alternatives).

## Decision

1. **A `kiosk` user role.** Login-capable (email + password), created by an admin on `/admin/users`, and **not** in `ADMIN_ROLES`. The tablet logs in as that account and lands on `/kiosk`.
2. **Server-enforced least privilege.** The kiosk role can use exactly two endpoints, `GET /kiosk/state` and `POST /kiosk/sign-in` (`requireRole('kiosk', ...ADMIN_ROLES)`). Every admin endpoint is already `ADMIN_ROLES`- or superadmin-only, and the admin layout already redirects every non-admin role, so a kiosk login can reach nothing admin-side. A regression test asserts the 403s. The login-only read endpoints (catalog, schedules, session rosters) are readable by it — the same data any parent login already reads.
3. **No PIN.** Name search (≥ 2 characters) → tap → "Are you X?" (a setting, default on) → signed in. Staff are present; the confirm step catches a mis-tap.
4. **The server picks the session** (today, holidays excluded, eligible by own Visit / own schedule / the existing walk-in rule, not yet ended via `hasSessionEnded`, own session first, then the nearest start), and **the mark goes through the existing ledger** (`visit.service.js`, same holiday + day guard, a kiosk walk-in identical to a coach-added one). `markedVia: 'kiosk'`, `markedBy`: the account logged in on the tablet.

## Consequences

- A student signs in until their class ends; a coach can still mark attendance for the whole day.
- The kiosk login lasts 7 days like every login, so staff re-enter its password about weekly.
- Pinning the tablet to `/kiosk` (Guided Access / a kiosk browser) is still recommended for tidiness, but it is not the security boundary — decision 2 is.
- Academy-wide: the kiosk account has no location. A second location with its own tablet would add a `locationId` to that account.
- Sign-in depends on today's `GroupClassSession` existing; the weekly session-generation cron must be live before go-live.

## Alternatives considered

- **CKQ-style device pairing** (a `KioskDevice` collection, one-time pairing code, hashed device-secret cookie, a tablet-management admin page). Built and fully tested first, then dropped before commit: CKQ needs it for a fleet of classroom tablets, Frisco has one. The kiosk role gives the same guarantee that mattered (the tablet can only do attendance) with the existing login system and no new collection, cookie, or admin page.
- **Leaving an admin logged in on the tablet.** Simplest, but anyone at the desk could reach every admin page and action. Rejected in favor of the kiosk role.
- **A 4-digit PIN per student.** Friction and an issue/reset problem for no gain a staffed desk needs.
