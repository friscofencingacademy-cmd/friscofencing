# Test Coverage — Frisco Fencing Academy

CKQ-style coverage snapshot. Numbers below are real, captured by actually running both suites — not estimated.

## Real coverage % (CKQ's "Coverage Expectations" table — see `docs/TESTING_STRATEGY.md`)

| Area | Target | Backend | Frontend |
|---|---|---|---|
| Statements | 80% | 88.25% | 89.62% |
| Branches | — (informational) | 69.02% | 79.48% |
| Functions | — (informational) | 89.94% | 89.03% |
| Lines | — (informational) | 88.32% | 90.87% |

Backend re-measured 2026-08-28 via `TZ=UTC npm test -- --coverage` (`docs/plans/billing-anchor-
and-sibling-discount-plan.md`, all 3 PRs: calendar-month billing anchor; one-active-subscription-
per-student guard + create-pending-first registration + shared `chargeFinalization.service.js`;
sibling-discount family rule — backend-only). 52 suites / 519 tests, all passing. Frontend figure
carried forward from 2026-08-23 (untouched since). Both clear the 80%-statements target.

**vs. CKQ** (checked directly against their `docs/TEST_COVERAGE.md`, not assumed): CKQ tracks zero
backend % coverage — their backend section is entirely test/route counts (264 files, 6,331
tests), no istanbul numbers at all. Their one recorded % figure is frontend, dated 2026-05-27
(stale — Statements 92.59% / Branches 76.48% / Functions 62.00% / Lines 92.59%) — Frisco's
frontend branch and function coverage already beat that number. CKQ's real edge is scale/breadth
(6,331 tests vs. this repo's much smaller surface), not tighter coverage discipline.

**Branch coverage, by directory** (backend's 62.14% aggregate looks weak in isolation — it isn't):

| Directory | Branches |
|---|---|
| `src/models`, `src/utils`, `src/middlewares` | 100% |
| `src/services` (the real business logic) | 77.1% |
| `src/controllers` | 24.9% ← drags the average down |

Every controller's `catch { const status = error.status \|\| 500; ... error.message \|\| 'Failed
to ...' }` fallback only fires for a malformed, unexpected error — every error this app actually
throws already sets both fields via the per-file `notFoundError`/`badRequestError` helpers. Low-
value branches to chase, not missing business-logic coverage — `src/services` (77.1%) is the
number that actually matters, and it's solid. Full reasoning in `docs/TESTING_STRATEGY.md`'s
"Branch coverage" section.

## Backend (`backend/`)

**Current state: 65 test suites / 729 tests, last run on this (non-`TZ=UTC`) dev machine 2026-08-31
(after PR 3 of `docs/plans/payment-airtight-plan.md`). 697 pass; the 32 failures are ALL the same
pre-existing, local-machine-timezone-dependent class first documented under that plan's PR 1 — not
a single narrow $0-proration edge case any more, but several related root causes across
`registration.routes.test.js` (14), `scheduleOccurrence.test.js`, `billingDates.test.js`,
`realignBillingAnchors.test.js`, and `groupClassSchedule.routes.test.js` (18 more), all stemming
from date-math code that reads a UTC-midnight calendar-day sentinel via a Date's LOCAL getters —
correct when the process runs under `TZ=UTC` (true in CI and production), wrong on a non-UTC dev
host. Reverified via `git stash` at every PR of that plan: byte-identical failure count/set on
unmodified `develop`, so none of these are regressions from that plan's own changes. Run this suite
itself under `TZ=UTC` (as documented below) to see the CI-true, all-green count.**

```
cd backend && TZ=UTC npm test
```

| Layer | Location | What it tests | DB? |
|---|---|---|---|
| Unit | `tests/utils/{jwt,password}.test.js` | Token signing/verification, bcrypt hashing | No |
| Unit | `tests/utils/privateClassPricing.test.js` | Per-session pricing rounding + fail-closed throws (CKQ parity Phase 4) | No |
| Unit | `tests/services/billing/{calculateChargeAmount,proration}.service.test.js` | Sibling-discount math; proration math incl. `resolveFirstChargePeriod`'s current-vs-future-month branch (docs/plans/payment-airtight-plan.md D1) | No |
| Unit | `tests/models/registration.model.test.js` | `periodMonth` derivation (schema pre-validate hook), `manualNote` validation, Guard B's re-keyed unique index — incl. the exact same-month-different-day collision case the old index missed (docs/plans/payment-airtight-plan.md D7) | Yes (memory) |
| Unit | `tests/email/renderEmail.test.js` | Every registry key renders (subject/html/text non-empty, no `{{` leftovers, no `undefined`), escaping, breakdown math renders verbatim, text twin contains detailList labels + button URLs (CKQ parity Phase 2) | No |
| Service | `tests/services/{mail,renewal,subscription}.service.test.js` | Confirmation emails (staging gate + Ethereal fallback), idempotent renewal job + cancel-then-charge race, subscription list/cancel/reactivate/changeSchedule (all 4 writes, same-level/capacity/duplicate 409s, email-failure-never-fails-the-change) | Yes (memory) |
| Route-integration | `tests/routes/*.routes.test.js` (20 files) | Full HTTP round-trip per entity — auth, locations, levels, group-classes, schedules, sessions (incl. `by-class` cross-schedule listing), prices, students, users, trial-classes, registrations (incl. the pricing preview, **the new Registration payment-ledger row shape, Guard A's DB-level active-subscription-uniqueness index proven via both a re-registration-after-cancel path and a real concurrent-request race**), subscriptions, payment-methods, Stripe webhook, spotlights, **coach contracts, private-class schedules (incl. the public endpoint), private-class enrollments (incl. the atomic-slot-claim race regression), private-class sessions (incl. the full charge-pipeline: idempotency, cancel-then-charge race, declined-card retry with a fresh idempotency-keyed attempt, ownership regression), audit runs (superadmin-only reporting sink for `docs/plans/audit-system-plan.md`)** | Yes (memory), + real Stripe TEST-mode API for `registration`/`paymentMethod`/`privateClassSession`/`privateClassEnrollment` |
| Script | `tests/scripts/lib/migrateRegistrationsToLedger.test.js` | The one-time old-shape-Registration → payment-ledger migration script (`docs/plans/registration-ledger-plan.md` D8): dry-run writes nothing, live run rewrites matched docs (incl. the prorated-periodEnd variant), orphaned docs left untouched and reported, safe to re-run | Yes (memory) |
| Script | `tests/scripts/lib/migratePeriodMonth.test.js` | The one-time `periodMonth` backfill + Guard B index re-key (docs/plans/payment-airtight-plan.md D7): dry-run vs. live, idempotent re-run, collision abort with zero writes, a `failed` row never blocks | Yes (memory) |
| Smoke | `tests/health.test.js` | `/health` endpoint | No |

### Coverage gaps (honest, not hidden)

- `src/utils/billingDates.js` (`addOneMonth`, `addOneDay`, `todayAtMidnight`) has no standalone unit test — only indirect coverage via `registration.routes.test.js` and `renewal.service.test.js` exercising the dates it produces.
- The two new delete guards added in the UI-adoption plan (`GroupClass` blocked by `GroupClassSchedule`, `Level` also blocked by `Price`) are tested at the route-integration level (`groupClass.routes.test.js`, `level.routes.test.js`) — no separate service-unit test, consistent with how every other existing guard was already tested.
- `backend/scripts/{preview-emails,extend-private-sessions}.js` are manual-run operational scripts with no test file, consistent with the pre-existing `run-renewals.js`/`seed-superadmin.js` convention (none of the manual scripts in this repo have dedicated tests — their underlying logic, `generateSessions`/`renderEmail`/`renewOne`, is what's actually tested).

## Frontend (`frontend/`)

**Current state: 55 test suites / 389 tests, all passing, 2026-08-31 (after PR 3 of `docs/plans/payment-airtight-plan.md` — the `/parent/billing` payment-history page).**

```
cd frontend && TZ=UTC npm test
```

| Layer | Location | What it tests | Network |
|---|---|---|---|
| Component — admin | `app/admin/**/__tests__/*.test.tsx` (layout, dashboard, redirect page, 4 Pattern-A CRUD pages, schedules, sessions, **subscriptions, coach-contracts, private-classes**) | Shell role-gate, dashboard counts, full CRUD (create/edit/delete/blocked-delete) per entity, subscriptions list/filter/change-schedule/cancel/reactivate, coach-contract create/deactivate, private-class enrollment-cancel + schedule add/delete guards | MSW |
| Component — portal shell | `app/components/portal/{PortalLayout,ParentPortalShell,AddChildModal}/__tests__/*.test.tsx` | Nav rendering/active-state, per-child rows + status lines, modal payload/validation/error, Private Lessons nav item | MSW (shell tests), none (pure `AddChildModal` unit tests) |
| Component — flow kit | `app/components/portal/flow/__tests__/flow.test.tsx` | Stepper done/active/upcoming states, `OrderSummary` CTA disabled/loading, `ChildPickerCards` selection, `FlowConfirmation` rendering | None (pure component tests) |
| Component — parent pages | `app/parent/**/__tests__/*.test.tsx` (layout, dashboard, children, child detail, book-trial wizard, register wizard, subscriptions, **billing**, payment-method, register-private wizard) | Full wizard walkthroughs with exact payload assertions, context-driven rendering, tab/not-found states, guard behavior, private-lessons section (charges list + cancel), 409 slot-taken recovery; **`/parent/billing`** (docs/plans/payment-airtight-plan.md D10): row rendering across billing shapes, the manual-payment chip + note, failed-row status with no download link, a real invoice-download `<a href>`, empty state | MSW (+ Stripe SDK module mock for `payment-method`) |
| Component — shared payment UI | `app/components/ui/PaymentHistoryTable/` | Covered transitively through `/parent/billing`'s own test file (no standalone component test yet — same "coverage is real, organized under the consuming page" pattern the gaps list below already accepts for other UI primitives) | — |
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
## E2E (Playwright)

Built 2026-08-28 (Phase 1, `docs/plans/e2e-testing-plan.md`) — 5 spec files, 20 active tests + 2
intentionally skipped (visual-regression baselines pending a Docker-generated bootstrap), CI-gated
on every PR/push to `develop`/`main`. Real Chromium against a real Next.js server, fully mocked
network — no istanbul %-coverage number applies to this layer (it isn't measuring code paths
exercised, it's proving real DOM/routing/accessibility behavior). Full spec-by-spec breakdown, the
two known-and-ratcheted accessibility findings, and run instructions live in
`docs/TESTING_STRATEGY.md`'s E2E section — not duplicated here.

**Phase 2, not yet built**: subscriptions management, the private-class coach-contract → booking →
attendance-charge chain, the register-private wizard, spotlight admin content, cross-browser/mobile
viewports.

## Improvement plan (short)

1. ~~Add a standalone `backend/tests/utils/billingDates.test.js` for `addOneMonth`/`todayAtMidnight`.~~ Done 2026-08-28 — `docs/plans/timezone-consistency-plan.md`, plus a new `scheduleOccurrence.test.js` sibling.
2. Retrofit the frontend suite from `fireEvent` to `userEvent.setup()` per the interaction rule codified in `docs/TESTING_STRATEGY.md` — sizable, tracked here rather than done ad hoc inside a docs-organization phase.
3. Consider splitting `scheduling.ts`/`parent.ts`/`privateClass*.ts`/`coachContracts.ts` service-level tests out from their consuming pages once any of them grows past what its current pages exercise.
4. `Modal` (`docs/plans/shared-modal-component-plan.md`) handles initial-focus-on-open and focus-restore-on-close, but not full focus **trapping** — Tab/Shift+Tab can still escape the dialog to the page behind it. A real, separate a11y task (or a small dependency like `focus-trap-react`), not bundled into that plan.
