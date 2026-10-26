# ADR 013: Payment provider port — one interface, one adapter per vendor, one active at a time

**Status:** Proposed — 2026-10-26 (becomes Implemented when `docs/plans/payment-provider-port-plan.md` PR 1 merges to `develop`; PR numbers recorded here then)

## Context
Every place this backend charges money, saves a card, or verifies a webhook calls the Stripe SDK
directly — 8 calls across 6 files, 2 `error.type === 'StripeCardError'` sniffs, 4 Stripe-named
persisted fields, one Stripe-only frontend card form, and a Stripe publishable key baked into the
frontend build (measured at `develop` @ `5391c8c`, `docs/plans/payment-provider-port-plan.md` §1).
The owner wants to be able to leave Stripe for Square without a rewrite: "I should be able to use
any provider." Frisco's production has no real payment data yet, which makes a clean rename cheap
today and expensive later.

CKQ solved the same problem in September 2026 (ADR `backend-021`, `backend-2.0` #1025/#1027/#1028,
`website2.0` #1462, all in production): a `src/payments/` port with a Stripe adapter, selection by
`PAYMENT_PROVIDER`, normalised statuses at the boundary, a Jest static guard as the real gate, and
one frontend folder as the only SDK import boundary. That design is adopted here, reduced to the
members this codebase calls, and extended with a second adapter CKQ never built.

## Decision
1. **A port in `backend/src/payments/`** (`contract.js`, `index.js`, `stripe/stripe.provider.js`,
   `square/square.provider.js`). Business code calls `getPaymentProvider()` and uses only the
   contract: `charge`, `createCustomer`, `attachPaymentMethod`, `detachPaymentMethod`,
   `findPayment`, `verifyWebhook`, plus `name` and `capabilities`. A method is added when its first
   caller exists, never before (no refunds, reports or fee estimates today).
2. **Normalised shapes at the boundary.** Dollars in, provider minor units inside. `charge()` resolves
   `{ id, status: 'succeeded'|'processing'|'requires_action'|'failed', failureMessage, raw }` and
   **never throws for a card-level failure**; `attachPaymentMethod` throws the house `httpError(402)`
   for one. Infrastructure errors are re-thrown unchanged (the error middleware reads only
   `.status`, which neither SDK sets, so they become the generic 500). `raw` is for logging and
   repair only — business code never reads it.
3. **Provider-neutral persisted fields** (owner decision 2026-10-26): `User.paymentProvider` +
   `providerCustomerId`, `PaymentMethod.provider` + `providerPaymentMethodId`,
   `Registration.provider` + `providerPaymentId`, `WebhookEvent.provider` + `providerEventId` /
   `providerPaymentId`, request body `paymentMethodToken`. Dry-run-first, idempotent migration.
4. **Exactly one provider is active** (owner decision 2026-10-26): `PAYMENT_PROVIDER` selects it; a
   customer or saved card on the other provider is treated as absent (hidden, never deleted), so
   every existing "no card on file" path handles a cutover; replacing a card never calls the
   inactive provider. Rollback is the env var. No dual-provider routing.
5. **Recovery does not depend on the provider being searchable.** Stale-pending recovery asks for
   a payment by the id the ledger row recorded first; by our reference only when
   `capabilities.findByReference` (Stripe: metadata search; Square: `ListPayments` cannot filter by
   `reference_id`/`customer_id`/`note`, verified in the SDK's request type); otherwise it re-drives
   the charge under the same idempotency key, which both providers answer with the original payment.
   The charge path persists the provider payment id on the row the moment the provider returns it.
6. **One webhook route** `POST /api/v1/webhooks/:provider`, raw body, 404 for any provider that is
   not the active one; the adapter verifies the signature and normalises the event; `WebhookEvent`
   dedups on `{ provider, providerEventId }` and keeps the raw provider event type for audit.
7. **The frontend has one provider-aware folder**, `app/components/payment/`, and reads the active
   provider's public configuration from the backend (`GET /api/v1/payments/config`) — the backend
   remains the single source of truth and the frontend build needs no provider key. Square's
   browser SDK is loaded by our own loader, not a community wrapper.
8. **Enforced by Jest static guards, not ESLint** (this repo has no ESLint): `providerBoundaryGuard`
   (backend — only the adapters and their `config/*.js` may require an SDK or sniff its error
   shape; allowlist empty) and `paymentSdkBoundaryGuard` (frontend). Tests reach a provider only
   through `tests/testUtils/payments.js`.
9. **Tests hit real provider test modes** (Stripe TEST, Square sandbox), never SDK mocks — the
   existing house rule — through one shared adapter contract suite that every adapter must pass,
   plus a CI job that runs the payment suites with `PAYMENT_PROVIDER=square`.

## Honest edges (documented, not abstracted away)
- Saved cards do not travel between providers; families re-enter a card after a cutover
  (`scripts/list-saved-cards-by-provider.js` lists who).
- Refunds and disputes on charges made under the previous provider are handled in that provider's
  dashboard; this codebase has no refund flow.
- Square does not document how long an idempotency key is honoured; decision 5's id-first lookup is
  the mitigation.
- 3-D Secure / SCA challenge flows are not built; every charge is off-session with a saved card and
  a `requires_action`/`APPROVED` result is a failure, exactly as today.

## Consequences
- Switching providers is an environment change plus one adapter; nothing in `services/`, the
  models, the admin UI, the emails or the ledger names a vendor.
- Every future vendor implements the same contract and passes the same contract suite before it
  can be selected.
- A new direct SDK import anywhere fails the build.
- The `Registration` ledger (ADR 004/008) is unchanged in meaning; only its payment-id field is
  renamed. ADR 001's stated consequence — "only the charge-adapter function needs to change" — is
  now structurally true.

## Files
| File | Role |
|---|---|
| `backend/src/payments/contract.js` | Port typedefs + `assertProviderContract` |
| `backend/src/payments/index.js` | `getPaymentProvider()`, `PAYMENT_PROVIDER` |
| `backend/src/payments/stripe/stripe.provider.js` | Stripe adapter — the only Stripe SDK importer besides `config/stripe.js` |
| `backend/src/payments/square/square.provider.js` | Square adapter — the only Square SDK importer besides `config/square.js` |
| `backend/src/services/paymentCustomer.service.js` | `ensureCustomer` (was `stripeCustomer.service.js`) |
| `backend/src/controllers/webhooks.controller.js`, `routes/webhooks.routes.js` | provider-neutral webhook |
| `backend/src/services/paymentsConfig.service.js` | `GET /payments/config` |
| `backend/tests/payments/providerBoundaryGuard.test.js`, `frontend/lib/__tests__/paymentSdkBoundaryGuard.test.ts` | the gates |
| `backend/tests/payments/providerContract.shared.js` | the adapter contract suite |
| `backend/scripts/migrate-provider-fields.js` | the one-time field rename |
| `frontend/app/components/payment/` | the one provider-aware frontend folder |

## History
Plan: `docs/plans/payment-provider-port-plan.md`. CKQ precedent: `chesskq-workspace/docs/decisions/backend-021-payment-provider-port.md`.
