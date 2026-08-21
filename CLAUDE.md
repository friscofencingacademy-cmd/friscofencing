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

**Explicitly deferred:** weapon specialization, membership/credit-ledger discounts beyond sibling, scholarships, camps, private classes, weekly reports, student portal.

## Documentation Map
| Topic | Path |
|---|---|
| **Active plan** — deployment & launch (Steps 1–5 ✅ LIVE IN PRODUCTION 2026-08-20; Step 6 Brevo pending) | `docs/plans/deployment-launch-plan.md` |
| **SHIPPED plan** — CKQ UI adoption: admin sidebar shell, admin CRUD edit/delete, parent portal shell, registration flow wizards, child detail page, testing+docs org (all 7 phases merged to `develop` 2026-08-20; production promotion is a separate pending owner decision) | `docs/plans/ckq-ui-adoption-plan.md` |
| Design system — principles, tokens, shells, page patterns, components inventory, anti-patterns, pre-merge checklist | `docs/design-system.md` |
| Testing strategy — layers, mocking rules, interaction/date rules, typed fixtures, naming conventions, error-handling contract | `docs/TESTING_STRATEGY.md` |
| Test coverage — current suite counts (real, re-run per update), per-layer table, honest gaps, improvement plan | `docs/TEST_COVERAGE.md` |
| Admin panel — per-page behavior spec (Pattern A CRUD, delete guards, deferred schedule-edit note) | `docs/features/admin.md` |
| Parent portal — shell/context contract, flow kit, child detail page, AddChildModal, page inventory | `docs/features/parent-portal.md` |
| Database schema | `DATABASE_SCHEMA_DOCUMENTATION.md` |
| Completed work log | `CLAUDE_HISTORY.md` |
| Architecture decisions — index + status definitions | `docs/decisions/README.md` |
| Module docs | `docs/modules/` (created as modules are built) |
| Feature docs | `docs/features/` (admin, parent-portal; more created as features are built) |

## Pre-read requirements (check before acting)

Before touching any of the following areas, **read the linked doc first** — it contains rules and constraints not obvious from the code alone.

| If you're about to... | Read first |
|---|---|
| Touch admin pages, the admin shell, or admin CRUD | `docs/features/admin.md` |
| Touch parent portal pages, the portal shell, or `ParentPortalContext` | `docs/features/parent-portal.md` |
| Write or modify any test | `docs/TESTING_STRATEGY.md` |
| Touch CSS / styling / add a shell or page pattern | `docs/design-system.md` |
| Touch payment / billing / subscription / cron | `docs/decisions/001-in-house-subscription-billing.md` |
| Add or modify a DB collection or field | `DATABASE_SCHEMA_DOCUMENTATION.md` |
