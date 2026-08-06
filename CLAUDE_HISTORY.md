# Frisco Fencing Academy — History

One row per shipped feature/PR, most recent first.

| Date | Change |
|---|---|
| 2026-08-06 | Attendance marking — PATCH endpoint (admin: any session; coach: own assigned schedule only, checked in the service), shared attendance page for coach + admin, new coach schedule/session listing pages. |
| 2026-08-06 | Price model + admin CRUD — one monthlyFee per level, looked up dynamically at billing time (no FK on GroupClass). |
| 2026-08-06 | Location/Level/GroupClass/Schedule/Session models + CRUD + admin pages. Schedule creation auto-generates an 8-week session window (no cron). `ProtectedRoute` frontend guard added. |
| 2026-08-06 | Users/Auth: `User` model, JWT/Passport (httpOnly `accessToken` cookie), login/me/logout endpoints, idempotent superadmin seed script, frontend `AuthContext` + login page. Integration tests use `mongodb-memory-server`; frontend auth test uses MSW. |
| 2026-08-06 | Project scaffolded — repo structure, backend/frontend skeletons, docs (CLAUDE.md, TESTING_STRATEGY.md, DATABASE_SCHEMA_DOCUMENTATION.md, ADR 001). |
