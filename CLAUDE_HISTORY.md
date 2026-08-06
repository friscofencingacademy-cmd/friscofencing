# Frisco Fencing Academy — History

One row per shipped feature/PR, most recent first.

| Date | Change |
|---|---|
| 2026-08-06 | Phase 11: Stripe webhook (scoped: record + dedup payment_intent.succeeded/failed, no reconciliation). Raw-body middleware ordering verified correct. |
| 2026-08-06 | Phase 10: confirmation/receipt emails (trial, registration, renewal) via mail.service.js -- never throws, zero-setup local dev via Ethereal auto-fallback when SMTP_HOST is unset. |
| 2026-08-06 | Phase 9: idempotent renewal job (renewOne/runRenewals) + two-stage cancellation. Implements ADR 001 in full. No scheduler yet -- standalone script (`npm run renewals`). |
| 2026-08-06 | Phase 8: 10% sibling discount in calculateChargeAmount -- dynamic lower-payer rule, deterministic tie-break, live re-derivation every call. Known accepted limitation: simultaneous-first-registration race, not fixed (real usage is serial). |
| 2026-08-06 | Phase 7b: Registration + Subscription -- first-payment charge on enrollment (real Stripe test-mode PaymentIntent), roster + future-session backfill, /parent/register page. Completes Phase 7. |
| 2026-08-06 | Phase 7a: Stripe Customer + saved-card flow (card save only, no charging yet). Backend integration test hits real Stripe test-mode API. |
| 2026-08-06 | Trial class booking — public parent signup, student creation (parentId forced server-side), TrialClass (one ever, adds student to session roster), /register + /parent/children + /parent/book-trial pages. |
| 2026-08-06 | Attendance marking — PATCH endpoint (admin: any session; coach: own assigned schedule only, checked in the service), shared attendance page for coach + admin, new coach schedule/session listing pages. |
| 2026-08-06 | Price model + admin CRUD — one monthlyFee per level, looked up dynamically at billing time (no FK on GroupClass). |
| 2026-08-06 | Location/Level/GroupClass/Schedule/Session models + CRUD + admin pages. Schedule creation auto-generates an 8-week session window (no cron). `ProtectedRoute` frontend guard added. |
| 2026-08-06 | Users/Auth: `User` model, JWT/Passport (httpOnly `accessToken` cookie), login/me/logout endpoints, idempotent superadmin seed script, frontend `AuthContext` + login page. Integration tests use `mongodb-memory-server`; frontend auth test uses MSW. |
| 2026-08-06 | Project scaffolded — repo structure, backend/frontend skeletons, docs (CLAUDE.md, TESTING_STRATEGY.md, DATABASE_SCHEMA_DOCUMENTATION.md, ADR 001). |
