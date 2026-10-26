# Payment Provider Port — Stripe today, Square next, nothing in business code knows which

**Status:** READY-TO-EXECUTE (2026-10-26). Spec'd by the planning session from a measured audit of
this repo at `develop` @ `5391c8c` and of CKQ's shipped port (`chesskq-workspace` ADR
`backend-021`, `backend-2.0` #1025/#1027/#1028, `website2.0` #1462 — all in CKQ production).
Every Square fact below was read from Square's own docs or SDK source on 2026-10-26, not recalled.
Six PRs, strictly sequential, each independently shippable and reviewable.
**Owner decisions (2026-10-26):** rename every persisted `stripe*` field to a provider-neutral name
(D6); exactly ONE provider is active at a time — never both — and the target state is "all
payments through Square" once PR 5 is on `develop` (D7).

**Owner's ask (2026-10-26):** "Make the system stripe agnostic. I want the system to work easily if
I switch out stripe with square (that will be next step) … whatever you can copy [from CKQ] I want
you to just copy that."

**Executor contract:** this document is the complete instruction set. The executing model follows
§5 file by file, writes the §6 tests, runs the §7 checks for the PR, and reports in the §9 format.
It does not choose; if a step is ambiguous, or a §7 check fails for a reason this doc does not
anticipate, it STOPS and reports (CLAUDE.md Hard Rule 6 — never auto-fix a failing test).

---

## 0. Pre-reads (mandatory for the executor — `CLAUDE.md` HARD RULES apply throughout)

| Before touching… | Read |
|---|---|
| Anything | `CLAUDE.md` (HARD RULES 1–12; `write` was given for this plan's PRs by the owner on 2026-10-26 — see §9 for exactly what that authorises) |
| Any payment / billing / subscription file | `docs/decisions/001-in-house-subscription-billing.md` (all addenda), `docs/decisions/008-registration-create-pending-first.md`, `docs/decisions/011-private-per-session-booking.md` |
| Any test | `docs/TESTING_STRATEGY.md` — especially "Mocking rules" (real Stripe TEST mode, never mocked) and "Real Stripe in tests — never read the account as a whole" |
| Any frontend page / component | `docs/features/parent-portal.md` §"Payment Method", `docs/design-system.md` |
| A new field or collection | `DATABASE_SCHEMA_DOCUMENTATION.md` (`User`, `PaymentMethod`, `Registration`, `WebhookEvent` sections) |
| The register wizard or payment-method page | `docs/TESTING_STRATEGY.md`'s E2E section — `parent-register.spec.ts` must stay green; PR 5 adds `payment-method.spec.ts` |
| Deployment / env vars | `docs/plans/deployment-launch-plan.md` §4a/§4b (the two env-var tables this plan extends) |

Also read by the executor before any edit, as the reference implementation being copied:
`C:\Users\mages\chesskqwebsite\backend\backend-2.0\src\payments\{contract.js,index.js,stripe\stripe.provider.js}`,
`…\src\__tests__\unit\payments\{providerBoundaryGuard,index,contract,stripe.provider}.test.js`,
`…\src\__tests__\helpers\fakePaymentProvider.js`. (Read-only. Nothing is imported from that checkout
at runtime; the files are re-typed into this repo with the adaptations §5 names.)

---

## 1. Problem — confirmed against `develop` @ `5391c8c`

Stripe is wired directly into business code. Measured, not estimated (`grep -rnoE
"stripe\.(paymentIntents|customers|paymentMethods|webhooks|refunds)\." backend/src backend/scripts`):

| # | File:line | Direct SDK call |
|---|---|---|
| 1 | `backend/src/services/billing/chargeFinalization.service.js:71` | `stripe.paymentIntents.create` — the ONE charge path (group initial, renewal, retry, private purchase) |
| 2 | `backend/src/services/paymentMethod.service.js:22` | `stripe.paymentMethods.attach` |
| 3 | `backend/src/services/paymentMethod.service.js:54` | `stripe.paymentMethods.detach` |
| 4 | `backend/src/services/stripeCustomer.service.js:12` | `stripe.customers.create` |
| 5 | `backend/src/services/renewal.service.js:238` | `stripe.paymentIntents.search` (stale-pending recovery, by `metadata['registrationId']`) |
| 6 | `backend/src/controllers/stripeWebhook.controller.js:19` | `stripe.webhooks.constructEvent` |
| 7 | `backend/scripts/audit-reset.js:130` | `stripe.paymentMethods.detach` |
| 8 | `backend/src/app.js:41` | comment only (names the SDK call the raw-body mount exists for) |

Plus **2** Stripe error-shape sniffs (`error.type === 'StripeCardError'` at
`chargeFinalization.service.js:84` and `paymentMethod.service.js:35`), **4** Stripe-named persisted
fields — `User.stripeCustomerId` (`user.model.js:75`), `PaymentMethod.stripePaymentMethodId`
(`paymentMethod.model.js:17`), `Registration.stripePaymentIntentId` (`registration.model.js:65`, on
the base schema so every discriminator carries it), `WebhookEvent.stripeEventId`
(`webhookEvent.model.js:15`) — used at 46 sites in `src`, 17 in `scripts`, 106 in `tests`, 7 in
`frontend` (full list in §5.2), one Stripe-only frontend card form
(`frontend/app/components/portal/PaymentMethodCardForm.tsx`, `@stripe/react-stripe-js`) wrapped in
`<Elements stripe={stripePromise}>` by two pages (`app/parent/payment-method/page.tsx:91`,
`app/parent/register/page.tsx:648`), a module-scope `loadStripe()` in `frontend/lib/stripe.ts` that
forces `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to exist at **build** time
(`frontend/playwright.config.ts:49` hardcodes Stripe's public example key for that reason), and the
request body field `stripePaymentMethodId` on `POST /payment-methods`
(`frontend/lib/services/parent.ts:128`, `PaymentMethodCardForm.tsx:60`, `paymentMethod.service.js:16`).

Nothing enforces the boundary: there is no ESLint in either repo (`frontend/node_modules/.bin` has
no `eslint`; `backend/package.json` has none), so a new direct SDK import today goes unnoticed.

**What already helps:** every charge funnels through one function (`chargeLedgerRow`), every
customer lookup through one (`ensureStripeCustomer`), both card operations live in one service, and
both webhook routes/controllers are two small files. Amounts are already dollars in the domain and
converted to cents only at the SDK call. This is why Frisco needs 6 PRs where CKQ needed a longer
migration: the seams are already in the right places; they just name Stripe.

---

## 2. Prior art

### 2.1 Industry standard
Ports-and-adapters ("hexagonal") for the payment gateway: one interface the domain depends on,
one adapter per vendor, selection by configuration, vendor objects never cross the boundary, a
contract test suite every adapter must pass. Browser card tokenisation stays vendor-specific (PCI
scope) behind one UI boundary. **Verdict: follows.**

### 2.2 Internal consistency (searched, not recalled)
- CKQ ADR `backend-021` + `docs/modules/payment.md` §30: the exact shape adopted here — `src/payments/`
  port, `getPaymentProvider()` singleton keyed by `PAYMENT_PROVIDER`, `assertProviderContract`,
  normalised status, `raw` never read by business code, a Jest static guard as the real gate,
  one frontend folder as the only SDK import boundary. Their explicit "honest edges" (saved cards do
  not travel between providers; refunds on old payments in the old dashboard) are kept.
- Frisco ADR 001 "Consequences": "Full portability of the billing domain model if the payment vendor
  ever changes — only the charge-adapter function needs to change." This plan makes that true.
- Frisco ADR 008 (create pending first) and the stale-pending recovery in `renewal.service.js` — kept
  byte-for-byte in semantics; D4 only changes *how* the provider is asked "did this charge happen?".
- `docs/plans/duplication-cleanup-plan.md` PR B: errors are built only through `utils/errors.js`
  (`httpError(402, …)` for declines); the error middleware reads only `.status`, never
  `.statusCode`. The adapters follow this (D3).
- `docs/TESTING_STRATEGY.md`: real Stripe TEST mode, never mocked; `tests/testUtils/stripe.js`'s
  three keyed lookups. Kept, generalised to `tests/testUtils/payments.js` (D9).
**Verdict: consistent with every doc above; diverges from CKQ only where Frisco is simpler (no
Connect destinations, no refunds/reports, one card per parent) — those methods are omitted rather
than stubbed (D2).**

### 2.3 Simplest option
| Option | What it is | Why chosen or rejected |
|---|---|---|
| Do nothing; rewrite call sites when Square arrives | 8 calls + 2 sniffs + 4 fields edited in place later | Rejected — it is the same work, done under time pressure, with no guard stopping the next direct import |
| Keep Stripe names, add a `provider` field (CKQ's choice) | Least churn | Rejected by owner (D6): CKQ had 22k charges to protect; Frisco production has no real payment data yet, so the rename is cheap today and never again |
| **Port + adapters + static guards + rename + Square adapter + frontend boundary (this plan)** | 6 PRs | **Chosen** — the only option that makes "switch providers" a config change plus one adapter |
| Dual-provider routing (charge each card on the provider it was saved with) | Both SDKs live at once | Rejected by owner (D7): one provider at a time; over-engineering now |

### 2.4 UI strategy
PR 3 and PR 5 change UI: one component (`PaymentMethodCollector`) replaces `PaymentMethodCardForm`
in the two places it is rendered, visually identical (same `Card`/`Button`/`Alert`, same
`shared.module.css` classes, the Square card container styled with the same border/radius tokens).
No new page, no new nav. Design-system §10 pre-merge checklist applies to PR 3 and PR 5 only.

---

## 3. Decisions (all resolved — nothing is OPEN)

| # | Decision | Resolution and reason |
|---|---|---|
| D1 | Port location and selector | `backend/src/payments/{contract.js, index.js, stripe/stripe.provider.js, square/square.provider.js}`; `getPaymentProvider()` singleton selected by `PAYMENT_PROVIDER` (`'stripe'` default until the Square cutover, §11). Copied from CKQ. |
| D2 | Required contract surface | Only what has a caller: `name`, `capabilities`, `charge`, `createCustomer`, `attachPaymentMethod`, `detachPaymentMethod`, `findPayment`, `verifyWebhook`. **No** `refund`/`cancelPayment`/`listPayments`/`listFees`/`estimateFee`/`setDefaultPaymentMethod` — Frisco has no refund flow, no revenue report, one card per parent. A method is added to the contract in the PR that adds its first caller, never before (CKQ's own PR-1 rule). |
| D3 | Error contract at the boundary | A **card-level** failure never throws from `charge()`: it resolves `{ status: 'failed', failureMessage, id }` (D3a). A card-level failure on `attachPaymentMethod` throws `httpError(402, providerMessage)` (D3b) — today's exact behaviour. Any other provider error (auth, network, rate limit, invalid request) is re-thrown **unchanged** — `errorHandler.js` reads only `.status`, which neither SDK's error sets, so it becomes the generic 500 with the real error logged server-side (today's behaviour). Business code never inspects `error.type`, `error.category`, `error.code`. |
| D4 | "Did this charge already happen?" (stale-pending recovery) | Port method `findPayment({ paymentId?, reference? })`. `capabilities.findByReference` says whether the provider can look a payment up by our reference (Stripe: yes, metadata search; **Square: no** — `ListPayments` has no `reference_id`/`customer_id`/`note` filter, verified in the SDK's `ListPaymentsRequest` type). Recovery order: (1) the row's own `providerPaymentId` if present → `findPayment({ paymentId })`; (2) else if `findByReference` → `findPayment({ reference })`; (3) else re-drive the charge under the **same idempotency key** — both providers return the original payment for an identical retry. To make (1) available as often as possible, PR 4 makes `chargeLedgerRow` persist `providerPaymentId` on the row the moment `charge()` returns, before finalisation. Square does not document how long an idempotency key is honoured — recorded in the ADR as an edge; (1) is the mitigation. |
| D5 | Webhooks | One route `POST /api/v1/webhooks/:provider` mounted with `express.raw` before `express.json()`; the controller 404s unless `:provider === getPaymentProvider().name`, then calls `provider.verifyWebhook({ rawBody, headers })` → `{ eventId, type: 'payment.succeeded'\|'payment.failed'\|'ignored', paymentId, providerStatus, providerEventType, raw }`. `WebhookEvent` stores `{ provider, providerEventId, type: providerEventType (raw, audit), providerPaymentId, status: providerStatus }` only for non-`ignored` events, deduped by `{ provider, providerEventId }`. The Stripe URL `/api/v1/webhooks/stripe` is unchanged (no dashboard re-registration). |
| D6 | Persisted field names (**owner decision**) | `User.stripeCustomerId` → `User.providerCustomerId` + new `User.paymentProvider`; `PaymentMethod.stripePaymentMethodId` → `providerPaymentMethodId` + `provider`; `Registration.stripePaymentIntentId` → `providerPaymentId` + `provider`; `WebhookEvent.stripeEventId` → `providerEventId` + `provider`, `paymentIntentId` → `providerPaymentId`. Request body `stripePaymentMethodId` → `paymentMethodToken`. Dry-run-first migration script (PR 2) that `$rename`s, stamps `provider: 'stripe'` on rows that have a value, drops the two old unique indexes, and is idempotent. |
| D7 | One provider at a time (**owner decision**) | Switching = set `PAYMENT_PROVIDER` (and the new provider's secrets) and redeploy. A saved card or customer belonging to the *other* provider is treated as absent: `paymentMethod.service.getMine` returns `null` unless `doc.provider === active.name`; `ensureCustomer` creates a fresh customer on the active provider when `user.paymentProvider !== active.name`. Every charge path already handles "no card on file" (`renewal.service.js:518/555/662/983` return `failed_no_payment_method`; `registration.service.js:183` and `privateClassEnrollment.service.js:155` 400) — no new branch anywhere. Replacing a card never calls `detach` on the *other* provider (its SDK is not active); the doc is overwritten in place. `scripts/list-saved-cards-by-provider.js` (PR 6) tells the owner who must re-enter a card before a cutover. |
| D8 | Square adapter facts (verified 2026-10-26) | SDK `square` (current major 46; v40+ is the rewritten `SquareClient` API). `new SquareClient({ token, environment: SquareEnvironment.Sandbox \| .Production })`. `payments.create({ idempotencyKey (≤45 chars), sourceId, customerId (required for a card on file), amountMoney: { amount: BigInt(cents), currency: 'USD' }, locationId, referenceId (≤40), note (≤500), autocomplete: true (default) })` → `payment.status ∈ APPROVED \| PENDING \| COMPLETED \| CANCELED \| FAILED`. `customers.create({ idempotencyKey, givenName, familyName, emailAddress, referenceId (≤100) })`. `cards.create({ idempotencyKey, sourceId: <Web Payments token>, card: { customerId, referenceId } })` → `card.{ id, cardBrand, last4, expMonth, expYear, fingerprint, enabled }`; charge later with `sourceId: card.id` + `customerId`; remove with `cards.disable({ cardId })`. Errors: `SquareError` with `statusCode`, `body.errors[] { category, code, detail, field }`; card-level category is `PAYMENT_METHOD_ERROR` (codes e.g. `CARD_DECLINED`, `GENERIC_DECLINE`, `INSUFFICIENT_FUNDS`, `CVV_FAILURE`, `CARD_EXPIRED`); `RATE_LIMIT_ERROR`/`API_ERROR`/`AUTHENTICATION_ERROR`/`INVALID_REQUEST_ERROR` are infrastructure. Webhooks: header `x-square-hmacsha256-signature`, `WebhooksHelper.verifySignature({ requestBody, signatureHeader, signatureKey, notificationUrl })` → boolean; event body `{ merchant_id, type: 'payment.created'\|'payment.updated', event_id, created_at, data: { type: 'payment', id, object: { payment } } }`. Sandbox test sources: `cnon:card-nonce-ok`, `cnon:card-nonce-declined`, `ccof:customer-card-id-ok`, `ccof:customer-card-id-declined`; test PAN `4111 1111 1111 1111` (success), `4000 0000 0000 0002` (decline). Browser: `https://sandbox.web.squarecdn.com/v1/square.js` / `https://web.squarecdn.com/v1/square.js`, `window.Square.payments(applicationId, locationId)`, `await payments.card()`, `card.attach('#selector')`, `tokenResult = await card.tokenize()`, `tokenResult.status === 'OK' ? tokenResult.token : tokenResult.errors`. |
| D9 | Tests | Real provider test modes stay the rule (Stripe TEST mode, Square **sandbox**), never SDK mocks. One **shared adapter contract suite** (`tests/payments/providerContract.shared.js`) runs identically against both adapters. `tests/testUtils/stripe.js` becomes provider-neutral `tests/testUtils/payments.js` (same three keyed lookups, implemented per active provider). The fake provider (`tests/testUtils/fakePaymentProvider.js`, copied from CKQ) is used ONLY by `payments/index.test.js` and `payments/contract.test.js` — never by a business-service or route test. CI gains a second backend job that runs the payment suites with `PAYMENT_PROVIDER=square` against the sandbox (PR 4). |
| D10 | Frontend provider config | One source of truth: the backend. New public `GET /api/v1/payments/config` returns `{ provider: 'stripe', stripe: { publishableKey } }` or `{ provider: 'square', square: { applicationId, locationId, environment } }` from backend env (`STRIPE_PUBLISHABLE_KEY` moves to the backend; `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is deleted). `frontend/app/components/payment/` is the only folder allowed to import `@stripe/*` or touch `window.Square` / `squarecdn.com` — enforced by a Jest static guard (no ESLint exists). Pages render `<PaymentMethodCollector onSaved submitLabel />` and know nothing else. Square's browser SDK is loaded by our own 30-line script loader, **not** the community `react-square-web-payments-sdk` (two competing forks on npm, neither Square-owned). |
| D11 | Zero behaviour change in PR 1 | Every stored string, status code and email is byte-identical after PR 1. In particular the stored `failureMessage` for a non-succeeded, non-declined Stripe result stays exactly `PaymentIntent status: <raw status>` — the Stripe adapter emits that literal (§5.1.3). The route suites that hit real Stripe must pass **unchanged** in PR 1 except for import-path edits. |
| D12 | What is explicitly NOT built | Refunds; disputes; a dual-provider period; migrating saved cards between providers; Stripe Connect / Square app fees; 3-D Secure / SCA challenge flows (every charge is off-session with a saved card, as today — a `requires_action`/`APPROVED` result is a failure, as today); `listPayments`-based reconciliation reports. Each is a future plan with its own first caller. |

---

## 4. Target architecture

```
backend/src/payments/
  contract.js          JSDoc typedefs + assertProviderContract(adapter)        (PR 1)
  index.js             getPaymentProvider(), _resetForTests()                   (PR 1)
  stripe/stripe.provider.js   the ONLY file (besides config/stripe.js) that    (PR 1)
                              requires 'stripe' or config/stripe
  square/square.provider.js   the ONLY file (besides config/square.js) that    (PR 4)
                              requires 'square' or config/square
backend/src/config/stripe.js  unchanged (SDK bootstrap, placeholder key)
backend/src/config/square.js  SquareClient bootstrap, placeholder token         (PR 4)
backend/src/services/paymentCustomer.service.js   ensureCustomer(user)          (PR 1, renamed from stripeCustomer.service.js)
backend/src/controllers/webhooks.controller.js    provider-neutral handler      (PR 1, renamed)
backend/src/routes/webhooks.routes.js             POST /:provider               (PR 1, renamed)
backend/src/routes/payments.routes.js + controllers/payments.controller.js
                                                  GET /payments/config          (PR 3)
backend/tests/payments/                           guard, index, contract, adapter + shared contract suite
frontend/app/components/payment/
  PaymentMethodCollector.tsx   picks the provider form from GET /payments/config (PR 3)
  usePaymentConfig.ts          fetch + useLoadState                              (PR 3)
  stripe/StripeCardForm.tsx    today's PaymentMethodCardForm + <Elements> inside (PR 3)
  square/SquareCardForm.tsx    Web Payments SDK card + tokenize                  (PR 5)
  square/loadSquareSdk.ts      script loader, resolves window.Square             (PR 5)
```

### 4.1 The port contract (`contract.js`) — normative

```js
/**
 * @typedef {Object} ChargeRequest
 * @property {number} amount            dollars (adapter converts to the provider's minor unit)
 * @property {string} customerId        the provider customer id our DB stored for this parent
 * @property {string} paymentMethodId   the provider's saved-card id our DB stored
 * @property {string} idempotencyKey    `payment_<registrationId>` or `payment_<registrationId>_retry<n>` — ≤ 45 chars
 * @property {string} reference         our Registration row id as a string (≤ 40 chars) — what a provider that CAN search is asked for later
 * @property {Object} metadata          flat string map; Stripe stores it as metadata, Square folds it into `note`
 *
 * @typedef {Object} ChargeResult
 * @property {string|null} id           provider payment id (null only when a decline produced no payment object)
 * @property {'succeeded'|'processing'|'requires_action'|'failed'} status
 * @property {string|null} failureMessage   set when status !== 'succeeded' — the exact text stored on the ledger row
 * @property {Object} raw               provider object, for logging/repair only. Business code never reads it.
 *
 * @typedef {Object} CustomerInput      { email, firstName, lastName, userId }
 * @typedef {Object} AttachedCard       { id, brand, last4, expMonth, expYear }  (brand lowercase as the provider reports it)
 * @typedef {Object} FoundPayment       { id, status (normalised), amount (dollars), raw } | null
 * @typedef {Object} WebhookEvent       { eventId, type: 'payment.succeeded'|'payment.failed'|'ignored', paymentId, providerStatus, providerEventType, raw }
 *
 * @typedef {Object} PaymentProvider
 * @property {string} name                                    'stripe' | 'square'
 * @property {{ savedPaymentMethods: true, webhooks: true, findByReference: boolean }} capabilities
 * @property {(req: ChargeRequest) => Promise<ChargeResult>} charge                 never throws for a card-level failure (D3a)
 * @property {(input: CustomerInput) => Promise<string>} createCustomer              returns the provider customer id
 * @property {(args: { customerId: string, token: string }) => Promise<AttachedCard>} attachPaymentMethod   throws httpError(402) for a card-level failure (D3b)
 * @property {(args: { paymentMethodId: string }) => Promise<void>} detachPaymentMethod
 * @property {(query: { paymentId?: string, reference?: string }) => Promise<FoundPayment>} findPayment   null when nothing found; reference lookup returns null when !capabilities.findByReference
 * @property {(args: { rawBody: Buffer, headers: Object }) => Promise<WebhookEvent>} verifyWebhook   throws httpError(400, `Webhook signature verification failed: ${reason}`) on a bad/missing signature
 */
```

`assertProviderContract(adapter)` throws `[payments] provider adapter is missing required member(s): a, b`
listing every missing member of: `name, capabilities, charge, createCustomer, attachPaymentMethod,
detachPaymentMethod, findPayment, verifyWebhook` (CKQ's function, shorter list).

### 4.2 Status normalisation (normative)

| Normalised | Stripe PaymentIntent.status | Square Payment.status |
|---|---|---|
| `succeeded` | `succeeded` | `COMPLETED` |
| `processing` | `processing` | `PENDING`, `APPROVED` |
| `requires_action` | `requires_action`, `requires_confirmation` | — |
| `failed` | `requires_payment_method`, `canceled`, anything else | `CANCELED`, `FAILED`, anything else |

`failureMessage` when `status !== 'succeeded'`: a card decline → the provider's own message
(Stripe `error.message`; Square `errors[0].detail || errors[0].code`); otherwise Stripe
`PaymentIntent status: ${raw}` (D11, byte-identical to today) and Square `Payment status: ${raw}`.

### 4.3 Data model after PR 2 (normative)

| Collection | Field | Type | Notes |
|---|---|---|---|
| `User` | `paymentProvider` | String enum `['stripe','square']`, not required | set with `providerCustomerId`, by `ensureCustomer` only |
| `User` | `providerCustomerId` | String, `unique: true, sparse: true` | was `stripeCustomerId` |
| `PaymentMethod` | `provider` | String enum, required | |
| `PaymentMethod` | `providerPaymentMethodId` | String, required | was `stripePaymentMethodId` |
| `Registration` (base schema) | `provider` | String enum, default `null` | `null` on a manual/$0 row that never touched a provider |
| `Registration` (base schema) | `providerPaymentId` | String, default `null` | was `stripePaymentIntentId` |
| `WebhookEvent` | `provider` | String enum, required | |
| `WebhookEvent` | `providerEventId` | String, required | was `stripeEventId`; unique **compound** index `{ provider: 1, providerEventId: 1 }` replaces the single-field unique |
| `WebhookEvent` | `providerPaymentId` | String | was `paymentIntentId` |

---

## 5. File-by-file spec, per PR

Branch names are binding (`/ship`-style tooling and §9 reports key on them). Base every branch on
`develop`. Each PR: implement §5.N, write §6.N tests, run §7.N, report (§9). Line numbers are
verified at `5391c8c`; if a file has moved on, re-locate by the quoted code, never by the number.

---

### PR 1 — `feature/payment-port-backend` — the port, the Stripe adapter, the guard, every call site migrated. Zero behaviour change.

#### 5.1.1 NEW `backend/src/payments/contract.js`
The §4.1 typedefs verbatim as JSDoc, followed by:
```js
function assertProviderContract(adapter) {
  const required = ['name', 'capabilities', 'charge', 'createCustomer', 'attachPaymentMethod', 'detachPaymentMethod', 'findPayment', 'verifyWebhook'];
  const missing = required.filter((k) => adapter == null || adapter[k] == null);
  if (missing.length > 0) {
    throw new Error(`[payments] provider adapter is missing required member(s): ${missing.join(', ')}`);
  }
}
module.exports = { assertProviderContract };
```
Header comment: "Payment provider port — the requirement list for any payment provider adapter.
Copied from CKQ (`backend-2.0/src/payments/contract.js`, ADR backend-021) and reduced to the
members this codebase actually calls (docs/plans/payment-provider-port-plan.md D2)."

#### 5.1.2 NEW `backend/src/payments/index.js`
CKQ's file verbatim except the provider map and the comment:
```js
const { assertProviderContract } = require('./contract');
const stripeProvider = require('./stripe/stripe.provider');

let cachedProvider = null;

// Business/service code never imports an adapter directly — it calls
// getPaymentProvider() and uses the port (./contract.js). Selected once per
// process by PAYMENT_PROVIDER (default 'stripe'); an unknown value throws on
// first use so a typo in Vercel env fails the first payment loudly, not silently.
function getPaymentProvider() {
  if (cachedProvider) return cachedProvider;
  const providerName = process.env.PAYMENT_PROVIDER || 'stripe';
  const providers = { stripe: stripeProvider };
  const provider = providers[providerName];
  if (!provider) throw new Error(`[payments] unknown PAYMENT_PROVIDER: "${providerName}"`);
  assertProviderContract(provider);
  cachedProvider = provider;
  return provider;
}

/** Test-only: clears the cached provider so tests can re-select via env changes. */
function _resetForTests() { cachedProvider = null; }

module.exports = { getPaymentProvider, _resetForTests };
```

#### 5.1.3 NEW `backend/src/payments/stripe/stripe.provider.js`
```js
const stripe = require('../../config/stripe');
const { httpError } = require('../../utils/errors');

// The Stripe adapter — implements src/payments/contract.js for Stripe. This is
// the ONLY file, besides src/config/stripe.js itself, allowed to require
// 'stripe' or config/stripe (tests/payments/providerBoundaryGuard.test.js).
// Payload below is byte-identical to the pre-port chargeLedgerRow call
// (chargeFinalization.service.js @ 5391c8c:71-82) — docs/plans/payment-
// provider-port-plan.md D11.

function normalizeStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'succeeded': return 'succeeded';
    case 'requires_action':
    case 'requires_confirmation': return 'requires_action';
    case 'processing': return 'processing';
    default: return 'failed'; // requires_payment_method, canceled, unknown
  }
}

function isCardError(error) {
  return error && error.type === 'StripeCardError';
}

async function charge({ amount, customerId, paymentMethodId, idempotencyKey, metadata }) {
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(amount * 100),
        currency: 'usd',
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        metadata,
      },
      { idempotencyKey }
    );
  } catch (error) {
    if (isCardError(error)) {
      return {
        id: error.payment_intent ? error.payment_intent.id : null,
        status: 'failed',
        failureMessage: error.message,
        raw: error,
      };
    }
    throw error;
  }

  const status = normalizeStatus(paymentIntent.status);
  return {
    id: paymentIntent.id,
    status,
    failureMessage: status === 'succeeded' ? null : `PaymentIntent status: ${paymentIntent.status}`,
    raw: paymentIntent,
  };
}

async function createCustomer({ email, firstName, lastName, userId }) {
  const customer = await stripe.customers.create({
    email,
    name: `${firstName} ${lastName}`,
    metadata: { userId },
  });
  return customer.id;
}

async function attachPaymentMethod({ customerId, token }) {
  let attached;
  try {
    attached = await stripe.paymentMethods.attach(token, { customer: customerId });
  } catch (error) {
    // Some test cards decline at attach() itself (paymentMethod.service.js's
    // pre-port comment, found via the live audit) — a 402, same as any decline.
    if (isCardError(error)) throw httpError(402, error.message);
    throw error;
  }
  return {
    id: attached.id,
    brand: attached.card.brand,
    last4: attached.card.last4,
    expMonth: attached.card.exp_month,
    expYear: attached.card.exp_year,
  };
}

async function detachPaymentMethod({ paymentMethodId }) {
  await stripe.paymentMethods.detach(paymentMethodId);
}

async function findPayment({ paymentId, reference } = {}) {
  let candidate = null;
  if (paymentId) {
    try {
      candidate = await stripe.paymentIntents.retrieve(paymentId);
    } catch (error) {
      if (error.type === 'StripeInvalidRequestError' && error.code === 'resource_missing') return null;
      throw error;
    }
  } else if (reference) {
    const result = await stripe.paymentIntents.search({ query: `metadata['registrationId']:'${reference}'` });
    const intents = result.data || [];
    candidate = intents.find((pi) => pi.status === 'succeeded') || null;
  }
  if (!candidate) return null;
  return { id: candidate.id, status: normalizeStatus(candidate.status), amount: candidate.amount / 100, raw: candidate };
}

const TYPE_MAP = { 'payment_intent.succeeded': 'payment.succeeded', 'payment_intent.payment_failed': 'payment.failed' };

async function verifyWebhook({ rawBody, headers }) {
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    throw httpError(400, `Webhook signature verification failed: ${error.message}`);
  }
  const obj = event.data && event.data.object ? event.data.object : {};
  return {
    eventId: event.id,
    type: TYPE_MAP[event.type] || 'ignored',
    paymentId: obj.id || null,
    providerStatus: obj.status || null,
    providerEventType: event.type,
    raw: event,
  };
}

module.exports = {
  name: 'stripe',
  capabilities: { savedPaymentMethods: true, webhooks: true, findByReference: true },
  charge, createCustomer, attachPaymentMethod, detachPaymentMethod, findPayment, verifyWebhook,
  _normalizeStatus: normalizeStatus,
};
```
Notes binding on the executor: (a) `findPayment({ reference })` returns ONLY a succeeded intent —
that is exactly what `recoverStalePending` does today (`searchResult.data.find(pi => pi.status === 'succeeded')`),
so semantics are unchanged; (b) the `metadata['registrationId']` query string is unchanged; (c)
`metadata` is passed through — callers keep building `{ registrationId, retry }` as today.

#### 5.1.4 `backend/src/services/billing/chargeFinalization.service.js`
- Line 3: replace `const stripe = require('../../config/stripe');` with
  `const { getPaymentProvider } = require('../../payments');`.
- Replace lines 52–104 (`chargeLedgerRow`) with:
```js
// Charges `row`'s LOCKED amount through the active payment provider, keyed on
// the row's own id (`payment_${row._id}`, or `payment_${row._id}_retry${n}`
// for a retry) so this is safe to call twice for the same row. Classifies
// the outcome and returns it — does NOT touch the Registration row, the
// Subscription, or send any email. A card-level decline is a resolved
// `status: 'failed'` from the port, never a throw (payment-provider-port-plan D3a).
async function chargeLedgerRow({ row, paymentMethod, providerCustomerId, attemptNumber = 1 }) {
  const idempotencyKey =
    attemptNumber > 1 ? `payment_${row._id}_retry${attemptNumber}` : `payment_${row._id}`;
  const metadata =
    attemptNumber > 1
      ? { registrationId: String(row._id), retry: String(attemptNumber) }
      : { registrationId: String(row._id) };

  const result = await getPaymentProvider().charge({
    amount: row.amount,
    customerId: providerCustomerId,
    paymentMethodId: paymentMethod.providerPaymentMethodId,
    idempotencyKey,
    reference: String(row._id),
    metadata,
  });

  if (result.status !== 'succeeded') {
    return { outcome: 'failed', failureMessage: result.failureMessage, paymentIntentId: result.id };
  }

  return { outcome: 'succeeded', paymentIntentId: result.id };
}
```
  **PR 1 only:** keep the parameter name `stripeCustomerId` and the field read
  `paymentMethod.stripePaymentMethodId` (the rename is PR 2); the snippet above shows the PR 2
  names — in PR 1 use `stripeCustomerId` / `paymentMethod.stripePaymentMethodId` and the return key
  `paymentIntentId` exactly as today. Nothing else in this file changes in PR 1.

#### 5.1.5 `backend/src/services/stripeCustomer.service.js` → `backend/src/services/paymentCustomer.service.js` (git mv)
```js
const User = require('../models/user.model');
const { getPaymentProvider } = require('../payments');

// Returns the active provider's customer id for `user`, creating one (and
// persisting it) the first time this parent ever needs one. Idempotent per
// user — a user who already has one never hits the provider. PR 2 adds the
// provider check (payment-provider-port-plan D7).
async function ensureCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;          // PR 2: user.paymentProvider === active.name && user.providerCustomerId
  const customerId = await getPaymentProvider().createCustomer({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    userId: user._id.toString(),
  });
  await User.findByIdAndUpdate(user._id, { stripeCustomerId: customerId }); // PR 2: { paymentProvider: active.name, providerCustomerId: customerId }
  return customerId;
}

module.exports = { ensureCustomer };
```
Update the four importers (`paymentMethod.service.js:3`, `privateClassEnrollment.service.js:8`,
`registration.service.js:14`, `renewal.service.js:10`): `const { ensureCustomer } = require('./paymentCustomer.service');`
and every `ensureStripeCustomer(` call → `ensureCustomer(` (sites: `paymentMethod.service.js:17`,
`privateClassEnrollment.service.js:163`, `registration.service.js:186`, `renewal.service.js:522,559,666,987`).

#### 5.1.6 `backend/src/services/paymentMethod.service.js`
```js
const PaymentMethod = require('../models/paymentMethod.model');
const { ensureCustomer } = require('./paymentCustomer.service');
const { getPaymentProvider } = require('../payments');

// Saves (or replaces) the requesting parent's single card on file. One saved
// card per parent for MVP — if they already have one, the old provider card
// is detached before the doc is updated in place, so nothing orphaned is
// left attached to the provider customer. A decline at attach time surfaces
// as the port's own 402 (payment-provider-port-plan D3b).
async function savePaymentMethod({ stripePaymentMethodId }, requestingUser) {   // PR 2: { paymentMethodToken }
  const customerId = await ensureCustomer(requestingUser);
  const attached = await getPaymentProvider().attachPaymentMethod({ customerId, token: stripePaymentMethodId });

  const cardDetails = {
    stripePaymentMethodId: attached.id,       // PR 2: providerPaymentMethodId, plus provider: getPaymentProvider().name
    cardBrand: attached.brand,
    cardLast4: attached.last4,
    cardExpMonth: attached.expMonth,
    cardExpYear: attached.expYear,
  };

  const existing = await PaymentMethod.findOne({ parentId: requestingUser._id });
  if (existing) {
    if (existing.stripePaymentMethodId !== attached.id) {
      await getPaymentProvider().detachPaymentMethod({ paymentMethodId: existing.stripePaymentMethodId });
    }
    existing.set(cardDetails);
    await existing.save();
    return existing;
  }
  return PaymentMethod.create({ parentId: requestingUser._id, ...cardDetails });
}

async function getMine(parentId) {
  return PaymentMethod.findOne({ parentId });
}

module.exports = { savePaymentMethod, getMine };
```
`paymentFailedError` and the `StripeCardError` catch are deleted — the adapter owns them.

#### 5.1.7 `backend/src/services/renewal.service.js`
- Line 8: delete `const stripe = require('../config/stripe');`. Add
  `const { getPaymentProvider } = require('../payments');`.
- Replace lines 238–242 (the `stripe.paymentIntents.search` block and `succeededPI`) with:
```js
  const found = await getPaymentProvider().findPayment({ reference: String(row._id) });
  const succeededPI = found && found.status === 'succeeded' ? found : null;
```
  and `paymentIntentId: succeededPI.id` stays as written at line 248. (PR 4 extends this per D4.)
- No other logic changes. The `stripeCustomerId` parameter names are renamed in PR 2.

#### 5.1.8 Webhook: `stripeWebhook.controller.js` → `webhooks.controller.js`; `stripeWebhook.routes.js` → `webhooks.routes.js` (git mv both)
`controllers/webhooks.controller.js`:
```js
const WebhookEvent = require('../models/webhookEvent.model');
const { getPaymentProvider } = require('../payments');
const { notFoundError } = require('../utils/errors');

// Handles the active payment provider's webhook deliveries. Requires the raw
// (unparsed) body — see app.js, where this router is mounted with its own
// express.raw() ahead of the global express.json(). Only the ACTIVE
// provider's URL is live: a delivery for any other :provider is a 404, so a
// stale dashboard registration can never write anything here
// (payment-provider-port-plan D5). Records only payment succeeded/failed
// events, deduped by the provider's own event id.
async function handle(req, res, next) {
  const provider = getPaymentProvider();
  if (req.params.provider !== provider.name) {
    return next(notFoundError('Unknown payment provider webhook'));
  }

  let event;
  try {
    event = await provider.verifyWebhook({ rawBody: req.body, headers: req.headers });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    const existing = await WebhookEvent.findOne({ stripeEventId: event.eventId });   // PR 2: { provider: provider.name, providerEventId: event.eventId }
    if (existing) return res.status(200).json({ received: true });

    if (event.type !== 'ignored') {
      await WebhookEvent.create({
        stripeEventId: event.eventId,          // PR 2: provider, providerEventId
        type: event.providerEventType,
        paymentIntentId: event.paymentId,      // PR 2: providerPaymentId
        status: event.providerStatus,
      });
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to process webhook event' });
  }
}

module.exports = { handle };
```
The 400 body text is unchanged for Stripe (`Webhook signature verification failed: <sdk message>`),
because the adapter builds that exact string. `routes/webhooks.routes.js`: `router.post('/:provider', handle);`
with the existing "no requireAuth — the provider authenticates via signature" comment.

`app.js`: line 20 → `const webhookRoutes = require('./routes/webhooks.routes');`; lines 39–51 →
```js
// Mounted BEFORE the global express.json() below, with its own express.raw()
// middleware, so the webhook sees the exact raw request bytes — every payment
// provider's signature check (Stripe's constructEvent, Square's
// WebhooksHelper.verifySignature) requires the unparsed body. Express
// matches in registration order, so this path "wins" ahead of the JSON parser.
app.use('/api/v1/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);
```
The Stripe dashboard URL `/api/v1/webhooks/stripe` resolves unchanged.

#### 5.1.9 `backend/scripts/audit-reset.js`
Line 41 `const stripe = require('../src/config/stripe');` → `const { getPaymentProvider } = require('../src/payments');`;
line 130 → `await getPaymentProvider().detachPaymentMethod({ paymentMethodId: paymentMethod.stripePaymentMethodId });`
(PR 2: `providerPaymentMethodId`). Warning text `(Stripe detach …` → `(Provider detach …`.

#### 5.1.10 NEW `backend/tests/payments/providerBoundaryGuard.test.js`
CKQ's guard, adapted: `SRC = backend/src`, `SCRIPTS = backend/scripts`; walk both (skip
`node_modules`); `ADAPTER_FILES = [src/payments/stripe/stripe.provider.js]` (PR 4 adds the Square
adapter), `SDK_BOOTSTRAP_FILES = [src/config/stripe.js]` (PR 4 adds `config/square.js`);
`ALLOWLIST = []` and a test asserting it is empty; regexes `require\(\s*['"]stripe['"]\s*\)`,
`require\([^)]*config\/stripe['"]?\)`, and `\.type\s*===\s*['"]Stripe` (the error sniff). Four `it`s:
no offender for SDK imports; no offender for error sniffs; allowlist is `[]`; the guard scanned > 50
files (fails loudly on a bad root path). Also walks `backend/tests/` **excluding**
`tests/payments/**` and `tests/testUtils/payments.js` — route/service tests must reach the provider
only through those helpers (D9).

#### 5.1.11 Tests moved/adapted in PR 1 (no assertion changes)
- `tests/testUtils/stripe.js` → `tests/testUtils/payments.js`: same three exports plus
  `mintTestPaymentMethodToken(kind)` (`'success'` → `tok_visa`, `'declineAtAttach'` → `tok_chargeDeclined`,
  `'declineAtCharge'` → Stripe's shared `pm_card_chargeDeclined`) lifted out of
  `paymentMethod.routes.test.js:55-89` and the equivalent helpers in `registration.routes.test.js` /
  `privateClassEnrollment.routes.test.js` / `renewal.service.test.js` / `renewal.previewAndCharge.test.js` /
  `chargeFinalization.service.test.js` / `testUtils/privateLessons.js` (grep each for
  `stripe.paymentMethods.create` and `pm_card_`). This file is the ONLY test file allowed to
  `require('../../src/config/stripe')` (guard, §5.1.10). In PR 1 it stays Stripe-only internally;
  PR 4 branches on the active provider.
- `tests/routes/stripeWebhook.routes.test.js` → `tests/routes/webhooks.routes.test.js`: same 6 cases
  against `/api/v1/webhooks/stripe` (signing helper now imports the SDK via
  `tests/testUtils/payments.js`'s new `signStripeWebhook(payload)` export), **plus** one new case:
  `POST /api/v1/webhooks/square` with any body → 404 while `PAYMENT_PROVIDER` is stripe.
- Every other test file keeps its assertions; only import paths change.

---

### PR 2 — `feature/payment-provider-fields` — provider-neutral field names + migration (D6)

#### 5.2.1 Models
- `user.model.js:75` `stripeCustomerId` → `providerCustomerId` (keep `unique: true, sparse: true`), add
  `paymentProvider: { type: String, enum: ['stripe', 'square'] }` directly above it; comment at :71 and :83 updated.
- `paymentMethod.model.js:17` → `providerPaymentMethodId` (required); add `provider: { type: String, enum: ['stripe','square'], required: true }`.
- `registration.model.js:65` → `providerPaymentId: { type: String, default: null }`; add
  `provider: { type: String, enum: ['stripe','square', null], default: null }`; comment at :34 updated.
- `webhookEvent.model.js`: `stripeEventId` → `providerEventId` (drop its `unique`), add
  `provider` (required enum), `paymentIntentId` → `providerPaymentId`; add
  `webhookEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });`.

#### 5.2.2 Every reader/writer (complete list — verified by grep at `5391c8c`)
| File | Lines | Change |
|---|---|---|
| `services/billing/chargeFinalization.service.js` | 57, 75, 76, 119, 140, 172, 173 | param `stripeCustomerId` → `providerCustomerId`; `paymentMethod.providerPaymentMethodId`; `$set` writes `providerPaymentId` **and** `provider: getPaymentProvider().name`; return key `paymentIntentId` → `paymentId` (update the 4 readers below) |
| `services/paymentCustomer.service.js` | all | D7 logic: `const active = getPaymentProvider(); if (user.paymentProvider === active.name && user.providerCustomerId) return user.providerCustomerId;` … `findByIdAndUpdate(user._id, { paymentProvider: active.name, providerCustomerId: customerId })` |
| `services/paymentMethod.service.js` | 16, 43, 53, 54 | body `{ paymentMethodToken }`; `provider: active.name`; detach only when `existing.provider === active.name && existing.providerPaymentMethodId !== attached.id`; `getMine`: `const doc = await PaymentMethod.findOne({ parentId }); return doc && doc.provider === getPaymentProvider().name ? doc : null;` |
| `services/privateClassEnrollment.service.js` | 163, 210, 219, 234 | `providerCustomerId`; `charge.paymentId`; `providerPaymentId` + `provider` in both `$set`s |
| `services/registration.service.js` | 186, 301, 315 | `providerCustomerId`; comment |
| `services/renewal.service.js` | 202, 212, 237, 263, 522, 531, 559, 604, 666, 706, 987, 995 | `providerCustomerId` |
| `controllers/webhooks.controller.js` | per §5.1.8 "PR 2" markers | |
| `controllers/paymentMethod.controller.js` | — | none (passes `req.body` through) |
| `scripts/audit-reset.js` | 130 | `providerPaymentMethodId` |
| `scripts/lib/scrubStripeFields.js` → `scrubProviderFields.js` (git mv) | 26, 29–30, 35, 37 | `providerCustomerId`/`paymentProvider` `$unset`; `providerPaymentId`/`provider` reset; result keys `providerCustomerIdsCleared`, `providerPaymentIdsCleared`; `refresh-staging-data.js:158-161` + `scripts/lib/refreshStagingData.js:14,44,59` renamed to match |
| `scripts/lib/migrateRegistrationsToLedger.js:126`, `scripts/lib/migrateToUnifiedLedger.js:104` | | `providerPaymentId: null` / `providerPaymentId: charge.providerPaymentId ?? null` (these one-time scripts are kept runnable against an old dump — add `provider: charge.providerPaymentId ? 'stripe' : null`) |
| `services/mail.service.js:426` | comment | "what the provider charged" |
| `frontend/lib/types.ts:287` | | `providerPaymentId: string \| null;` |
| `frontend/lib/services/parent.ts:123-129` | | `savePaymentMethod(paymentMethodToken: string)`, body `{ paymentMethodToken }` |
| `frontend/app/components/portal/PaymentMethodCardForm.tsx:60` | | `paymentMethodToken: result.paymentMethod.id` |
| `DATABASE_SCHEMA_DOCUMENTATION.md` | `User`, `PaymentMethod` (:70), `Registration` (:97), `WebhookEvent` (:170) | §4.3 table |

Tests (18 files, from `grep -rlE "stripeCustomerId|stripePaymentMethodId|stripePaymentIntentId|stripeEventId"`
over `backend/tests` and `frontend/app`): mechanical rename of field names and request-body key; a
test that seeds a `PaymentMethod`/`WebhookEvent` directly must now also set `provider: 'stripe'`;
`expectLedgerChargeSucceeded` reads `ledgerRow.providerPaymentId`. No assertion semantics change.

#### 5.2.3 NEW `backend/scripts/migrate-provider-fields.js` + `backend/scripts/lib/migrateProviderFields.js`
House pattern = `scripts/migrate-period-month.js` + `scripts/lib/migratePeriodMonth.js` (dry-run
default, `--live` to apply, connects via `MONGO_URI`, prints a report, exit 1 on abort). The lib
function `migrateProviderFields({ apply })` does, in order, on the raw collections
(`mongoose.connection.db.collection(...)`, not the models — the models no longer know the old names):
1. `users`: `updateMany({ stripeCustomerId: { $exists: true } }, { $rename: { stripeCustomerId: 'providerCustomerId' }, $set: { paymentProvider: 'stripe' } })`.
2. `paymentmethods`: `$rename stripePaymentMethodId → providerPaymentMethodId`, `$set provider: 'stripe'` (filter `{ stripePaymentMethodId: { $exists: true } }`).
3. `registrations`: `updateMany({ stripePaymentIntentId: { $exists: true } }, { $rename: { stripePaymentIntentId: 'providerPaymentId' } })`, then `updateMany({ providerPaymentId: { $ne: null } }, { $set: { provider: 'stripe' } })`, then `updateMany({ provider: { $exists: false } }, { $set: { provider: null } })`.
4. `webhookevents`: `$rename stripeEventId → providerEventId, paymentIntentId → providerPaymentId`, `$set provider: 'stripe'`.
5. Indexes: drop `users.stripeCustomerId_1` and `webhookevents.stripeEventId_1` if present (`listIndexes` first; never throw on absence). Mongoose `autoIndex` builds the new ones on next boot; the script also calls `User.syncIndexes()` and `WebhookEvent.syncIndexes()` in `--live` mode so the new unique indexes exist before any request lands.
6. Report: per collection `matched`/`modified`, indexes dropped, and a final **verification scan** counting documents that still have any old field name (must be 0 in `--live`; non-zero → exit 1).
Idempotent: a second `--live` run reports 0 modified everywhere and exits 0.
Test `tests/scripts/lib/migrateProviderFields.test.js`: seed old-shape docs via raw collection
inserts (one of each, plus one registration with `stripePaymentIntentId: null` and one with none);
dry run writes nothing; live run renames, stamps, drops the old index, verification = 0; second
live run is a no-op; the models can then `find()` the migrated docs by the new names.

#### 5.2.4 Rollout step for PR 2 (owner, before deploying the PR to an environment)
`node scripts/migrate-provider-fields.js` (dry) then `--live` against **staging**, deploy PR 2 to
staging, run the staging smoke in §8; repeat on production before the `develop → main` promotion.
`backend/.env.production.local` holds the production URI per `CLAUDE.md`.

---

### PR 3 — `feature/payment-frontend-boundary` — one frontend folder knows the provider; config from the backend (D10)

#### 5.3.1 Backend: `GET /api/v1/payments/config` (public, no auth)
NEW `routes/payments.routes.js` (`router.get('/config', getConfig)`), NEW `controllers/payments.controller.js`
(`next(error)` pattern), NEW `services/paymentsConfig.service.js`:
```js
const { getPaymentProvider } = require('../payments');
const { httpError } = require('../utils/errors');

// What the browser needs to tokenise a card with the ACTIVE provider — and
// nothing else. Publishable/application ids only, never a secret. Fails
// closed: a provider selected without its public config is a 500 on this
// read, so the card form never silently renders against the wrong account.
function getPublicConfig() {
  const provider = getPaymentProvider();
  if (provider.name === 'stripe') {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) throw httpError(500, 'STRIPE_PUBLISHABLE_KEY is not configured');
    return { provider: 'stripe', stripe: { publishableKey } };
  }
  if (provider.name === 'square') {
    const { SQUARE_APPLICATION_ID: applicationId, SQUARE_LOCATION_ID: locationId, SQUARE_ENVIRONMENT: environment } = process.env;
    if (!applicationId || !locationId || !environment) throw httpError(500, 'Square public config is incomplete');
    return { provider: 'square', square: { applicationId, locationId, environment } };
  }
  throw httpError(500, `No public config for provider ${provider.name}`);
}
module.exports = { getPublicConfig };
```
Mount in `app.js` after `/api/v1/payment-methods`: `app.use('/api/v1/payments', paymentsRoutes);`.
`.env.example`: add `STRIPE_PUBLISHABLE_KEY=` under `STRIPE_SECRET_KEY` with a comment.

#### 5.3.2 Frontend folder `frontend/app/components/payment/`
- `usePaymentConfig.ts`: `fetchPaymentConfig(): Promise<PaymentConfig>` in `lib/services/payments.ts`
  (query — throws on failure, per the error contract) + hook via `useLoadState`.
  `lib/types.ts` gains `export type PaymentConfig = { provider: 'stripe'; stripe: { publishableKey: string } } | { provider: 'square'; square: { applicationId: string; locationId: string; environment: 'sandbox' | 'production' } };`
- `stripe/StripeCardForm.tsx`: today's `PaymentMethodCardForm.tsx` moved (git mv), with `<Elements stripe={loadStripe(publishableKey)}>` **inside** it (one `loadStripe` promise memoised per key in a module-level `Map`), props `{ publishableKey, onSaved, submitLabel }`, POST body `{ paymentMethodToken }`. Visuals unchanged.
- `PaymentMethodCollector.tsx`: props `{ onSaved: (pm: PaymentMethodInfo) => void; submitLabel?: string }`; renders a loading `Card` while config loads, `<LoadError>` with retry on failure, `StripeCardForm` for `provider === 'stripe'`, and (PR 5) `SquareCardForm`. Until PR 5, `provider === 'square'` renders `<Alert variant="error">Card entry is not available yet for this payment provider.</Alert>` so a premature cutover is visible, never a blank.
- Delete `frontend/lib/stripe.ts`. `app/parent/payment-method/page.tsx` (:4, :7, :91–93) and
  `app/parent/register/page.tsx` (:6, :29, :648–650): remove `Elements`/`stripePromise` imports, render `<PaymentMethodCollector onSaved={…} submitLabel="Add Card" />`.
- `frontend/playwright.config.ts:49`: delete the `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` env line and its comment (the build no longer needs it); `e2e/fixtures/mock-api.ts` `DEFAULT_RULES`: add
  `{ method: 'GET', path: '/payments/config', handler: (route) => json(route, 200, { provider: 'stripe', stripe: { publishableKey: 'pk_test_TYooMQauvdEDq54NiTphI7jx' } }) }`.
- Vercel: remove `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from the frontend project; add `STRIPE_PUBLISHABLE_KEY` to the backend project (owner step, §8).

#### 5.3.3 NEW `frontend/lib/__tests__/paymentSdkBoundaryGuard.test.ts`
Walks `frontend/app` and `frontend/lib` (skipping `__tests__`, `node_modules`, `.next`). Fails if
any file outside `app/components/payment/**` contains `from '@stripe/`, `require('@stripe/`,
`squarecdn.com`, or `window.Square`. Asserts > 100 files scanned. Second test: the folder itself
contains at least one such import (the guard is proven to be looking at the right thing).

---

### PR 4 — `feature/payment-square-backend` — the Square adapter, webhook, shared contract suite, sandbox CI job

#### 5.4.1 `backend/package.json`: `"square": "^46.0.0"` (dependency). `npm install` then `npm ci` must be clean.
#### 5.4.2 NEW `backend/src/config/square.js`
```js
const { SquareClient, SquareEnvironment } = require('square');
// Same placeholder-token reasoning as config/stripe.js: constructing the client
// makes no network call, so a process without Square env (every non-payment
// test, every Stripe-configured deployment) still boots.
const environment = process.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox;
module.exports = new SquareClient({ token: process.env.SQUARE_ACCESS_TOKEN || 'sandbox-placeholder-missing-square-token', environment });
```
#### 5.4.3 NEW `backend/src/payments/square/square.provider.js`
Implements §4.1 with D8's calls. Binding details:
- `charge`: `idempotencyKey` passed through (assert `.length <= 45`, throw a plain Error otherwise — our keys are ≤ 39 chars; this catches a future key-format change); `sourceId: paymentMethodId`; `customerId`; `amountMoney: { amount: BigInt(Math.round(amount * 100)), currency: 'USD' }`; `locationId: process.env.SQUARE_LOCATION_ID`; `referenceId: reference` (assert ≤ 40); `note: Object.entries(metadata).map(([k,v]) => `${k}=${v}`).join(' ').slice(0, 500)`. Status per §4.2. A `SquareError` whose `body.errors` (or `errors`) contains `category === 'PAYMENT_METHOD_ERROR'` → `{ id: null, status: 'failed', failureMessage: detail || code, raw: error }`; a resolved payment with `status ∈ FAILED|CANCELED` → `failureMessage: `Payment status: ${status}``. **The sandbox contract test (§6.4) pins which of the two shapes `cnon:card-nonce-declined` actually produces; the adapter must handle both, and the executor records the observed shape in the adapter's docblock.**
- `createCustomer`: `customers.create({ idempotencyKey: `customer_${userId}`, givenName: firstName, familyName: lastName, emailAddress: email, referenceId: userId })` → `customer.id`.
- `attachPaymentMethod`: `cards.create({ idempotencyKey: crypto.randomUUID(), sourceId: token, card: { customerId } })` → `{ id: card.id, brand: String(card.cardBrand).toLowerCase(), last4: card.last4, expMonth: Number(card.expMonth), expYear: Number(card.expYear) }`; `PAYMENT_METHOD_ERROR` → `httpError(402, detail || code)`.
- `detachPaymentMethod`: `cards.disable({ cardId: paymentMethodId })`.
- `findPayment`: `paymentId` → `payments.get({ paymentId })` → normalised; a `SquareError` with `statusCode === 404` → `null`; `reference` only → `null` (`capabilities.findByReference: false`).
- `verifyWebhook`: `WebhooksHelper.verifySignature({ requestBody: rawBody.toString('utf8'), signatureHeader: headers['x-square-hmacsha256-signature'], signatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY, notificationUrl: process.env.SQUARE_WEBHOOK_NOTIFICATION_URL })`; `false`/missing header → `httpError(400, 'Webhook signature verification failed: invalid signature')`; then `JSON.parse(rawBody)`; `payment = event.data?.object?.payment`; type: `payment.updated`/`payment.created` with `payment.status === 'COMPLETED'` → `'payment.succeeded'`, `FAILED`/`CANCELED` → `'payment.failed'`, else `'ignored'`; `eventId: event.event_id`, `providerEventType: event.type`, `paymentId: payment?.id ?? null`, `providerStatus: payment?.status ?? null`.
- `capabilities: { savedPaymentMethods: true, webhooks: true, findByReference: false }`, `name: 'square'`.
`payments/index.js`: `providers = { stripe: stripeProvider, square: squareProvider }`. Guard: add the
Square adapter and `config/square.js` to the allowed files, add `require\(\s*['"]square['"]\s*\)` and
`config\/square` to the banned patterns, and `\.category\s*===\s*['"]PAYMENT_METHOD_ERROR` to the sniff ban.

#### 5.4.4 D4 in `chargeFinalization.service.js` and `renewal.service.js`
- `chargeLedgerRow`: immediately after `charge()` resolves, if `result.id` →
  `await Registration.updateOne({ _id: row._id }, { $set: { providerPaymentId: result.id, provider: getPaymentProvider().name } })`
  (import the base `Registration` model). Update the function comment: it now records the provider
  payment id on the row (and only that) so recovery can find the payment by id even when the
  provider cannot search by reference. Finalisation still `$set`s the same values (idempotent).
- `recoverStalePending`: replace the two lines from §5.1.7 with
```js
  const provider = getPaymentProvider();
  let found = null;
  if (row.providerPaymentId) {
    found = await provider.findPayment({ paymentId: row.providerPaymentId });
  } else if (provider.capabilities.findByReference) {
    found = await provider.findPayment({ reference: String(row._id) });
  }
  const succeededPI = found && found.status === 'succeeded' ? found : null;
```
  The fall-through (`chargeAndEmail` under the same idempotency key) is unchanged and is the
  Square path when no id was recorded.

#### 5.4.5 Env + docs + CI
- `.env.example`: block `PAYMENT_PROVIDER=stripe` (comment: `stripe | square — exactly one is active; switching is docs/plans/payment-provider-port-plan.md §11`), `SQUARE_ACCESS_TOKEN=`, `SQUARE_ENVIRONMENT=sandbox`, `SQUARE_LOCATION_ID=`, `SQUARE_APPLICATION_ID=`, `SQUARE_WEBHOOK_SIGNATURE_KEY=`, `SQUARE_WEBHOOK_NOTIFICATION_URL=` (comment: the exact URL registered in the Square Developer Console, e.g. `https://friscofencing-backend.vercel.app/api/v1/webhooks/square` — the signature covers it).
- `.github/workflows/ci.yml`: `backend-tests` gains `SQUARE_SANDBOX_ACCESS_TOKEN`/`SQUARE_SANDBOX_LOCATION_ID` secrets (as `SQUARE_ACCESS_TOKEN`/`SQUARE_LOCATION_ID` env, `SQUARE_ENVIRONMENT: sandbox`) so `square.provider.test.js` runs; NEW job `backend-tests-square` = same setup, `PAYMENT_PROVIDER: square`, command `npx jest tests/payments tests/routes/paymentMethod.routes.test.js tests/routes/webhooks.routes.test.js tests/services/billing/chargeFinalization.service.test.js tests/routes/registration.routes.test.js tests/routes/privateClassEnrollment.routes.test.js tests/services/renewal.service.test.js tests/services/renewal.previewAndCharge.test.js`. Owner adds the two secrets with `gh secret set` (§8).
- `tests/testUtils/payments.js` branches on `getPaymentProvider().name`: Square `mintTestPaymentMethodToken('success')` → `'cnon:card-nonce-ok'`, `'declineAtAttach'` → `'cnon:card-nonce-declined'`, `'declineAtCharge'` → `'ccof:customer-card-id-declined'` (**verify in the contract test that this id charges-declines after a successful attach; if it declines at attach instead, STOP and report — the route tests that exercise a charge-time decline depend on the distinction**); `expectLedgerChargeSucceeded` → `payments.get`, assert `status === 'COMPLETED'`, `amountMoney.amount === BigInt(cents)`, `customerId`; `listCustomerPayments(userId)` → `payments.list({ beginTime: SUITE_START_ISO, limit: 100 })` auto-paged, filtered by `customerId` (Square cannot filter by customer server-side — D4). `signStripeWebhook` stays; add `signSquareWebhook(payload)` computing the header with Node `crypto` the way the SDK's `WebhooksHelper` does — **read `node_modules/square/**/WebhooksHelper*` first and copy its algorithm**; the contract test proves the SDK accepts it.

---

### PR 5 — `feature/payment-square-frontend` — Square card entry + E2E for the card page under both providers

#### 5.5.1 `frontend/app/components/payment/square/loadSquareSdk.ts`
`loadSquareSdk(environment): Promise<SquareSdk>` — returns `window.Square` if present (tests and the
E2E stub rely on this short-circuit); else injects `<script src="https://sandbox.web.squarecdn.com/v1/square.js">`
(or `https://web.squarecdn.com/v1/square.js` for production), memoised promise, rejects on
`onerror`. Types in `square/squareTypes.ts` for exactly what we call:
`payments(appId, locationId) → { card(): Promise<Card> }`, `Card { attach(selector: string): Promise<void>; tokenize(): Promise<{ status: string; token?: string; errors?: { message: string }[] }>; destroy(): Promise<void> }`.
#### 5.5.2 `frontend/app/components/payment/square/SquareCardForm.tsx`
Props `{ applicationId, locationId, environment, onSaved, submitLabel }`. On mount: load SDK,
`payments.card()`, `attach('#square-card-container')`; on unmount `destroy()`. Submit:
`tokenize()`; `status !== 'OK'` → inline `<Alert variant="error">` with `errors[0]?.message ?? 'Failed to process card. Please try again.'`; else `savePaymentMethod(token)` → `onSaved`. Same `Card`/`Button`/`Alert`/`styles.formField` as the Stripe form; the container div uses the same inline border/radius/background as `StripeCardForm`'s `CardElement` wrapper. `Button` disabled until the card is attached and while submitting.
#### 5.5.3 `PaymentMethodCollector.tsx`: render `SquareCardForm` for `provider === 'square'`; delete the PR 3 placeholder alert.
#### 5.5.4 E2E NEW `frontend/e2e/payment-method.spec.ts`
Both providers, mocked at the network boundary AND the third-party script boundary (CKQ rule:
block third-party scripts, never race them):
- Stripe: `page.route('https://js.stripe.com/**', route => route.fulfill({ contentType: 'application/javascript', body: STRIPE_STUB }))` where `STRIPE_STUB` defines `window.Stripe = (key) => ({ elements: () => ({ create: () => element, getElement: () => element }), createPaymentMethod: async () => ({ paymentMethod: { id: 'pm_e2e_123' } }) })` and `element = { mount(){}, unmount(){}, destroy(){}, on(){}, off(){}, update(){} }` (the members `@stripe/react-stripe-js`'s `CardElement` calls). Override `GET /payments/config` → stripe.
- Square: `page.route('https://sandbox.web.squarecdn.com/**', …)` fulfilling a stub that sets `window.Square = { payments: () => ({ card: async () => ({ attach: async () => {}, tokenize: async () => ({ status: 'OK', token: 'cnon:e2e' }), destroy: async () => {} }) }) }`; config → `{ provider: 'square', square: { applicationId: 'sq0idp-e2e', locationId: 'L-e2e', environment: 'sandbox' } }`.
- Cases (each provider): `/parent/payment-method` with no card → form renders → submit → `POST /payment-methods` body is exactly `{ paymentMethodToken: '<stub token>' }` (assert the request JSON) → "Card on file: … ending in …" renders from the mocked response; a 402 from the mock → inline error text, form still usable; the register wizard's inline "Add Card" step (reuse `parent-register.spec.ts`'s flow helper) saves and unblocks "Register & Pay". Clock pinned where the wizard needs it (copy `parent-register.spec.ts`'s `page.clock` setup).
`parent-register.spec.ts:65/93` ("card on file") stay green with the `FIXTURE_PAYMENT_METHOD` default.

---

### PR 6 — `feature/payment-port-docs-and-cutover` — ADR, module doc, runbook, env tables. Docs + one script only.
- NEW `docs/decisions/013-payment-provider-port.md` (written with this plan; the executor only
  flips its status line to Implemented and adds the PR numbers).
- NEW `docs/modules/payments.md`: port contract (§4.1–4.3), adapter table, boundary guards, test
  policy (D9), the switch runbook (§11), the honest edges.
- NEW `backend/scripts/list-saved-cards-by-provider.js` (read-only, dry by nature): prints
  `PaymentMethod` counts by `provider`, and for the non-active provider the parent name/email of
  every active `Subscription`'s parent whose card is on that provider — the list the owner emails
  before a cutover.
- `CLAUDE.md` Tech Stack row "Payments" → "Payment provider port (`backend/src/payments/`, ADR 013) — Stripe adapter today, Square adapter built; exactly one active via `PAYMENT_PROVIDER`; in-house subscription model (ADR 001)". Pre-read table: add "Touch `src/payments/`, a provider adapter, `components/payment/`, or any `provider*` field → `docs/modules/payments.md` + ADR 013". Documentation Map row for this plan.
- `docs/decisions/001-in-house-subscription-billing.md`: addendum pointing at ADR 013.
- `docs/TESTING_STRATEGY.md`: "Real Stripe in tests" section → "Real provider test modes in tests" (Stripe TEST + Square sandbox), `tests/testUtils/payments.js`, the shared contract suite, the two guards, the `backend-tests-square` job. `docs/TEST_COVERAGE.md`: re-measured counts.
- `docs/features/parent-portal.md:85-87,119`: `PaymentMethodCollector`, `components/payment/`.
- `docs/plans/deployment-launch-plan.md` §4a/§4b tables: `PAYMENT_PROVIDER`, `STRIPE_PUBLISHABLE_KEY` (backend), the six `SQUARE_*` vars, remove `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`; note `NODEJS_HELPERS=0` now protects both webhook URLs.
- `DATABASE_SCHEMA_DOCUMENTATION.md`: already updated in PR 2; verify.
- `.github/workflows/ci.yml` header comment: the secrets list.

---

## 6. Test spec (per `docs/TESTING_STRATEGY.md`; every changed source file has a name-matched test)

### 6.1 PR 1
| Changed file | Test file | Layer | Mocking | Cases |
|---|---|---|---|---|
| `payments/contract.js` | `tests/payments/contract.test.js` | unit | fake adapter object (`tests/testUtils/fakePaymentProvider.js`, CKQ's `makeFakePaymentProvider` reduced to D2's members) | passes for a full adapter; names each missing member; lists all when given `{}`; `null`/`undefined` → "missing" not TypeError |
| `payments/index.js` | `tests/payments/index.test.js` | unit | `jest.doMock` of the adapter module, `process.env` save/restore (CKQ's file — note its `delete process.env.X` lesson) | default stripe; explicit stripe; unknown value throws `/unknown PAYMENT_PROVIDER/`; singleton caching; `_resetForTests`; broken adapter rejected |
| `payments/stripe/stripe.provider.js` | `tests/payments/stripe.provider.test.js` | **real Stripe TEST mode** via the shared suite | none | runs `describeProviderContract(() => require('../../src/payments/stripe/stripe.provider'), stripeFixtures)` (§6.4) plus Stripe-only: `_normalizeStatus` table (`it.each` of §4.2), a `requires_payment_method` raw status → `failureMessage === 'PaymentIntent status: requires_payment_method'` (D11, pure function test on the mapping helper — extract the message builder so it is testable without a network call) |
| guard | `tests/payments/providerBoundaryGuard.test.js` | static | — | §5.1.10 |
| `chargeFinalization.service.js`, `paymentMethod.service.js`, `paymentCustomer.service.js`, `renewal.service.js`, `registration.service.js`, `privateClassEnrollment.service.js` | existing suites, unchanged assertions | service / route, real Stripe | `tests/testUtils/payments.js` | the full existing matrix must pass with **zero** assertion edits; `paymentCustomer.service.js` gets `tests/services/paymentCustomer.service.test.js` (renamed from any existing `stripeCustomer` coverage; if none exists: 3 cases — creates once, reuses stored id, persists on the user) |
| `webhooks.controller.js`, `webhooks.routes.js`, `app.js` | `tests/routes/webhooks.routes.test.js` | route | local HMAC via `signStripeWebhook` | 6 existing cases + 404 for `/webhooks/square` |
| `scripts/audit-reset.js` | `None — operational script, untested by house convention (TEST_COVERAGE.md gaps note)`; its lib-less structure is unchanged | | | |

### 6.2 PR 2
| Changed file | Test file | Cases |
|---|---|---|
| 4 models | `tests/models/registration.model.test.js` (+ `provider` default null, `providerPaymentId` default null), NEW `tests/models/webhookEvent.model.test.js` (compound unique index proven by a real E11000 on the second insert of the same `{provider, providerEventId}`, and the same `providerEventId` under a different `provider` inserts fine), `tests/models/paymentMethod.model.test.js` (NEW: `provider` required) | |
| `paymentCustomer.service.js` D7 | `tests/services/paymentCustomer.service.test.js` | a user with `paymentProvider: 'square'` + an id gets a NEW stripe customer when stripe is active, and both fields are overwritten |
| `paymentMethod.service.js` D7 | `tests/routes/paymentMethod.routes.test.js` | `GET /mine` returns `null` for a seeded doc with `provider: 'square'` while stripe is active; `POST` over such a doc replaces it in place and makes **zero** detach calls (assert via `listCustomerPaymentIntents` unchanged / no thrown error — Stripe cannot detach a Square id, so a wrongly-made call would throw) |
| migration | `tests/scripts/lib/migrateProviderFields.test.js` | §5.2.3 |
| every renamed site | existing suites | mechanical rename, same assertions |

### 6.3 PR 3
| Changed file | Test file | Layer | Mocking | Cases |
|---|---|---|---|---|
| `paymentsConfig.service.js`, `payments.routes.js`, `payments.controller.js` | `tests/routes/payments.routes.test.js` | route | env save/restore | stripe → `{ provider, stripe: { publishableKey } }` and no `secret` key anywhere in the body; missing publishable key → 500 `Something went wrong`; `PAYMENT_PROVIDER=square` (after `_resetForTests`) with all three vars → square body; one missing → 500; no auth required (200 with no cookie) |
| `PaymentMethodCollector.tsx`, `usePaymentConfig.ts`, `lib/services/payments.ts` | `app/components/payment/__tests__/PaymentMethodCollector.test.tsx`, `lib/services/__tests__/payments.test.ts` | component / service | MSW; `jest.mock('@stripe/react-stripe-js', …)` (the documented external-SDK exception, same factory as today's page tests) | loading state; `LoadError` + retry recovers; stripe config → Stripe form renders; square config (PR 3) → the not-available alert; `fetchPaymentConfig` rejects on 500 |
| `stripe/StripeCardForm.tsx` | `app/components/payment/stripe/__tests__/StripeCardForm.test.tsx` (moved from `PaymentMethodCardForm.test.tsx`) | component | as today | today's cases; body is `{ paymentMethodToken }`; `userEvent` (new/moved tests follow the interaction rule) |
| `payment-method/page.tsx`, `register/page.tsx` | existing page tests | component | MSW adds `GET /payments/config` handler | existing assertions unchanged |
| guard | `lib/__tests__/paymentSdkBoundaryGuard.test.ts` | static | — | §5.3.3 |
| E2E | `parent-register.spec.ts` (unchanged), `mock-api.ts` default | | | suite stays green |

### 6.4 PR 4 — the shared adapter contract suite `tests/payments/providerContract.shared.js`
`describeProviderContract(getAdapter, fixtures)` where `fixtures = { successToken(), declineAtAttachToken(), declineAtChargeToken(), customerInput, signWebhook(payloadObject) → { rawBody, headers }, succeededEventPayload, failedEventPayload, ignoredEventPayload, tamperedHeaders }`. Cases, run verbatim against both adapters:
1. `name`/`capabilities` have the §4.1 shape (`findByReference` is a boolean).
2. `createCustomer` returns a non-empty string; two calls with the same `userId` return ids (Stripe: two ids — no idempotency on the customer call; Square: the SAME id — `idempotencyKey: customer_${userId}`; assert per `fixtures.customerIdempotent`).
3. `attachPaymentMethod` with `successToken` → `{ id, brand: 'visa', last4: '1111' | '4242' (per fixture), expMonth 1–12, expYear ≥ current }`.
4. `attachPaymentMethod` with `declineAtAttachToken` → rejects with `.status === 402` and a non-empty message.
5. `charge` of $12.34 against the attached card → `{ status: 'succeeded', id: string, failureMessage: null }`; `findPayment({ paymentId: id })` → `{ status: 'succeeded', amount: 12.34 }`.
6. `charge` again with the SAME `idempotencyKey` → same `id` (idempotent replay — the D4 fall-through relies on this).
7. `charge` with `declineAtChargeToken` → resolves (never rejects) `{ status: 'failed', failureMessage: non-empty }`.
8. `findPayment({ paymentId: 'does-not-exist' })` → `null`. `findPayment({ reference: 'x' })` → `null` when `!findByReference`; when `findByReference`, a charge's reference finds it.
9. `detachPaymentMethod` resolves; a `charge` with the detached card afterwards → `status: 'failed'` or rejects — assert "does not succeed".
10. `verifyWebhook` with a correctly signed succeeded payload → `type: 'payment.succeeded'`, `eventId`, `paymentId`; failed payload → `'payment.failed'`; ignored type → `'ignored'`; tampered body → rejects with `.status === 400`; missing header → rejects with `.status === 400`.
`stripe.provider.test.js` and NEW `square.provider.test.js` each supply fixtures and call it. `square.provider.test.js`: when `!process.env.SQUARE_ACCESS_TOKEN` and `!process.env.CI` → `describe.skip` with the reason string `'SQUARE_ACCESS_TOKEN not set — sandbox contract suite skipped locally; CI runs it'`; when `process.env.CI` and the token is missing → the suite **fails** with that message (a missing CI secret is never a silent pass).
Other PR 4 rows: `chargeFinalization.service.test.js` + `renewal.service.test.js` gain the D4 cases — a pending row with `providerPaymentId` set is recovered by id with **zero** new charges (`listCustomerPayments` count unchanged); a pending row with no id under a provider that cannot search is re-driven under the same key and still produces exactly one payment; `webhooks.routes.test.js` adds the Square cases under `PAYMENT_PROVIDER=square` (`_resetForTests` + env in `beforeAll`, restored in `afterAll`); `payments/index.test.js` adds `square` selection; guard adds the Square files; `tests/scripts/lib/scrubProviderFields.test.js` (renamed) unchanged semantics.

### 6.5 PR 5
`app/components/payment/square/__tests__/SquareCardForm.test.tsx` (component; `window.Square` stub assigned in `beforeEach`, deleted in `afterEach` — the loader short-circuits, so no script tag is ever injected in jsdom; cases: attaches on mount, tokenize OK → `POST /payment-methods` body `{ paymentMethodToken }` via MSW → `onSaved`; tokenize error → inline alert, no POST; 402 from MSW → inline message, no crash; `userEvent`), `loadSquareSdk.test.ts` (returns existing `window.Square`; memoises; rejects on script error — simulate by dispatching `error` on the injected script element), `PaymentMethodCollector.test.tsx` gains the square branch, `payment-method.spec.ts` (§5.5.4).

### 6.6 PR 6
Docs only (Hard Rule 4 exception) except `list-saved-cards-by-provider.js` → `tests/scripts/lib/listSavedCardsByProvider.test.js` (lib function returns the grouped structure for seeded docs; the non-active provider's parents listed; no writes).

---

## 7. Verification — exact commands, expected results

Run from the repo root in Git Bash. Backend needs `STRIPE_SECRET_KEY` (test mode) in `backend/.env`;
PR 4+ also `SQUARE_ACCESS_TOKEN`/`SQUARE_LOCATION_ID`/`SQUARE_ENVIRONMENT=sandbox`.

**Every PR:**
```bash
cd backend && TZ=UTC npx jest 2>&1 | tail -6          # expect: Test Suites: N passed, N total; Tests: M passed, M total; 0 failed
cd ../frontend && TZ=UTC npx jest 2>&1 | tail -6      # same shape
npx tsc --noEmit                                        # expect: no output, exit 0
npx tsc -p e2e/tsconfig.json --noEmit                   # expect: exit 0 (PR 3+)
npm run build 2>&1 | tail -3                           # expect: "Compiled successfully"
npx playwright test 2>&1 | tail -4                     # expect: "N passed", "2 skipped", 0 failed
cd .. && grep -rnE "require\(['\"]stripe['\"]\)|config/stripe|StripeCardError" backend/src backend/scripts | grep -vE "payments/stripe/|config/stripe.js"   # expect: NO output (PR 1+)
grep -rn "@stripe/\|squarecdn\|window.Square" frontend/app frontend/lib | grep -v "components/payment/" | grep -v __tests__   # expect: NO output (PR 3+)
```
**Baselines at `5391c8c`:** backend 82 suites / 1,091 tests; frontend 67 / 554; E2E 43 listed (41 run + 2 skipped). Each PR's report states the new counts and the delta; a drop in any count without a deletion named in §5 is a STOP.

**PR-specific:**
- PR 1: `git diff develop --stat` must show NO change under `backend/tests/routes/registration.routes.test.js` beyond import/helper lines (`git diff develop -- backend/tests/routes/registration.routes.test.js | grep '^[-+]' | grep -vE "require|mintTest|testUtils|^[-+]{3}"` → no `expect(` lines).
- PR 2: `node backend/scripts/migrate-provider-fields.js` against a local DB seeded by the test (dry) prints the plan; `--live` prints `verification: 0 documents still carry an old field name`.
- PR 3: `curl -s localhost:4000/api/v1/payments/config` → `{"provider":"stripe","stripe":{"publishableKey":"pk_test_…"}}`; the body contains no `sk_`.
- PR 4: `cd backend && PAYMENT_PROVIDER=square TZ=UTC npx jest tests/payments tests/routes/paymentMethod.routes.test.js tests/routes/webhooks.routes.test.js tests/services/billing/chargeFinalization.service.test.js tests/routes/registration.routes.test.js tests/routes/privateClassEnrollment.routes.test.js tests/services/renewal.service.test.js tests/services/renewal.previewAndCharge.test.js` → all pass against the sandbox.
- PR 5: `npx playwright test e2e/payment-method.spec.ts` → all pass; `npx playwright test` → whole suite.

---

## 8. Live gates (staging, owner-run, before `develop → main`)

Staging frontend `https://friscofencing-git-develop-frisco-fencing.vercel.app`, backend
`https://friscofencing-backend-git-develop-frisco-fencing.vercel.app`, login `friscofencingacademy@gmail.com`.

| After | Check | Expected |
|---|---|---|
| PR 1 | Parent (audit account) saves a card, registers a child; superadmin Charge on `/admin/subscriptions`; Stripe dashboard → Developers → Webhooks → send test `payment_intent.succeeded` | 201 registration, ledger row `completed` with a PI id; Charge dialog works; webhook 200 and a `WebhookEvent` row; `GET /api/v1/webhooks/square` style URL → 404 |
| PR 2 | `node scripts/migrate-provider-fields.js` dry then `--live` with `MONGO_URI` = staging; deploy; repeat PR 1's checks | report shows renames + 2 indexes dropped + `verification: 0`; `db.users.getIndexes()` shows `providerCustomerId_1`, no `stripeCustomerId_1`; checks pass |
| PR 3 | Add `STRIPE_PUBLISHABLE_KEY` to the backend Vercel project (Production + Preview), remove `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from the frontend project; redeploy both | `/api/v1/payments/config` returns the pk; `/parent/payment-method` renders the Stripe card form and saves |
| PR 4 | `gh secret set SQUARE_SANDBOX_ACCESS_TOKEN`, `gh secret set SQUARE_SANDBOX_LOCATION_ID`; CI green on the PR incl. `backend-tests-square` | both backend jobs green |
| PR 5 | §11 cutover **on staging only**: set the six `SQUARE_*` Preview vars, `PAYMENT_PROVIDER=square` (Preview), register the webhook URL in the Square Developer Console (sandbox), redeploy; run `audit/run-registration-audit.js` after updating `audit/lib/stripe-card.js` → `provider-card.js` for the Square iframe (its selectors are confirmed on this first run, per the audit plan's own D4 discipline) | config returns square; a parent with a Stripe card sees "add a card"; saving a `4111 1111 1111 1111` card works; registration charges in the Square sandbox dashboard; a `4000 0000 0000 0002` card gives the 402 path; webhook `payment.updated` lands as a `WebhookEvent` |
| PR 6 | docs read-through; `node scripts/list-saved-cards-by-provider.js` on staging | counts match `db.paymentmethods` |

---

## 9. Execution protocol (binding — the owner intends to run all PRs in auto mode)

1. **Authorisation.** The owner's `write` on 2026-10-26 covers: creating the branches named in §5, editing exactly the files §5 names for each PR (and the test files §6 names), and running §7. It does **not** cover: committing or pushing (Hard Rule 5 — the owner tests locally first and says so), merging, touching Vercel/GitHub settings, running any migration against a real database, or editing any file §5 does not name. If a needed change falls outside §5, STOP and report it as `Unresolved`.
2. **Order.** PR 1 → 2 → 3 → 4 → 5 → 6. Do not start PR N+1 until PR N's §7 is green AND the owner has merged PR N to `develop` (each branch is cut from `develop`; stacking is not used).
3. **Read before edit.** Every file in §5 for the PR is read in full before its first edit (Hard Rule 12), and the quoted "before" code is confirmed present; if it is not, STOP.
4. **Tests before done.** §6 tests are written in the same PR; `npx jest <new file>` is run alone first, then the full §7 set.
5. **Never auto-fix.** A failing check → report the failure summary, root cause, and a fix plan; wait. The one exception: a test that fails ONLY because of a rename §5.2.2 explicitly lists is fixed as part of that listed change.
6. **No new Stripe/Square imports anywhere** outside the two adapters and their config files — the guard enforces it, and the executor does not add allowlist entries.
7. **Report-back format** (one per PR):
```
REPORT — PR <n> <branch>
Files changed : <list>
Tests added   : <file: count> …
Counts        : backend <suites>/<tests> (was 82/1091), frontend <s>/<t> (was 67/554), e2e <listed> (was 43)
Verification  : <each §7 command, exit code, last line>
Deviations    : <anything that differed from §5, or "none">
Unresolved    : <exact questions, or "none">
```

---

## 10. Docs to update on ship (owner-facing summary; PR 6 does the work)
`CLAUDE.md` (Tech Stack row, pre-read table, Documentation Map row), `docs/decisions/013-payment-provider-port.md` (status), `docs/decisions/001-…` (addendum), `docs/decisions/README.md` (row 013), NEW `docs/modules/payments.md`, `docs/TESTING_STRATEGY.md`, `docs/TEST_COVERAGE.md`, `docs/features/parent-portal.md`, `docs/plans/deployment-launch-plan.md`, `DATABASE_SCHEMA_DOCUMENTATION.md`, `backend/.env.example`, `CLAUDE_HISTORY.md` row.

---

## 11. Provider switch runbook (Stripe → Square), for `docs/modules/payments.md`

Preconditions: PRs 1–6 on the target environment; the Square account's production application
created; a production webhook subscription registered in the Square Developer Console for
`https://<backend-host>/api/v1/webhooks/square` with events `payment.created`, `payment.updated`.
1. `node scripts/list-saved-cards-by-provider.js` (read-only) → email the listed families: "please re-enter your card on `/parent/payment-method` after <date>".
2. Vercel backend project: set `PAYMENT_PROVIDER=square`, `SQUARE_ACCESS_TOKEN`, `SQUARE_ENVIRONMENT=production`, `SQUARE_LOCATION_ID`, `SQUARE_APPLICATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_NOTIFICATION_URL`; redeploy. Nothing on the frontend changes.
3. Verify `GET /api/v1/payments/config` → `provider: 'square'`; `POST /api/v1/webhooks/stripe` → 404; a Square test event → 200.
4. Renewal day: a family who has not re-entered a card gets today's `failed_no_payment_method` path (no charge, the existing dunning email). Nothing new.
5. Rollback = set `PAYMENT_PROVIDER=stripe` and redeploy; Stripe-saved cards are visible again (D7 — a doc on the inactive provider is hidden, never deleted).
Honest edges (ADR 013): refunds/disputes for Stripe-era charges stay in the Stripe dashboard; saved cards never move; Square idempotency-key retention is undocumented, so D4(1) is the recovery that is relied on.

---

## 12. As-built notes

### PR 1 (2026-10-26, `feature/payment-port-backend`)
- **Built as specified**: `src/payments/{contract,index,stripe/stripe.provider}.js`; every one of the 8 direct SDK call sites and both `StripeCardError` sniffs migrated; `stripeCustomer.service.js` → `paymentCustomer.service.js` (`ensureCustomer`), `stripeWebhook.*` → `webhooks.*` (`POST /api/v1/webhooks/:provider`, 404 for an inactive provider, Stripe URL unchanged). Stored strings, statuses and emails unchanged; `registration.routes.test.js` changed no assertion except the `listCustomerPayments` rename.
- **The shared contract suite and the boundary guard landed in PR 1, not PR 4** — they belong with the port; PR 4 adds the Square fixtures and the Square entries to the guard. `REQUIRED_MEMBERS` is exported from `contract.js` so the fake provider and the contract test read the one list.
- **Test helper API** (`tests/testUtils/payments.js`, replaces `testUtils/stripe.js`): `mintCardToken(kind)`, `successCardDetails()`, `declineAtChargeCardId()`, `customerIdOf()`, `retrievePayment()`, `listCustomerPayments()`, `listCustomerCards()`, `expectLedgerChargeSucceeded()`, `signWebhook()`. Assertions that only held on Stripe (`last4 '4242'`, a `cus_`/`pi_` prefix, stored card id equal to the browser token) were rewritten to provider-neutral ones that are also stronger (the stored card is the only one attached to the parent's own customer). `expectLedgerChargeSucceeded` additionally asserts the payment's reference is the row's own id.
- **Stale-pending "prior run's charge" is now made by the real `chargeLedgerRow`**, not a hand-built Stripe call — the exact key, reference and metadata a dying run would have used.
- **Measured: Stripe's search is eventually consistent** — the contract suite's reference lookup found a brand-new charge only after 24 s. The contract case polls with a bounded wait (75 s); this is the measured reason D4's id-first recovery matters.
- **Webhook 5xx now goes through the central error middleware** (`next(error)`), so a database failure answers the house's generic `Something went wrong` (real error logged) instead of relaying `error.message` — the webhook was the last controller sending internal error text. The 400 signature-failure body is unchanged, pinned word for word by a new test.
- Counts: backend 87 suites / 1,144 tests (was 82 / 1,091), statements 92.98%; guard proven to fail on each planted violation (SDK require, direct adapter require, error sniff).

### PR 2 (2026-10-26, `feature/payment-provider-fields`)
- **Built as specified** (§4.3 data model, §5.2.2 every reader/writer, `scripts/migrate-provider-fields.js` + `scripts/lib/migrateProviderFields.js`), plus `scrubStripeFields` → `scrubProviderFields`.
- **`PROVIDER_NAMES` has one home, `src/payments/contract.js`** — it has no dependencies, so the four models read it without loading any SDK. `getPaymentProvider()` now also refuses an adapter whose `name` differs from the `PAYMENT_PROVIDER` it was selected by (the name is what every row records).
- **`Registration.provider` semantics** (decided while building): set on EVERY charge attempt, a decline included; null only on a row that never reached a provider (manual, legacy, backfill). The migration stamps historical rows `'stripe'` only when they carry a payment id — the honest "none recorded" otherwise.
- **A real defect fixed in `ensureCustomer`** (found when a test that worked around it broke): it trusted the caller's in-memory user, so a stale object — or two concurrent requests — could mint a second customer and split a parent's card and charges across customers. It now reads the stored state and claims atomically (`findOneAndUpdate` conditioned on "no customer on this provider yet"); a racing loser returns the winner's id. The test workaround is gone; new tests cover the stale object, a real two-request race, and a missing user (404).
- **`POST /payment-methods` validates `paymentMethodToken`** (400 `paymentMethodToken is required`) instead of passing `undefined` to the provider (a 500).
- **Migration design points**: works on raw collections (the models no longer know the old names); a null `stripeCustomerId` is removed, not carried into the new unique sparse index; new indexes built with `createIndexes()` — never `syncIndexes()`, which would drop undeclared indexes; dry-run counts for the rename-dependent steps use pre-rename filters so the dry run is accurate. Staging dry run 2026-10-26: 2 customers, 2 cards, 69 ledger rows (2 with a payment id), 0 webhook events, both old indexes present.
- Counts: backend 90 suites / 1,168 tests (was 87 / 1,144), statements 93.01%; frontend unchanged at 69 / 560.

### PR 3 (2026-10-26, `feature/payment-frontend-boundary`)
- **Deviation (architecture): `publicConfig()` is an adapter member, not provider branches in a service.** §5.3.1 sketched `paymentsConfig.service.js` with `if (provider.name === 'stripe') … if ('square') …` — provider knowledge outside the adapters, which the port exists to prevent. Each adapter now exposes `publicConfig()` (public identifiers only; throws when unconfigured), the service returns `{ provider, [provider]: adapter.publicConfig() }`, and the shared contract suite asserts every adapter's config contains no secret. `REQUIRED_MEMBERS` gains `publicConfig` (D2: a member arrives with its first caller).
- **The duplicated card-save path is gone**: the form saves through `lib/services/parent.ts`'s `savePaymentMethod` mutation (previously unused while the form posted on its own).
- No separate `usePaymentConfig` hook file — the collector calls `useLoadState(fetchPaymentConfig)` directly; one caller, no reuse to share.
- `GET /payments/config` is public, answers the generic 500 (logged) when the active provider has no public config, and is mocked by default in `e2e/fixtures/mock-api.ts`. `frontend/lib/stripe.ts` and the build-time `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are gone (Playwright's build no longer sets it). The deploy env tables moved here from PR 6 since this PR changes them.
- Tests: `StripeCardForm` (moved, on `userEvent`, loads Stripe.js once per key, mocks typed from the real `loadStripe`), `PaymentMethodCollector` (loading, `LoadError` + retry recovery, the "not available yet" notice for a provider with no form), `lib/services/payments.ts`, the config route (no auth, no secret, generic 500), `paymentSdkBoundaryGuard` (proven on a planted import). Counts: backend 91 suites, frontend 72 suites / 570 tests, statements 90.35%.
- **Rollout:** add `STRIPE_PUBLISHABLE_KEY` (the value the frontend's `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` holds today) to the backend Vercel project, Production + Preview, BEFORE this deploys — otherwise the card form shows a load error. Then delete `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from the frontend project.
