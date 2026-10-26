# Test Coverage — Frisco Fencing Academy

Every number here is real, captured by running the suites — not estimated. The policy behind them (floors, what each layer is for) lives in `docs/TESTING_STRATEGY.md`; this file holds the figures, and is re-measured on every PR that adds or moves tests.

**Backend: 89 suites / 1,232 tests, all passing. Statements 94.08%.**
**Frontend: 76 suites / 609 tests, all passing. Statements 90.13%. The full run prints no warning or error.**
**E2E: 99 tests listed in 12 specs — 61 on `chromium`, 38 on `mobile-chrome`; 95 pass and 4 are the known visual-baseline skips (2 per project).**

Measured 2026-10-26 after `docs/plans/testing-strategy-refresh-plan.md` PR F (backend unchanged since PR D), with `npm run test:coverage` in each repo (`--coverageReporters=text` for the directory tables) and `npx playwright test --list`. Coverage counts **every** source file (`collectCoverageFrom`: backend `src/**` + `scripts/lib/**`, frontend `app/**` + `lib/**`) — a file no test loads shows as 0%, never as absent. CI fails below 80% statements in either repo.

## Change log (newest first)

- **2026-10-26 — testing PR F** (`feature/testing-e2e-phase2`): E2E Phase 2 — `subscriptions`, `billing` and `spotlights-admin` specs, plus a slot-taken case in `private-booking` (it already covered the register-private wizard, so no duplicate spec). They found and fixed three product defects: the admin sidebar's section toggles and links had no accessible name below 1024 px; `/parent/subscriptions` was 740 px wide on a 393 px phone (every portal table now scrolls in its own `.tableWrap`, kept by a new guard); and local E2E builds baked in a developer's `NEXT_PUBLIC_API_URL`. Every axe scan now goes through one helper, and the route-existence guard checks every spec's mock overrides (35 → 82 routes). E2E 73 → 99 listed; frontend 75 → 76 suites / 605 → 609 tests.
- **2026-10-26 — testing PR E** (`feature/testing-docs-and-gate`): `TESTING_STRATEGY.md` restructured to CKQ's layout; this file re-measured into this shape; the `ci-passed` umbrella job; the admin dashboard's axe ratchet narrowed from the whole `color-contrast` rule to the two known sidebar nodes. Counts unchanged.
- **2026-10-26 — testing PR D** (#121): `fireEvent` → `userEvent` in all 30 files, with no exceptions (two edit tests that only passed because `fireEvent.change` replaces a value were fixed). Strict MSW across all 50 MSW files (it found one handler-less request). The clock is pinned in the last 4 unpinned backend files (`testUtils/clock.js`). Two new guards. Frontend 73 → 75 suites / 596 → 605 tests.
- **2026-10-26 — testing PR C** (#120): six static guards, `scripts/dead-negative-assertions.mjs`, the `/audit-tests` skill, and 401/403/404 negatives so every route test file meets Check 11 (`student`, `groupClass`, `groupClassSchedule`, `level`, `location`, `testimonial`). After it: backend 89 suites / 1,232 tests; frontend 73 / 596.
- **2026-10-26 — testing PR B** (#119): E2E loud-fail (599 + teardown), type-locked mocks, the `mobile-chrome` project and a 360 px overflow check. E2E 41 + 2 skips → 69 + 4 across two projects.
- **2026-10-26 — payment PR 1** (#116): the payment provider port, the Stripe adapter and the shared contract suite.
- **2026-10-26 — testing PR A** (#115): coverage gated at 80% statements in CI, every source file counted, `TZ=UTC` enforced by the `test` scripts, e2e type-checked, the route-existence guard. Backend 82 suites / 1,091 tests; frontend 69 / 560.
- **2026-09-30 — kiosk PR 2**: frontend 67 suites / 554 tests, E2E 41 + 2 skips (baseline 65 / 530, E2E 36 + 2).
- **2026-09-29 — kiosk PR 1**: backend 82 suites / 1,091 tests (baseline 80 / 1,045).
- **2026-09-25 — versioned coach contracts**: backend 76 / 987, frontend 61 / 474, E2E 31 + 2.
- **2026-09-24 — coach pack pricing**: backend 76 / 980, frontend 60 / 472. Statements 92.66% / 90.73% (loaded files only — not comparable with the every-file figures above).

## Coverage

| Area | Target | Backend | Frontend |
|---|---|---|---|
| Statements | **80% — enforced in CI** | 94.08% | 90.13% |
| Branches | — (read per directory) | 85.18% | 83.45% |
| Functions | — | 97.30% | 88.61% |
| Lines | — | 94.30% | 91.47% |

| Backend directory | Statements | Branches | Lines |
|---|---|---|---|
| `src/utils` | 100% | 99.04% | 100% |
| `src/models` | 100% | 96.77% | 100% |
| `src/middlewares` | 100% | 94.28% | 100% |
| `src/payments` | 100% | 100% | 100% |
| `src/payments/stripe` | 93.33% | 76.31% | 93.18% |
| `src/services/billing` | 97.31% | 91.46% | 97.18% |
| `src/services` — the business logic | 93.34% | 85.14% | 93.50% |
| `scripts/lib` | 97.61% | 84.31% | 98.69% |
| `src/config` | 91.66% | 85.71% | 91.66% |
| `src/email` | 92.57% | 75.73% | 93.33% |
| `src/controllers` | 85.63% | 78.12% | 85.63% |
| `src/routes` | 99.29% | 50.00% | 99.29% |

`src/routes`' 50% branches is multer upload-handler branches in `spotlight`/`testimonial`, not business logic. `src/controllers` is a real signal since duplication-cleanup PR B moved the fallback error logic into the directly-tested `errorHandler.js` (see `docs/TESTING_STRATEGY.md`, "Branch coverage").

| Frontend directory (grouped) | Statements | Branches | Lines |
|---|---|---|---|
| `lib/hooks` | 98.07% | 94.23% | 98.86% |
| `lib` (formatters, calendar view, kiosk) | 95.75% | 89.85% | 97.22% |
| `lib/services` | 90.50% | 81.25% | 90.50% |
| `app/parent/*` | 89–100% | 78–100% | 89–100% |
| `app/components/*` | 88–100% | 50–100% | 87–100% |
| `app/admin/*` | 78–100% | 59–100% | 82–100% |
| `app/context` | 95.83% | 73.33% | 95.71% |
| `app/kiosk`, `app/login`, `app/register`, `app/calendar`, `app/classes`, `app/coaches`, `app/private-classes` | 97–100% | 90–100% | 97–100% |
| `app/coach/private-students` | 86.81% | 80.76% | 89.53% |
| `app/coach/schedules` | **0%** | **0%** | **0%** |

## Backend (`backend/`)

```
cd backend && npm test            # TZ=UTC is set by the script itself
```

| Layer | Location | What it tests | DB? |
|---|---|---|---|
| Unit | `tests/utils/*.test.js` (8 files) | JWT, bcrypt, `billingDates` (DST-transition proofs), `dateShapes`, `errors`, `roles` (vs `User.ROLES`), age, `privateClassPricing` (the one savings formula in whole cents, the pack price band's exact edges, `purchaseOptionsFor`, fail-closed throws) | No |
| Unit | `tests/services/billing/*.test.js` | Sibling-discount math; proration incl. `resolveFirstChargePeriod`'s current-vs-future-month branch; the registration fee | No |
| Unit | `tests/models/*.test.js`, `tests/email/*.test.js`, `tests/config/`, `tests/middlewares/` | `periodMonth` derivation and Guard B's index; every email template renders; the timezone config; the central error handler | Some (memory) |
| Service | `tests/services/*.test.js` (16 files, plus `billing/`) | Renewal + retry/dunning with the cancel-then-charge race on each path, subscriptions, holidays, Visit, the private slot claim, kiosk, invoices, mail (staging gate) | Yes (memory) |
| Route-integration | `tests/routes/*.routes.test.js` (26 files) | Full HTTP round-trip per entity, with every route's 401/403/404 negatives (`/audit-tests` Check 11) — registrations (pricing preview, ledger rows, Guard A under a real concurrent race), private-lesson purchases and bookings (real Stripe), coach contracts and packs, availability, holidays, kiosk (incl. the lock-down from every admin endpoint), webhooks | Yes (memory), + real Stripe TEST mode for the payment routes |
| Payments | `tests/payments/*.test.js` | The port's contract and selection, the Stripe adapter through the shared contract suite (`providerContract.shared.js`), the boundary guard | Real Stripe TEST mode |
| Script | `tests/scripts/lib/*.test.js` (22 files) | Every migration/backfill helper: dry-run writes nothing, the live run, idempotent re-runs, collision aborts | Yes (memory) |
| Guards | `tests/guards/*.test.js` | No focused/reasonless-skipped test; no unpinned real-clock date helper | No |
| Smoke | `tests/health.test.js` | `/health` | No |

### Coverage gaps (honest, not hidden)

- `src/payments/stripe` branches (76.31%): the adapter's rarer Stripe error shapes are mapped but not each provoked in TEST mode.
- `src/email` branches (75.73%): optional template sections (no CC, no breakdown) are rendered by the registry test but not each branch asserted.
- `backend/scripts/*.js` entry points (seeders, `run-renewals.js`, `preview-emails.js`) have no test of their own by convention — their logic lives in `scripts/lib/` and `src/services`, which are tested.

## Frontend (`frontend/`)

```
cd frontend && npm test           # TZ=UTC is set by the script itself
npm run typecheck                 # app + e2e
```

| Layer | Location | What it tests | Network |
|---|---|---|---|
| Component — admin | `app/admin/**/__tests__/*.test.tsx` | Shell role-gate, dashboard counts, Pattern A CRUD per entity (create/edit/delete/blocked-delete, holidays' `YYYY-MM-DD` payload), subscriptions (filter/change-schedule/cancel/reactivate/charge), coach contracts and packs, private classes, audits, settings, users | MSW (strict) |
| Component — portal | `app/components/portal/**/__tests__/*.test.tsx` | Portal shell nav and per-child rows, `AddChildModal`, the flow kit (stepper, order summary, child picker), the card form | MSW (strict) / none |
| Component — parent pages | `app/parent/**/__tests__/*.test.tsx` | The book-trial, register and register-private wizards with exact payloads (frozen `Date`), dashboard, children, child detail, subscriptions, billing history, payment method | MSW (strict) + the Stripe SDK module mock |
| Component — public/coach/shared | `app/{page,classes,coaches,calendar,private-classes,login,register,kiosk}/__tests__`, `app/coach/**/__tests__`, `app/sessions/[id]/attendance/__tests__` | Public pages, auth forms, the kiosk tablet (partial fake timers), coach pages, shared attendance incl. the holiday-blocked state | MSW (strict) |
| Component — UI primitives | `app/components/ui/**/__tests__`, `app/components/layout/__tests__/AppShell.test.tsx`, `app/components/__tests__/ProtectedRoute.test.tsx` | Design-system primitives, the app shell, the route guard | None / MSW |
| Hook | `lib/hooks/__tests__/*.test.ts(x)` | `useLoadState`, `useContractPreview`, debounce | None / MSW |
| Service | `lib/services/__tests__/*.test.ts` (6 files) | The query-throws / mutation-never-throws contract for `calendar`, `catalog`, `coachContracts`, `kiosk`, `parent`, `privateClass` | MSW (strict) |
| Context | `app/context/__tests__/*.test.tsx` | `ParentPortalContext`'s `Promise.allSettled` degradation | MSW (strict) |
| Guards | `lib/__tests__/guards/*.test.ts` (9 files) | Skip/focus, `userEvent`, strict MSW, the three E2E layer rules, portal tables wrapped, self-hosted fonts, the Playwright version pin | No |

### Coverage gaps (honest, not hidden)

- **`app/coach/schedules/page.tsx` has no test (0%)** — the coach's schedule list. Its sessions sub-page is tested.
- `app/components/marketing/SpotlightCard.tsx` and `TeamBand.tsx` (0%) render only on public pages whose tests do not reach them; `app/layout.tsx` (0%) is the root layout (fonts, providers), exercised by every E2E run instead.
- `app/admin/audits` branches (59.18%) and `app/components/marketing` branches (50%): optional display states not asserted.
- `scheduling.ts` and `privateClassCoach.ts` have no service-level test of their own; they are covered through the pages that call them.
- No component-level test exists for `AdminPageHeader` in isolation — covered through every admin page that renders it. `Card` (a two-line wrapper) has no test file.

### Intentionally skipped (by design, not oversight)

- **Schedule edit/delete** (group classes) — deliberately deferred (ripple effects on generated `GroupClassSession` docs and rosters); there is no UI to test because there is no feature. The narrow "move a student between same-level schedules" case IS covered (Subscriptions).

## E2E (Playwright)

Real Chromium against a real, locally-built Next.js server, network fully mocked (loud-fail, type-locked). No istanbul number applies to this layer — it proves real DOM, routing, layout and accessibility. The spec-by-spec table, the projects and the accessibility ratchets live in `docs/TESTING_STRATEGY.md`'s E2E section.

| Project | Tests listed | Specs |
|---|---|---|
| `chromium` (Desktop Chrome) | 61 | all 12 |
| `mobile-chrome` (Pixel 5) | 38 | `public-site`, `login`, `calendar`, `kiosk`, `billing`, `subscriptions` |

Skipped: the two visual-baseline tests in `public-site.spec.ts` on each project (a baseline has to be generated inside the CI container — see the in-file comment).

**Not yet covered by E2E:** testimonials admin, the coach schedule pages, parent children/child detail, the book-trial wizard end to end (holiday-blocking drives its date picker only). Each is covered by its Jest page test.

## Improvement plan (short)

1. ~~Add a standalone `backend/tests/utils/billingDates.test.js` for `addOneMonth`/`todayAtMidnight`.~~ Done 2026-08-28 — `docs/plans/timezone-consistency-plan.md`, plus a new `scheduleOccurrence.test.js` sibling.
2. ~~Retrofit the frontend suite from `fireEvent` to `userEvent.setup()`.~~ Done 2026-10-26 (`docs/plans/testing-strategy-refresh-plan.md` PR D): all 30 files converted with no exceptions, and `userEventGuard.test.ts` keeps it that way.
3. A test for `app/coach/schedules/page.tsx` (the one 0% page).
4. ~~E2E Phase 2.~~ Done 2026-10-26 (`docs/plans/testing-strategy-refresh-plan.md` PR F).
5. `Modal` (`docs/plans/shared-modal-component-plan.md`) handles initial-focus-on-open and focus-restore-on-close, but not full focus **trapping** — Tab/Shift+Tab can still escape the dialog to the page behind it. A real, separate a11y task (or a small dependency like `focus-trap-react`), not bundled into that plan.
6. The admin sidebar's muted text (4.28:1, needs 4.5:1) — a colour decision for `docs/design-system.md`; the E2E ratchet allows only those nodes until then.
