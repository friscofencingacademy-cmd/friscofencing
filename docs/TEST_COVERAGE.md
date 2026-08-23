# Test Coverage — Frisco Fencing Academy

CKQ-style coverage snapshot. Numbers below are real, captured by actually running both suites — not estimated.

## Real coverage % (CKQ's "Coverage Expectations" table — see `docs/TESTING_STRATEGY.md`)

| Area | Target | Backend | Frontend |
|---|---|---|---|
| Statements | 80% | 84.86% | 89.46% |
| Branches | — (informational) | 62.00% | 79.41% |
| Functions | — (informational) | 85.00% | 89.03% |
| Lines | — (informational) | 84.92% | 90.70% |

Measured 2026-08-23 via `TZ=UTC npm test -- --coverage` in each repo. Both already clear the 80%-statements target.

## Backend (`backend/`)

**Current state: 30 test suites / 280 tests passing, run under `TZ=UTC`, 2026-08-23 (after the audit system's `AuditRun` model/API — `docs/plans/audit-system-plan.md`).**

```
cd backend && TZ=UTC npm test
```

| Layer | Location | What it tests | DB? |
|---|---|---|---|
| Unit | `tests/utils/{jwt,password}.test.js` | Token signing/verification, bcrypt hashing | No |
| Unit | `tests/utils/privateClassPricing.test.js` | Per-session pricing rounding + fail-closed throws (CKQ parity Phase 4) | No |
| Unit | `tests/services/billing/calculateChargeAmount.service.test.js` | Sibling-discount math | No |
| Unit | `tests/email/renderEmail.test.js` | Every registry key renders (subject/html/text non-empty, no `{{` leftovers, no `undefined`), escaping, breakdown math renders verbatim, text twin contains detailList labels + button URLs (CKQ parity Phase 2) | No |
| Service | `tests/services/{mail,renewal,subscription}.service.test.js` | Confirmation emails (staging gate + Ethereal fallback), idempotent renewal job + cancel-then-charge race, subscription list/cancel/reactivate/changeSchedule (all 4 writes, same-level/capacity/duplicate 409s, email-failure-never-fails-the-change) | Yes (memory) |
| Route-integration | `tests/routes/*.routes.test.js` (20 files) | Full HTTP round-trip per entity — auth, locations, levels, group-classes, schedules, sessions (incl. `by-class` cross-schedule listing), prices, students, users, trial-classes, registrations (incl. the pricing preview), subscriptions, payment-methods, Stripe webhook, spotlights, **coach contracts, private-class schedules (incl. the public endpoint), private-class enrollments (incl. the atomic-slot-claim race regression), private-class sessions (incl. the full charge-pipeline: idempotency, cancel-then-charge race, declined-card retry with a fresh idempotency-keyed attempt, ownership regression), audit runs (superadmin-only reporting sink for `docs/plans/audit-system-plan.md`)** | Yes (memory), + real Stripe TEST-mode API for `registration`/`paymentMethod`/`privateClassSession`/`privateClassEnrollment` |
| Smoke | `tests/health.test.js` | `/health` endpoint | No |

### Coverage gaps (honest, not hidden)

- `src/utils/billingDates.js` (`addOneMonth`, `todayAtMidnight`) has no standalone unit test — only indirect coverage via `registration.routes.test.js` and `renewal.service.test.js` exercising the dates it produces.
- The two new delete guards added in the UI-adoption plan (`GroupClass` blocked by `GroupClassSchedule`, `Level` also blocked by `Price`) are tested at the route-integration level (`groupClass.routes.test.js`, `level.routes.test.js`) — no separate service-unit test, consistent with how every other existing guard was already tested.
- `backend/scripts/{preview-emails,extend-private-sessions}.js` are manual-run operational scripts with no test file, consistent with the pre-existing `run-renewals.js`/`seed-superadmin.js` convention (none of the manual scripts in this repo have dedicated tests — their underlying logic, `generateSessions`/`renderEmail`/`renewOne`, is what's actually tested).

## Frontend (`frontend/`)

**Current state: 45 test suites / 231 tests passing, run under `TZ=UTC`, 2026-08-23 (after the audit system's `/admin/audits` report page — `docs/plans/audit-system-plan.md`).**

```
cd frontend && TZ=UTC npm test
```

| Layer | Location | What it tests | Network |
|---|---|---|---|
| Component — admin | `app/admin/**/__tests__/*.test.tsx` (layout, dashboard, redirect page, 4 Pattern-A CRUD pages, schedules, sessions, **subscriptions, coach-contracts, private-classes**) | Shell role-gate, dashboard counts, full CRUD (create/edit/delete/blocked-delete) per entity, subscriptions list/filter/change-schedule/cancel/reactivate, coach-contract create/deactivate, private-class enrollment-cancel + schedule add/delete guards | MSW |
| Component — portal shell | `app/components/portal/{PortalLayout,ParentPortalShell,AddChildModal}/__tests__/*.test.tsx` | Nav rendering/active-state, per-child rows + status lines, modal payload/validation/error, Private Lessons nav item | MSW (shell tests), none (pure `AddChildModal` unit tests) |
| Component — flow kit | `app/components/portal/flow/__tests__/flow.test.tsx` | Stepper done/active/upcoming states, `OrderSummary` CTA disabled/loading, `ChildPickerCards` selection, `FlowConfirmation` rendering | None (pure component tests) |
| Component — parent pages | `app/parent/**/__tests__/*.test.tsx` (layout, dashboard, children, child detail, book-trial wizard, register wizard, subscriptions, payment-method, **register-private wizard**) | Full wizard walkthroughs with exact payload assertions, context-driven rendering, tab/not-found states, guard behavior, private-lessons section (charges list + cancel), 409 slot-taken recovery | MSW (+ Stripe SDK module mock for `payment-method`) |
| Component — public/coach | `app/private-classes/__tests__/page.test.tsx`, `app/coach/private-students/__tests__/page.test.tsx` | Public availability browse page (empty state, book-slot href); coach attendance page (unmarked list, confirm-dialog amount, attended/missed PATCH payloads, failed-charge Retry) | MSW |
| Component — shared UI | `app/components/ui/{Button,LoadError}/__tests__/*.test.tsx`, `app/components/__tests__/ProtectedRoute.test.tsx` | Design-system primitives, route guard | None |
| Component — auth/public | `app/{login,register}/__tests__/*.test.tsx` | Login/register forms | MSW |
| Component — coach/shared | `app/sessions/[id]/attendance/__tests__/page.test.tsx` | Shared attendance-marking page (coach + admin) | MSW |
| Hook | `lib/hooks/__tests__/useLoadState.test.ts` | Success/error/retry/data-reset, `getErrorMessage` status-code branching | None |
| Service | `lib/services/__tests__/catalog.test.ts` | Query-throws / mutation-never-throws contract | MSW |
| Context | `app/context/__tests__/ParentPortalContext.test.tsx` | `privateEnrollments` added to the `Promise.allSettled` set; its failure degrades to `[]` without setting `error` | MSW |

### Coverage gaps (honest, not hidden)

- Only one service file (`catalog.ts`) has a dedicated service-level test; `scheduling.ts`, `parent.ts`, and the new `privateClass*`/`coachContracts.ts` service files are exercised only transitively through the pages that call them — every mutation/query path IS covered this way (payload assertions live in the consuming page's test), but there's no standalone `*.test.ts` the way `catalog.test.ts` exists. Low priority: the coverage is real, just organized under the consuming page instead of the service file.
- `AppShell.tsx` itself still has **zero direct test coverage** (a pre-existing gap, not introduced by any of the plans run so far) — it's exercised only indirectly by every coach/logged-out page test that renders through it (now including the new `/coach/private-students` nav link).
- No component-level test exists for `AdminPageHeader`/`AdminTableRows` in isolation — coverage is real but only via every admin page that renders them.
- The `Card` component (`app/components/ui/Card/`) has no dedicated test file (it's a two-line wrapper; every page test renders through it).

### Intentionally skipped (by design, not oversight)

- **`/sessions/[id]/attendance` restyle** — out of scope for the UI-adoption plan (shared coach/admin page, explicitly left untouched); its existing test suite was left as-is.
- **Schedule edit/delete** (group classes) — deliberately deferred (ripple effects on generated `GroupClassSession` docs and rosters); there is no UI to test because there is no feature. (The narrow "move a student between same-level schedules" case IS now covered — see the Subscriptions rows above.)
- **E2E (Playwright)** — not yet built for this project at all; see `docs/TESTING_STRATEGY.md`'s Layers table.

## Improvement plan (short)

1. Add a standalone `backend/tests/utils/billingDates.test.js` for `addOneMonth`/`todayAtMidnight`.
2. Retrofit the frontend suite from `fireEvent` to `userEvent.setup()` per the interaction rule codified in `docs/TESTING_STRATEGY.md` — sizable, tracked here rather than done ad hoc inside a docs-organization phase.
3. Consider splitting `scheduling.ts`/`parent.ts`/`privateClass*.ts`/`coachContracts.ts` service-level tests out from their consuming pages once any of them grows past what its current pages exercise.
