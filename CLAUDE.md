# CLAUDE.md — Frisco Fencing Academy Platform

Single source of truth for project context, decisions, standards, and workflow.
Adapted from the CKQ platform's conventions — this project is fully independent:
no shared codebase, database, or deployment with CKQ.

---

# HARD RULES — ALWAYS FOLLOWED, NO EXCEPTIONS

### Before writing any code
1. **Discuss the problem and the proposed solution first.** Explain what you plan to change and why.
2. **The word `write` in the user's message is the only valid trigger to write or edit any file.** "ok", "yes", "sounds good", "do it", "go ahead", "sure" are NOT sufficient — they approve the plan, not the implementation.
3. Only then write code.

### After writing code
4. **Write tests before committing.** Code is not complete without tests. Exception: docs-only commits (`.md` files only) need no tests.
5. **Wait for the user to test locally before committing.** Never auto-commit once code and tests are done.
6. **Never auto-fix test failures.** Show the failure summary, the root cause, and a fix plan — then stop. Do not touch any file until the user says `write`.
7. **The backend is the source of truth for billing/subscription state.** Never compute discount amounts, renewal eligibility, or payment status in the frontend.
8. **No `any` on domain data — fix the type, don't cast it.** A type error on a domain object (API response, model, service return) means the type is wrong; correct it against the real schema.
9. **No `console.log` in production code.**

### Git rules
10. **Never use `git add .` or `git add -A`.** Stage files explicitly by name.
11. **Feature branches for all non-trivial work**, once the project has enough history to warrant branching discipline — the initial scaffold may land on `main` directly since there's nothing to branch from yet.
12. **Read every file before editing it.**

---

## Project Overview
Class-management platform for Frisco Fencing Academy. Single repo: `friscofencingacademy-cmd/friscofencing` on GitHub.

## Deployment & Environments
Full setup steps + env-var tables: `docs/plans/deployment-launch-plan.md`.

| Git branch | Role | Vercel | MongoDB (Atlas cluster0) |
|---|---|---|---|
| `main` | production | Production deploys (2 projects: root `backend/`, root `frontend/`) | `friscofencing` |
| `develop` | staging | Preview deploys (stable branch aliases) | `friscofencing-staging` |

- Work on `feature/*` branches → PR to `develop`; `develop` → `main` only with explicit owner approval.
- Frontend proxies `/api/v1/*` to the backend via a Next.js rewrite (`BACKEND_URL`) so the httpOnly auth cookie stays first-party — never call the backend origin directly from the browser.
- Atlas URI + account details live in Claude memory (`frisco-credentials.md`) — **never commit credentials**.
- Email: Nodemailer over Brevo SMTP in deployed envs (`SMTP_*` env vars); Ethereal auto-fallback locally.

## Tech Stack
| Layer | Stack |
|---|---|
| Backend | Node.js, Express, MongoDB, Mongoose |
| Frontend | Next.js 14, React 18, TypeScript, CSS Modules (see `docs/design-system.md`) |
| Auth | JWT + Passport (backend), React context (frontend) |
| Payments | Stripe — `PaymentIntent`s against a saved `PaymentMethod`, in-house subscription/billing model (NOT Stripe's native Subscriptions object). See `docs/decisions/001-in-house-subscription-billing.md`. |
| Email | Nodemailer — real SMTP via `SMTP_HOST` env vars, or a zero-setup Ethereal test account auto-created for local dev when unset |

## Repo Structure
- `backend/` — Express/Mongoose API (`src/`: routes → controllers → services → models)
- `frontend/` — Next.js 14 App Router app

## Roles
`student`, `parent`, `coach`, `admin`, `superadmin`.

## Platform Scope (MVP)
Users/auth · group classes/schedules/sessions · pricing · attendance · trial + regular registration · in-house recurring subscription billing with a 10% sibling discount (dynamic lower-payer rule, re-verified every renewal, 2-child case only).

**Explicitly deferred:** weapon specialization, membership/credit-ledger discounts beyond sibling, scholarships, camps, weekly reports, student portal.

Private classes shipped (CKQ parity Phase 4, 2026-08-21) — coach contracts, published slots, public self-registration, attendance-triggered per-session Stripe charge. See `docs/features/private-class.md`.

Public site shipped (2026-08-21) — logged-out home/`/classes`/`/coaches`, `/*/public` backend endpoints, `Spotlight` admin content model, a registration capacity-guard fix. See `docs/features/public-site.md`.

## Documentation Map
| Topic | Path |
|---|---|
| **Active plan** — deployment & launch (Steps 1–5, 7, 8 ✅ LIVE IN PRODUCTION; Step 6 Brevo + other follow-ups pending) | `docs/plans/deployment-launch-plan.md` |
| **ACTIVE PLAN — READY FOR SONNET BUILD (2026-08-28, not started)** — calendar-month billing anchor (ADR 007: renewals on the 1st — current code is anniversary-billed, a discovered divergence from the intended CKQ model), one-active-subscription-per-student guard (ADR 005), sibling-discount rewrite to the family rule (ADR 006: top payer excluded, N children, immediate at registration incl. the bridge discount, F3/F4 fixes). 3 PRs, ordered. Decisions live in ADRs 005/006/007. | `docs/plans/billing-anchor-and-sibling-discount-plan.md` |
| **NEXT-BATCH ORCHESTRATOR — ALL 3 ITEMS COMPLETE 2026-08-28** — (1) orphaned-reference fix SHIPPED (PR #44) + §8f live-verified on staging, (2) registration-ledger PR 2 (renewal create-pending-first + stale-pending recovery) BUILT, (3) PR 3 (retry/dunning + cancel-after-exhaustion) BUILT — both PR 2 and PR 3 executed against the post-unified-ledger discriminated schema per the concrete deltas this doc carried, verified against current source at each step. Batch closed; see `docs/plans/registration-ledger-plan.md` for the per-PR completion notes. | `docs/plans/next-batch-execution-plan.md` |
| **SHIPPED plan** — timezone consistency, owner-sequenced 2026-08-28 before ledger PR 2 below: `todayAtMidnight()`/renewal cron's "today" gate was server-local (UTC in prod) instead of Central — same bug class CKQ's `dateUtils.js` fixed after 4 repeat incidents. Adds `moment-timezone` + `DEFAULT_TIMEZONE` (`config/timezone.js`); `todayAtMidnight`/`addOneDay`/`nextOccurrenceStrictlyAfter`/`nextOccurrenceOnOrAfter` now tz-aware; new `todayDateOnly()` fixes a second, distinct bug found mid-build in `registration.service.js`'s `anchorDate` fallback; `Location.timezone` gains IANA-format validation (still unwired to any call site — one location today). Two real, non-trivial gaps were caught and corrected DURING this build (not just planned in advance) — see the plan's D9/D10 for both. MERGED TO DEVELOP (PR #45): 455/456 backend tests (the 1 failure is the pre-existing, independently-reverified-via-`git stash` unrelated $0-proration bug), 0 frontend files touched. | `docs/plans/timezone-consistency-plan.md` |
| **Shipped plan** — Service registry + unified two-dimension payment ledger: `Service` model (stable `code` + declared `billingShape` — CKQ's registry with its name-string-as-key wart fixed), `Registration` restructured into a shared money-contract base + three billing-shape discriminators (`subscription_cycle`/`per_session`/`one_time_event`), `PrivateClassCharge` absorbed and retired, camps/meets covered schema-only for the future. PR A (#41) + PR B (#42) MERGED TO DEVELOP 2026-08-28 (426/428 backend tests; the 2 failures are the pre-existing unrelated proration bug). [ADR 004](./docs/decisions/004-service-registry-and-unified-ledger.md) records the design. | `docs/plans/service-registry-unified-ledger-plan.md` |
| **SHIPPED plan** — orphaned-reference crash fix, Item 1 of the next-batch orchestrator above, fully closed 2026-08-28: coach/student/parent delete-guards added (`user.service.js`), read paths degrade instead of crashing (`listPublic()` filter, frontend `| null` type-widening + fallback labels), read-only `find-orphaned-references.js` diagnostic added. MERGED TO DEVELOP (PR #44); §8f live verification passed on staging (200 + clean diagnostic scan). | `docs/plans/orphaned-coach-reference-fix-plan.md` |
| **SHIPPED plan (PR 3 BUILT, pending owner review)** — Registration → per-charge payment ledger (CKQ model): rebuilt `Registration` schema, two DB-level guards (active-Subscription uniqueness + ledger dedup index), create-pending-first renewal sequencing, stale-pending recovery, daily retry/dunning with cancel-after-3, migration script. PR 1 of 3 MERGED TO DEVELOP 2026-08-27 (PR #37). PR 2 (renewal `renewOne()` rework + `recoverStalePending` + `sendPaymentFailureEmail`) BUILT 2026-08-28 — one real Stripe SDK bug (misplaced `metadata`) found and fixed during the build. PR 3 (`retryOne`/`cancelAfterExhaustion`/`runRetries`, two-phase `run-renewals.js`) BUILT 2026-08-28 — reuses PR 2's charge/finalize helpers via a new `attemptNumber` param rather than duplicating them; 473/475 backend tests (2 pre-existing unrelated proration failures). §7 doc close-outs done (ADR-001 addendum, `TESTING_STRATEGY.md` line-45 mandate, gap-analysis status flip). See the plan's "PR 2"/"PR 3 completion notes" for full detail. Companion finding: `docs/plans/registration-ledger-gap-analysis.md` (now decided-and-implemented). | `docs/plans/registration-ledger-plan.md` |
| **SHIPPED plan (pending owner review)** — premium (flat-fee, any-session) group class registration, `Visit` attendance ledger (replaces `GroupClassSession.students[].isPresent`), `Evaluation` trial-assessment model. All 4 phases built on `feature/premium-registration-and-attendance` 2026-08-24 — see [ADR 003](docs/decisions/003-premium-group-class-billing.md). Verified against both this codebase and a local CKQ checkout, plus real staging Mongo (not just mongodb-memory-server). Not yet merged to `develop`. | `docs/plans/premium-registration-and-attendance-plan.md` |
| **SHIPPED plan (pending owner review)** — CKQ parity, all 4 phases complete on `feature/ckq-parity` 2026-08-21: staging email block (`APP_ENV` gate), block-based email design system (10 templates), admin Group Class Subscriptions page (list/change-schedule/cancel/reactivate), full private-class flow (coach contracts → published slots → public self-registration → attendance-triggered per-session Stripe charge). One autonomous 4-phase build. Not yet merged to `develop` — see `CLAUDE_HISTORY.md` for the exact local-test commands. | `docs/plans/ckq-parity-plan.md` |
| **SHIPPED plan** — CKQ UI adoption: admin sidebar shell, admin CRUD edit/delete, parent portal shell, registration flow wizards, child detail page, testing+docs org (LIVE IN PRODUCTION 2026-08-21) | `docs/plans/ckq-ui-adoption-plan.md` |
| **SHIPPED plan** — admin user management: create/edit/change-password/delete with role-hierarchy security (LIVE IN PRODUCTION 2026-08-21) | `docs/plans/admin-user-management-plan.md` |
| Design system — principles, tokens, shells, page patterns, components inventory, anti-patterns, pre-merge checklist | `docs/design-system.md` |
| Testing strategy — layers, mocking rules, interaction/date rules, typed fixtures, naming conventions, error-handling contract | `docs/TESTING_STRATEGY.md` |
| Test coverage — current suite counts (real, re-run per update), per-layer table, honest gaps, improvement plan | `docs/TEST_COVERAGE.md` |
| Email system — block-based design system architecture, tokens, template registry, CC table, the `APP_ENV` staging gate, preview-script usage | `docs/modules/email.md` |
| Admin panel — per-page behavior spec (Pattern A CRUD, delete guards, Subscriptions/Coach Contracts/Private Classes pages, amended schedule-edit deferral note) | `docs/features/admin.md` |
| Parent portal — shell/context contract, flow kit, child detail page, AddChildModal, private-lessons wizard, page inventory | `docs/features/parent-portal.md` |
| Private classes — lifecycle, model map, charge pipeline + idempotency layers, the four CKQ-BUG-FIXes, route table, page inventory | `docs/features/private-class.md` |
| Public site — `/*/public` endpoints, `Spotlight` model, marketing components, corrections made against a design handoff doc | `docs/features/public-site.md` |
| Database schema | `DATABASE_SCHEMA_DOCUMENTATION.md` |
| Completed work log | `CLAUDE_HISTORY.md` |
| Architecture decisions — index + status definitions | `docs/decisions/README.md` |
| Module docs | `docs/modules/` (email; more created as modules are built) |
| Feature docs | `docs/features/` (admin, parent-portal, private-class, public-site; more created as features are built) |

## Pre-read requirements (check before acting)

Before touching any of the following areas, **read the linked doc first** — it contains rules and constraints not obvious from the code alone.

| If you're about to... | Read first |
|---|---|
| Touch admin pages, the admin shell, or admin CRUD | `docs/features/admin.md` |
| Touch parent portal pages, the portal shell, or `ParentPortalContext` | `docs/features/parent-portal.md` |
| Write or modify any test | `docs/TESTING_STRATEGY.md` |
| Touch CSS / styling / add a shell or page pattern | `docs/design-system.md` |
| Touch payment / billing / subscription / cron | `docs/decisions/001-in-house-subscription-billing.md` |
| Touch email templates, the block-based design system, or the staging send gate | `docs/modules/email.md` |
| Touch coach contracts, private-class schedules/enrollments/sessions, or the per-session Stripe charge | `docs/features/private-class.md` |
| Touch the public home page, `/classes`, `/coaches`, any `/*/public` endpoint, or the `Spotlight` model | `docs/features/public-site.md` |
| Add or modify a DB collection or field | `DATABASE_SCHEMA_DOCUMENTATION.md` |
