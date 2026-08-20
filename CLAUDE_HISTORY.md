# Frisco Fencing Academy — History

One row per shipped feature/PR, most recent first.

| Date | Change |
|---|---|
| 2026-08-20 | **Live in production**: `friscofencing.vercel.app` (frontend) + `friscofencing-backend.vercel.app` (backend), both verified end-to-end (home page, superadmin login, Secure/HttpOnly cookie, Atlas connectivity). Two Vercel projects wired to GitHub `main`/`develop` → Atlas `friscofencing`/`friscofencing-staging`. |
| 2026-08-20 | Vercel deploy readiness: serverless entry (`backend/api/index.js` + `vercel.json`), cookie `secure` flag by NODE_ENV, frontend `/api/v1` rewrite proxy (first-party auth cookie on Vercel), relative axios baseURL. GitHub repo + develop/main branches created; Atlas cluster with `friscofencing` + `friscofencing-staging` DBs seeded. Plan: `docs/plans/deployment-launch-plan.md`. Known gap found in owner testing: admin pages have no edit/delete UI (backend routes exist) — next feature. |
| 2026-08-08 | Public home page (hero, offerings, CTA, footer) + login/register cross-links + a "book a free trial" prompt on /parent/children. Registration deliberately stays immediate-access, no email verification (CKQ's real flow hard-gates on it; deferred here by choice). |
| 2026-08-07 | Design system applied across all 17+ pages (auth, admin, parent, coach, shared attendance). Two real bugs found during the Phase 12 live E2E pass fixed along the way: same-day trial sessions were always excluded from booking (date-vs-now comparison bug in book-trial), and cancelling a subscription showed "undefined undefined-undefined" until reload (unpopulated cancel response merged into state instead of refetching). Both have regression tests. |
| 2026-08-07 | Design system foundation: tokens (near-black primary, gold accent-only), Saira/Saira Condensed fonts, Button/Alert/Card, AppShell (role-aware nav). Brand inspired by FencerIQ, rebalanced for a dense CRM. See `docs/design-system.md`. |
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
