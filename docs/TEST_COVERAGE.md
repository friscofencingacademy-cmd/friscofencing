# Test Coverage — Frisco Fencing Academy

CKQ-style coverage snapshot (`docs/plans/ckq-ui-adoption-plan.md` Phase 6). Numbers below are real, captured by actually running both suites — not estimated.

## Backend (`backend/`)

**Current state: 19 test suites / 99 tests passing, run under `TZ=UTC`, 2026-08-20.**

```
cd backend && TZ=UTC npm test
```

| Layer | Location | What it tests | DB? |
|---|---|---|---|
| Unit | `tests/utils/{jwt,password}.test.js` | Token signing/verification, bcrypt hashing | No |
| Unit | `tests/services/billing/calculateChargeAmount.service.test.js` | Sibling-discount math | No |
| Service | `tests/services/{mail,renewal}.service.test.js` | Confirmation emails (Ethereal fallback), idempotent renewal job + cancel-then-charge race | Yes (memory) |
| Route-integration | `tests/routes/*.routes.test.js` (12 files) | Full HTTP round-trip per entity — auth, locations, levels, group-classes, schedules, sessions, prices, students, trial-classes, registrations, subscriptions, payment-methods, Stripe webhook | Yes (memory), + real Stripe TEST-mode API for `registration`/`paymentMethod` |
| Smoke | `tests/health.test.js` | `/health` endpoint | No |

### Coverage gaps (honest, not hidden)

- `src/routes/user.routes.js` (`GET /users`, used by the admin schedules page's coach picker and the schedules page's coach-name lookup) has **no dedicated backend test file** — it's exercised only transitively by whatever frontend MSW fixtures assume its shape, never against the real route. Worth a small `user.routes.test.js` (list-all, `?role=` filter, 403 for non-admin).
- `src/utils/billingDates.js` (`addOneMonth`, `todayAtMidnight`) has no standalone unit test — only indirect coverage via `registration.routes.test.js` and `renewal.service.test.js` exercising the dates it produces.
- The two new delete guards added in Phase 2 (`GroupClass` blocked by `GroupClassSchedule`, `Level` also blocked by `Price`) are tested at the route-integration level (`groupClass.routes.test.js`, `level.routes.test.js`) — no separate service-unit test, which is consistent with how every other existing guard (`Location`/`GroupClass`, original `Level`/`GroupClass`) was already tested before this plan.

## Frontend (`frontend/`)

**Current state: 30 test suites / 137 tests passing, run under `TZ=UTC`, 2026-08-20.**

```
cd frontend && TZ=UTC npm test
```

| Layer | Location | What it tests | Network |
|---|---|---|---|
| Component — admin | `app/admin/**/__tests__/*.test.tsx` (layout, dashboard, redirect page, 4 Pattern-A CRUD pages, schedules, sessions) | Shell role-gate, dashboard counts, full CRUD (create/edit/delete/blocked-delete) per entity | MSW |
| Component — portal shell | `app/components/portal/{PortalLayout,ParentPortalShell,AddChildModal}/__tests__/*.test.tsx` | Nav rendering/active-state, per-child rows + status lines, modal payload/validation/error | MSW (shell tests), none (pure `AddChildModal` unit tests) |
| Component — flow kit | `app/components/portal/flow/__tests__/flow.test.tsx` | Stepper done/active/upcoming states, `OrderSummary` CTA disabled/loading, `ChildPickerCards` selection, `FlowConfirmation` rendering | None (pure component tests) |
| Component — parent pages | `app/parent/**/__tests__/*.test.tsx` (layout, dashboard, children, child detail, book-trial wizard, register wizard, subscriptions, payment-method) | Full wizard walkthroughs with exact payload assertions, context-driven rendering, tab/not-found states, guard behavior | MSW (+ Stripe SDK module mock for `payment-method`) |
| Component — shared UI | `app/components/ui/{Button,LoadError}/__tests__/*.test.tsx`, `app/components/__tests__/ProtectedRoute.test.tsx` | Design-system primitives, route guard | None |
| Component — auth/public | `app/{login,register}/__tests__/*.test.tsx` | Login/register forms | MSW |
| Component — coach/shared | `app/sessions/[id]/attendance/__tests__/page.test.tsx` | Shared attendance-marking page (coach + admin) | MSW |
| Hook | `lib/hooks/__tests__/useLoadState.test.ts` | Success/error/retry/data-reset, `getErrorMessage` status-code branching | None |
| Service | `lib/services/__tests__/catalog.test.ts` | Query-throws / mutation-never-throws contract | MSW |

### Coverage gaps (honest, not hidden)

- Only one service file (`catalog.ts`) has a dedicated service-level test; `scheduling.ts` and `parent.ts` are exercised only transitively through the pages that call them (every mutation/query path in both files IS covered this way — e.g. `bookTrialClass`/`createRegistration`/`cancelSubscription`/`savePaymentMethod` all have payload assertions in their respective page tests — but there's no standalone `scheduling.test.ts` / `parent.test.ts` the way `catalog.test.ts` exists). Low priority: the coverage is real, just organized under the consuming page instead of the service file.
- `AppShell.tsx` itself still has **zero direct test coverage** (a pre-existing gap noted in the plan's §2 "Current state," not introduced by this plan) — it's exercised only indirectly by every coach/logged-out page test that renders through it.
- No component-level test exists for `AdminPageHeader`/`AdminTableRows` in isolation — coverage is real but only via every admin page that renders them.
- The `Card` component (`app/components/ui/Card/`) has no dedicated test file (it's a two-line wrapper; every page test renders through it).

### Intentionally skipped (by design, not oversight)

- **`/sessions/[id]/attendance` restyle** — out of scope for this plan (shared coach/admin page, explicitly left untouched per §1's locked decisions); its existing test suite was left as-is.
- **Schedule edit/delete** — deliberately deferred (ripple effects on generated `GroupClassSession` docs and rosters); there is no UI to test because there is no feature.
- **Coach pages/shell** — explicitly out of scope for the entire plan (`docs/plans/ckq-ui-adoption-plan.md` "Out of scope" section); `AppShell`'s coach nav and `/coach/*` pages are untouched.
- **E2E (Playwright)** — not yet built for this project at all (predates this plan; see `docs/TESTING_STRATEGY.md`'s Layers table).

## Improvement plan (short)

1. Add `backend/tests/routes/user.routes.test.js` (list, `?role=` filter, 403 for non-admin) — smallest real gap identified above.
2. Add a standalone `backend/tests/utils/billingDates.test.js` for `addOneMonth`/`todayAtMidnight`.
3. Retrofit the frontend suite from `fireEvent` to `userEvent.setup()` per the interaction rule now codified in `docs/TESTING_STRATEGY.md` — sizable (~30 files), tracked here rather than done ad hoc inside this docs-organization phase.
4. Consider splitting `scheduling.ts`/`parent.ts` service-level tests out from their consuming pages once either file grows past what its current pages exercise.
