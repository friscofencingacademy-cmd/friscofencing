# Testing Strategy — Frisco Fencing Academy

## Layers
- **Unit** — pure functions/services (discount math, renewal eligibility, date/period calculations). Jest.
- **Integration** — API routes against a real MongoDB instance. Jest + Supertest, backend only for now. Uses `mongodb-memory-server` to spin up an ephemeral real MongoDB process per test run — this is a real Mongo engine, not a mock, so it doesn't require a MongoDB server already running on the machine (relevant until local MongoDB is actually installed).
- **E2E** — full browser flows (registration, attendance marking). Playwright — added once the frontend has real flows worth covering end-to-end; not needed for the initial scaffold.

## Conventions
- Backend tests live in `backend/tests/`, mirroring `backend/src/` (e.g. `src/services/subscription.service.js` → `tests/services/subscription.service.test.js`).
- Frontend tests live colocated in `__tests__/` next to the component/page they cover.
- Mock at the network boundary (MSW on the frontend, a real local test database on the backend) — not at the service/module boundary (`jest.mock('../service')`). Module-level mocking hides real integration bugs.

## Rules carried over from CKQ
- No `any` on domain data in tests — if a fixture doesn't type-check against the real schema, the schema or the fixture is wrong, not the test.
- No time-bomb dates — use fixed historical instants, never "now + N days" logic that silently breaks on a future run.
- Every subscription-renewal test must explicitly cover the cancel-then-charge race: a subscription cancelled between snapshot and charge-time must never be charged. This is the exact bug class the in-house billing model (`docs/decisions/001-in-house-subscription-billing.md`) exists to prevent — it needs a regression test, not just a design doc.
