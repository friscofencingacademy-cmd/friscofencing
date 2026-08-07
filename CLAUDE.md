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
Class-management platform for Frisco Fencing Academy. Single repo, local-only for now — no deployment, no hosting, no production database yet.

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

**Explicitly deferred:** weapon specialization, membership/credit-ledger discounts beyond sibling, scholarships, camps, private classes, weekly reports, student portal, hosting/deployment.

## Documentation Map
| Topic | Path |
|---|---|
| Design system | `docs/design-system.md` |
| Testing strategy | `docs/TESTING_STRATEGY.md` |
| Database schema | `DATABASE_SCHEMA_DOCUMENTATION.md` |
| Completed work log | `CLAUDE_HISTORY.md` |
| Architecture decisions | `docs/decisions/` |
| Module docs | `docs/modules/` (created as modules are built) |
| Feature docs | `docs/features/` (created as features are built) |
