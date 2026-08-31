# Manual Charge Button + PDF Invoices — Execution Plan

**Status:** BOTH PRs BUILT 2026-08-30, pending owner local testing + review before merging either
to `develop`. PR 1 on `feature/manual-charge-button`. PR 2 on `feature/pdf-invoices`, stacked on
PR 1's branch (PR 1 was still open/unmerged when PR 2 was built, per the owner's "go for PR 2"
instruction — see the plan's Execution-order note below, amended accordingly: PR 2's diff will be
clean once PR 1 merges first).

PR 1: backend 586/606 tests green (the 20 failures are pre-existing local-machine TZ-environment
issues, reverified via `git stash` unrelated to this branch's changes — CI/prod run under
`TZ=UTC`), including `tests/services/renewal.previewAndCharge.test.js` (11/11) and the extended
`tests/routes/subscription.routes.test.js` (27/27, up from 16). Frontend 346/346 (23/23 for
`app/admin/subscriptions/__tests__/page.test.tsx`, up from 14), `tsc --noEmit` clean.

PR 2: new `tests/services/invoice.service.test.js` (8/8), extended
`tests/services/mail.service.test.js` (36/36, up from 27), `tests/services/renewal.service.test.js`
(23/23, up from 21), `tests/routes/privateClassSession.routes.test.js` (14/14, up from 12),
`tests/routes/registration.routes.test.js` (34/48 passing — up from 26/40; the 14 failures are
pre-existing, independently `git stash`-reverified as identical with PR 2's changes removed: real
Stripe "amount below minimum charge" errors from a handful of sibling-discount tests that anchor
registration to real wall-clock "today," which lands very close to month-end proration in the
current test environment — unrelated to this PR, not attempted here per Hard Rule 6). `npm install
pdfkit@0.20.2`, no frontend changes (no UI in this PR, per plan). `backend/src/config/academy.js`
ships with placeholder address/EIN — owner fills in the real values whenever ready.
**Owner decision (2026-08-30):** For now, renewals are NOT run on any schedule. Instead, a
superadmin-only **Charge** button on `/admin/subscriptions` processes one subscription at a
time, with a full pre-charge preview (exact amount + card-on-file status). Separately, every
completed charge — group class AND private class — produces a **PDF invoice** (service,
location, amount, academy EIN) attached to the receipt email and downloadable on demand.

---

## Context

- **There is no cron to disable.** `npm run renewals` (`backend/scripts/run-renewals.js`) was
  never scheduled anywhere (deployment plan line ~173 lists scheduling as a future decision).
  "Disable the cron" = keep it unscheduled, and make the manual button the intended path.
- The renewal job does **two** jobs: charging due subscriptions AND **finalizing pending
  cancellations** (flip `status` → `cancelled`, remove student from roster) when a
  pending-cancel subscription reaches its due date. With no job running, a pending-cancel
  subscription would stay on the roster past its paid period. The Charge button must cover this
  case too (D3).
- All charge mechanics already exist and are battle-tested:
  `renewal.service.js` (`renewOne`/`retryOne`), `billing/chargeFinalization.service.js`
  (create-pending-first, locked amounts, idempotency keys, dunning). **This plan adds zero new
  charge logic** — the button is a per-subscription trigger for the exact same functions the
  job runs (ADR 001 safeguards all apply unchanged).
- Invoices draw from the unified `Registration` ledger (ADR 004) — every charge, group or
  private, is already one immutable row with `amount`, `paidAt`, `serviceId`, and
  shape-specific refs. Immutability means a PDF is **deterministically regenerable** from the
  row at any time → no Blob storage needed.

## Decisions

| # | Decision |
|---|---|
| D1 | **Preview reuses the real charge's own functions** — `previewRenewal()` calls `resolveMonthlyFee()` + `calculateChargeAmount(mode: 'renewal')`, the same pair `renewOne` calls. Never a parallel calculation (ADR 001's standing preview rule). |
| D2 | **The charge endpoint calls `renewOne`/`retryOne` verbatim** — routed by `subscription.retryCount > 0` (retry) vs `0` (renewal), the same routing `run-renewals.js`'s two phases encode. All guards (fresh re-fetch, not-due skip, ledger dedup, stale-pending recovery, idempotency keys, receipt/failure emails, dunning-state writes) come for free. No `force` option — a not-due subscription returns `skipped_not_due`, and the button cannot charge early. |
| D3 | **The button also finalizes cancellations.** For a due pending-cancel row, `renewOne` finalizes the cancellation without charging (existing behavior). The dialog states this explicitly instead of hiding the button — otherwise finalization has no path at all while nothing is scheduled. |
| D4 | **Dunning shows the locked amount.** If `retryCount > 0`, the preview returns the latest failed ledger row's `amount` (what `retryOne` will actually charge) — never a live recalculation (registration-ledger-plan dunning policy: the emailed amount is the charged amount). |
| D5 | **Superadmin only**, both endpoints and the button. Same in-page gate pattern as `/admin/settings` and `/admin/audits` (`user?.role === 'superadmin'`), on top of route-level `requireRole('superadmin')`. |
| D6 | **Invoices cover ALL completed charges** — group-class initial registrations, renewals, retries, and private-class per-session charges (owner-confirmed 2026-08-30). One generator, one ledger, one code path. |
| D7 | **Academy identity is hard-coded** in `backend/src/config/academy.js` — name, address, phone, email, `ein: 'XX-XXXXXXX'` (placeholder; owner edits the real EIN into this one file). No admin UI, no `Setting` field. |
| D8 | **No PDF storage.** Generated at send time for the email attachment; regenerated on demand for the download endpoint. The ledger row is the invoice's source of truth; a `completed` row always renders the same PDF (modulo the hard-coded academy block). |
| D9 | **Invoice location resolution:** group-class rows resolve the real `Location` via `scheduleId → classId → locationId`; private-class rows (a `PrivateClassSchedule` has no location field) and any group row whose chain no longer resolves fall back to the academy address from `config/academy.js`. Never crash on a broken chain (orphaned-reference discipline). |
| D10 | **Library: `pdfkit`** — pure JS, no headless browser, works on Vercel serverless. Pinned as a regular dependency. |
| D11 | **Two PRs** on one feature branch each: PR 1 = Charge button (backend + frontend), PR 2 = PDF invoices. PR 2 does not depend on PR 1's code (only on its merge order for clean diffs). |

---

## PR 1 — Superadmin Charge button

Branch: `feature/manual-charge-button`

### 1.1 Backend — `previewRenewal(subscriptionId)` in `renewal.service.js`

New exported function. Fresh fetch (same discipline as `renewOne`), then:

1. `not_found` / non-`active` → `{ outcome }` early returns mirroring `renewOne`'s vocabulary.
2. Resolve `due = subscription.nextBillingDate <= todayAtMidnight()`.
3. `willFinalizeCancellation = subscription.cancelAtPeriodEnd === true && due` — when true,
   skip amount computation entirely (nothing will be charged).
4. **Dunning branch** (`retryCount > 0`): find the latest `failed`
   `SubscriptionCycleRegistration` row (same query `retryOne` uses); return its locked
   `amount` + `breakdown`, plus `inDunning: true`, `retryCount`,
   `attemptsRemaining = MAX_PAYMENT_RETRIES - retryCount`. If no failed row exists, mirror
   `retryOne`'s `skipped_no_failed_row`.
5. **Fresh-renewal branch**: `resolveMonthlyFee()` → `null` becomes
   `{ outcome: 'no_price' }` (surfaced, not thrown); otherwise
   `calculateChargeAmount(student, monthlyFee, { mode: 'renewal', subscription })` →
   `{ amount, breakdown: { monthlyFee, siblingDiscountApplied, siblingDiscountAmount } }`.
6. **Always** include `paymentMethod`: `paymentMethodService.getMine(parentId)` →
   `{ cardBrand, cardLast4 }` or `null`. The frontend's "no card on file" warning keys off
   `null` — the backend never phrases it, per the SOT rule.
7. Also return `periodStart` (`currentPeriodEnd`) + `periodEnd` (`addOneMonth`) so the dialog
   can say what period is being paid for.

Return shape (one object, no throwing for billing states):

```js
{
  outcome: 'previewable' | 'not_found' | 'inactive' | 'no_price' | 'no_failed_row',
  due, nextBillingDate, willFinalizeCancellation,
  inDunning, retryCount, attemptsRemaining,        // dunning only
  amount, breakdown,                                // absent when willFinalizeCancellation
  periodStart, periodEnd,
  paymentMethod: { cardBrand, cardLast4 } | null,
}
```

Read-only — no writes, no Stripe calls, no emails.

### 1.2 Backend — `chargeNow(subscriptionId)` + routes

- `chargeNow` in `renewal.service.js` (3 lines): fresh-fetch the subscription; if
  `retryCount > 0` → `return retryOne(subscriptionId)`, else `return renewOne(subscriptionId)`.
  (`retryOne` itself handles exhaustion-cancellation; `renewOne` handles pending-cancel
  finalization, stale-pending recovery, dedup — all untouched.)
- `subscription.controller.js`: `chargePreview` (GET) and `charge` (POST) handlers, standard
  try/catch → `error.status || 500` shape.
- `subscription.routes.js`:

```js
router.get('/:id/charge-preview', requireAuth, requireRole('superadmin'), chargePreview);
router.post('/:id/charge',        requireAuth, requireRole('superadmin'), charge);
```

### 1.3 Frontend — `/admin/subscriptions` Charge action

- `lib/services/subscriptionsAdmin.ts`: `fetchChargePreview(id)`, `chargeSubscription(id)`.
- `lib/types.ts`: `ChargePreview` + `ChargeResult` types matching 1.1/1.2 exactly (no `any` —
  Hard Rule 8).
- `app/admin/subscriptions/page.tsx`: a **Charge** button in the Actions column, rendered only
  when `user?.role === 'superadmin'` (via the existing auth context) AND the row is not
  `status: 'cancelled'`. Opens a dialog (the shared `Modal` component if the
  `feature/shared-modal-component` branch has merged by build time; otherwise the page's
  existing dialog pattern — decide at build start, note the choice in the PR):
  - Loads the preview on open (loading state → content or inline error).
  - Shows: student + class, billing period (`periodStart`–`periodEnd`), breakdown rows
    (monthly fee; `− $X sibling discount (10%)` when applied), **total in large type**.
  - Dunning: an amber note — "Retry attempt N of 3 — charging the locked amount from the
    failed charge."
  - Card on file: `Visa •••• 4242`, or a red `Alert variant="error"`: **"No card on file —
    this charge will fail."** Confirm disabled.
  - Not due: muted "Not due until {nextBillingDate}." Confirm disabled (matches the backend's
    `skipped_not_due` — the button never pretends it can charge early).
  - Pending-cancel + due: "This subscription is pending cancellation. Processing will
    **finalize the cancellation** — nothing is charged." Confirm enabled, label "Finalize".
  - Confirm → `POST` → render the outcome in the dialog (`charged` → green success with
    amount; `failed_payment` → the failure message + "a retry is scheduled for tomorrow";
    `cancelled_finalized`, `skipped_*` → plain-language equivalents). Close refreshes the
    list (`retry()`), so Next billing / Last charge / Status columns update.

### 1.4 Tests (PR 1)

Backend (`renewal.service` + route tests, per `docs/TESTING_STRATEGY.md`):
- `previewRenewal` amount/breakdown **equals what `renewOne` then actually charges** for the
  same subscription (the D1 property, asserted directly — run preview, run renewOne with
  mocked Stripe, compare).
- Dunning preview returns the failed row's locked amount even after the `Price` doc changes.
- `paymentMethod: null` when the parent has no saved card; populated `{cardBrand, cardLast4}`
  when they do.
- `willFinalizeCancellation` on a due pending-cancel row; `due: false` for a future
  `nextBillingDate`.
- `chargeNow` routes to `retryOne` when `retryCount > 0`, `renewOne` otherwise.
- Route guards: 401 unauthenticated; **403 for parent, coach, AND admin** (superadmin-only is
  the point); 200 for superadmin. Both endpoints.
- POST returns `renewOne`'s outcome verbatim (spot-check `skipped_not_due` and `charged`).

Frontend (`app/admin/subscriptions/__tests__/`):
- Charge button absent for an admin viewer, present for superadmin.
- Dialog: no-card → warning + disabled confirm; not-due → disabled confirm; dunning note;
  pending-cancel copy + "Finalize" label; success and failure result states.

### 1.5 Docs (PR 1)

- `docs/features/admin.md` → Subscriptions section: the Charge action + dialog states.
- `docs/decisions/001-in-house-subscription-billing.md` → short addendum: "2026-08-30 —
  scheduled renewal runs are paused by owner decision; a superadmin-only per-subscription
  Charge button (calling `renewOne`/`retryOne` unchanged) is the current renewal path.
  `npm run renewals` remains available and safe to run at any time (same functions, same
  guards)."
- `docs/plans/deployment-launch-plan.md` → the "Renewals scheduling" bullet: note the button
  as the current interim answer.

---

## PR 2 — PDF invoice on every completed charge

Branch: `feature/pdf-invoices`

### 2.1 Dependency + academy config

- `npm install pdfkit` (backend; pin exact version in the PR).
- `backend/src/config/academy.js`:

```js
// Hard-coded academy identity for invoices (owner-editable, D7 — no admin UI).
module.exports = {
  name: 'Frisco Fencing Academy',
  addressLines: ['<street>', '<city>, TX <zip>'],   // owner fills real values
  phone: '',
  email: '',
  ein: 'XX-XXXXXXX',                                 // PLACEHOLDER — real EIN goes here
};
```

### 2.2 Invoice data assembly — `backend/src/services/invoice.service.js`

Split pure-data assembly from PDF rendering so field logic is unit-testable without parsing
PDF binaries:

- `buildInvoiceData(registrationRow)` — accepts any **completed** ledger row (either
  discriminator), throws (`status: 409`) on a non-`completed` row, and resolves:
  - `invoiceNumber: 'INV-' + row._id` (stable, unique, regenerable), `invoiceDate: row.paidAt`.
  - `billTo`: parent name + email (`User.findById(row.parentId)`); student name.
  - **`subscription_cycle` rows**: service name from `row.serviceId` (populate `Service`),
    class name + **location** via `row.scheduleId → classId → locationId` (D9 fallback to
    academy config on any broken link — never throw), line items from `row.breakdown`
    (monthly fee; sibling discount as a negative line when applied; registration fee line
    when `registrationFeeCharged > 0`), period label from `periodStart`/`periodEnd`,
    `eventType` (`initial` / `renewal`) for the description line.
  - **`per_session` rows**: service name from `row.serviceId`, coach name + session
    date/duration via `row.sessionId` (`PrivateClassSession` → its own `startDate`/`endDate`
    + `sessionDurationMinutes`), location = academy config (D9). Single line item =
    `row.amount`.
  - `total: row.amount` — always the ledger row's own amount, **never recomputed** (Hard
    Rule 7 / the ledger is the record of what was actually charged).
  - `academy`: the config object, EIN included.
- `renderInvoicePdf(invoiceData)` → `Promise<Buffer>` — pdfkit layout: academy block (name,
  address, `EIN: XX-XXXXXXX`), invoice number/date, Bill To, description + line-item table,
  bold total, "Paid — thank you" footer with `paidAt`. Buffer collected from the doc's
  stream; no filesystem writes (serverless-safe).
- `generateInvoicePdf(registrationRowOrId)` — convenience: fetch (if id) → build → render.

### 2.3 Email attachment

- `mail.service.js` `sendMailSafely`: accept an optional `attachments` array, passed through
  to `transporter.sendMail` (nodemailer-native shape:
  `[{ filename, content: Buffer, contentType: 'application/pdf' }]`). The `APP_ENV` staging
  gate is upstream of the transport call, so blocked sends stay blocked — no change needed.
- Thread an optional `invoicePdf` (Buffer) param into exactly three senders, attached as
  `` `${invoiceNumber}.pdf` ``:
  - `sendRegistrationConfirmationEmail` (initial group registration)
  - `sendRenewalReceiptEmail` (renewal/retry success)
  - `sendPrivateClassSessionReceiptEmail` (private session charge)
- Call-site changes — in each case the PDF is generated **inside the existing fire-and-forget
  email try/catch** (a PDF failure must never undo or fail an already-committed charge; it
  logs and sends the email without the attachment — pass `undefined` through):
  - `registration.service.js` `create()` success path (its confirmation-email block).
  - `renewal.service.js` `sendReceiptEmail()` — one place; covers renewOne, retryOne, and
    stale-pending adoption automatically since all three route through it. Needs the ledger
    row (or its id) added to `sendReceiptEmail`'s params — thread it from each caller.
  - `privateClassSession.service.js` `chargeSession()` success path (its receipt block).

### 2.4 Download endpoint

- `GET /registrations/:id/invoice` — `registration.routes.js` + controller:
  - `requireAuth`; admin/superadmin may fetch any row; a parent only a row whose
    `parentId` matches (403 otherwise, mirroring `subscription.service.js`'s
    `isOwningParent` pattern); other roles 403.
  - 404 unknown id; 409 non-`completed` row ("No invoice exists for an unpaid charge").
  - Streams the buffer: `Content-Type: application/pdf`,
    `Content-Disposition: attachment; filename="INV-<id>.pdf"`.
  - **Route order**: registered so it can't shadow or be shadowed by `/mine` / `/preview`
    (`/:id/invoice` has a literal suffix, but keep the existing literal routes first,
    matching the codebase's stated route-ordering convention).
- No frontend download UI in this plan (out of scope below) — parents get the email
  attachment; the endpoint exists for direct/admin use and future UI.

### 2.5 Tests (PR 2)

Backend:
- `buildInvoiceData`, subscription_cycle: real location resolved through the chain; sibling
  discount negative line; registration-fee line only when charged; `total === row.amount`
  untouched even when breakdown parts wouldn't sum to it (locked-amount property).
- `buildInvoiceData`, per_session: coach + session date + duration; academy-config location.
- D9 fallbacks: deleted schedule/class/location → academy address, no throw.
- Non-completed row → 409-shaped throw. EIN placeholder appears in assembled data.
- `renderInvoicePdf`: smoke — resolves a non-empty Buffer starting with `%PDF`.
- `sendMailSafely` passes `attachments` through to the transport (existing mail test
  pattern); senders omit `attachments` entirely when no buffer is provided.
- Charge paths: a mocked-Stripe successful renewal / private charge calls the receipt sender
  with an invoice buffer; a thrown PDF generation still sends the receipt (no attachment)
  and the charge outcome is unaffected.
- Invoice endpoint: parent-own 200 / other-parent 403 / admin 200 / coach 403 / 404 / 409,
  and response headers.

### 2.6 Docs (PR 2)

- `docs/modules/email.md`: attachments support + which templates carry invoices.
- `docs/features/private-class.md` charge pipeline: receipt now carries the invoice PDF.
- `DATABASE_SCHEMA_DOCUMENTATION.md`: no schema change (explicitly none — D8), but note the
  invoice endpoint under Registration if the doc lists routes.
- `CLAUDE.md` documentation-map rows for this plan on completion.

---

## Explicitly out of scope

- Any change to charge amounts, dunning cadence, idempotency, or guard logic (D2 — verbatim reuse).
- A "charge early / charge anyway" override for not-due subscriptions.
- Bulk "charge all due" button (one row at a time is the owner's stated intent; `npm run
  renewals` still exists if bulk is ever wanted).
- Invoice storage (Blob/S3), invoice numbering sequences beyond `INV-<rowId>`, sales tax lines.
- Frontend invoice-download UI (parent portal or admin) — endpoint only, UI later if wanted.
- Invoices for `failed` charges, refunds/credit notes (no refunds exist — D8 policy), or
  retroactive invoice emails for charges completed before this ships (regenerable on demand
  via the endpoint if ever needed).
- Re-enabling scheduled renewals (separate future decision; the button and the script coexist).

## Execution order & gates

1. PR 1 built on `feature/manual-charge-button` → owner local test (charge a staging
   subscription end-to-end: preview → charge → receipt email → list refresh; plus the
   no-card and pending-cancel dialogs) → PR to `develop`.
2. PR 2 built on `feature/pdf-invoices`, branched off PR 1's branch (owner said "go for PR 2"
   before PR 1 had merged — the original plan assumed PR 1 would merge first for a clean diff;
   stacking instead means PR 2's GitHub diff will show PR 1's commit too until PR 1 merges,
   after which it resolves to just PR 2's own changes) → owner local test (register + renew +
   private session on staging; open the attached PDFs; hit the download endpoint as parent and
   admin) → PR to `develop` (base `develop`, will need PR 1 merged first or a rebase).
3. Owner fills the real EIN + address into `config/academy.js` whenever ready (any time
   after PR 2; placeholder ships first).

Standard hard rules apply throughout: tests before commit, owner tests locally before any
commit, no auto-fixing failures.

## Addendum (2026-08-31) — Vercel bundling bug + admin download UI

**Incident**: the owner reported invoice download not working on staging's `/parent/billing`
page. Reproduced exactly: `{"message":"Cannot find module '/var/task/backend/node_modules/
pdfkit/js/standard-fonts/Helvetica.cjs'"}`. Root cause: pdfkit's built-in fonts load through a
dynamic subpath import (`#standard-fonts/*`, resolved via pdfkit's own `package.json` `imports`
map + a runtime-created `require`) that Vercel's build-time file tracer can't follow statically,
so those files never get bundled into the deployed serverless function — invisible to the Jest
suite (real `node_modules` on disk, not a Vercel bundle) and to local dev (same reason). Fixed on
`fix/pdfkit-vercel-invoice-bundling`:
- `backend/vercel.json` — `functions["api/index.js"].includeFiles` force-includes
  `node_modules/pdfkit/js/standard-fonts/**`.
- `backend/package.json` — `pdfkit` pinned to the exact tested version (`0.20.2`, no `^`), since
  the glob targets this version's specific internal file layout and pdfkit has already
  restructured how it ships standard fonts once before.
- `invoice.service.js` gained a header comment cross-referencing both, for the next person who
  finds this file without this doc.
- Verification: could not run `vercel build` locally to prove the bundle before deploying (this
  session's shell couldn't spawn `cmd.exe` for the Vercel CLI's own subprocess — an environment
  limitation, not a finding about the fix) — closed the loop instead via a real staging redeploy
  + a real Download click.

**Admin download UI** — this out-of-scope line above ("Frontend invoice-download UI (parent
portal or admin) — endpoint only, UI later if wanted") is now partially closed: the owner asked
for the admin side while this bug was being fixed. Built on `feature/admin-payment-history`,
reusing everything `docs/plans/payment-airtight-plan.md`'s PR 3 already built for the parent
side rather than duplicating it — `PaymentHistoryTable` was written generic for exactly this
reuse (see its own header comment), and `GET /:id/invoice` already allowed admin/superadmin
(see that PR's route). The only new surface: `GET /registrations/history` now accepts an
admin-only `?parentId=` query param (a parent role always gets their own `req.user._id`
regardless of any `parentId` it sends — never honored for that role), and `/admin/subscriptions`
gained a "Payment History" row action opening the shared `Modal` around that same table,
showing the row's whole family's history exactly as the parent themselves sees it.
