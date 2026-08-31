# Email system

Block-based transactional email design system, ported from CKQ (`docs/plans/ckq-parity-plan.md`
Phases 1–2), plus the fail-closed staging gate. Lives in `backend/src/email/` +
`backend/src/services/mail.service.js`.

## Architecture — three strictly separated layers

1. **`templates.js`** — the registry. Each entry is `{ key, subject, preheader, build(data) }`.
   `build(data)` is a **pure function** that returns an array of **blocks** (plain data objects,
   never HTML strings). All money/date values arrive in `data` already computed by the caller
   (`mail.service.js`) — templates never do arithmetic or date math themselves.
2. **`layout.js`** — the *only* file that owns visual decisions. `renderHtml(blocks, opts)` walks
   the block array and emits the actual HTML (600px table skeleton, hidden preheader, light-only
   color-scheme metas, one mobile media query, bulletproof buttons, `escapeHtml` on every
   plain-label field). Changing the brand (colors, wordmark) means editing `tokens.js` only —
   never a template.
3. **`text.js`** — `renderText(blocks, footerMode)` walks the **same blocks** to derive the
   plain-text twin. Because HTML and text both read from one block array, they can never drift.

Supporting files:

- **`tokens.js`** — frozen literal hex palette (`C`), the font stack, `LOGO_URL()` (returns
  `process.env.LOGO_URL || null` — read at call time), and `ORG()` (name, from/support email,
  portal URL — also read at call time). When `LOGO_URL()` is unset the header renders a text
  wordmark (`FRISCO FENCING`, `C.gold`-on-`C.ink`) instead of an `<img>`. Rebranded 2026-08-29
  to navy/crimson alongside the frontend (`docs/plans/wordpress-ui-alignment-plan.md`, Phase 1)
  — the `gold`/`goldHover`/`goldSoft`/`goldBorder`/`goldInk` key *names* were kept (every call
  site in `layout.js` references them), only their hex *values* changed to crimson.
- **`interpolate.js`** — `{{token}}` substitution for **subject/preheader only** (never block
  content, which is already-escaped structured data by the time it reaches the layout).
  Unresolved tokens stay visible in the output and are `console.warn`ed — a loud failure mode by
  design, never a silently blank subject line.
- **`dates.js`** — the *only* date/time formatters emails may use. Two shape-matched formatters
  (`docs/plans/utc-date-standard-plan.md`), never interchangeable: `dateFull(date)` →
  `Monday, Aug 25, 2026`, `timeZone: 'America/Chicago'` — for **real instants** only (a private-
  lesson's `startDate`, a charge's `paidAt`, `Subscription.nextRetryAt`). `dateOnlyFull(date)` →
  same format, `timeZone: 'UTC'` — for **calendar-day sentinels** only (`GroupClassSession.date`,
  `Subscription`/`Registration` period fields). Rendering a sentinel via `dateFull` shifts it onto
  the wrong calendar day for a recipient east of it — this was a real, shipped bug (the trial-
  confirmation email stating "Sunday" for a Monday class) before the split existed. `monthLabel`
  → `September 2026` is UTC-anchored too (its one real caller, the renewal receipt, always feeds
  it a period-start sentinel). `timeOfDay('HH:mm')` → `4:00 PM` and `dayOfWeekLabel(n)` →
  `Monday` round out the set. All via `Intl.DateTimeFormat`/string parsing.
- **`index.js`** — the public API: `renderEmail(key, data)` → `{ subject, preheader, html, text }`,
  `hasTemplate(key)`, `listTemplates()`. Pure — data in, strings out; no fetching, no sending.
- **`sampleData.js`** — one realistic `SAMPLE_DATA[key]` fixture per template, used by both the
  preview script and `tests/email/renderEmail.test.js`.

### Block vocabulary

`spacer`, `divider`, `eyebrow`, `heading`, `subheading`, `text`, `badge`, `button`, `link`, `card`,
`detailList`, `steps`, `breakdown`. `card` tones: `gold`/`green`/`red`/`blue`/`neutral`, each
mapping to a background+border pair in `tokens.js`. `breakdown` renders a bordered payment table
from `{ monthlyFee, siblingDiscountAmount|null, total }` — the arithmetic happens in the caller
(`calculateChargeAmount.service.js`/`privateClassPricing.js`), never inside the block itself.

## Template registry (11 keys)

| Key | Used by | CC |
|---|---|---|
| `trialConfirmation` | Trial booking | admin, coach |
| `trialEvaluation` | Coach records a trial evaluation (docs/plans/premium-registration-and-attendance-plan.md §3.10) | admin |
| `registrationConfirmation` | New group-class registration | admin, coach |
| `renewalReceipt` | Monthly renewal charge | — |
| `cancellationConfirmation` | Group subscription cancel (parent- or admin-initiated) | coach only (no admin — CKQ pattern) |
| `reactivationConfirmation` | Reversing a pending group cancellation | — |
| `scheduleChangeConfirmation` | Admin moves a student to a new (same-level) schedule | new coach |
| `privateClassConfirmation` | Private-lesson self-registration | admin, coach |
| `privateClassSessionReceipt` | Private-lesson attendance → successful charge | admin |
| `privateClassPaymentFailed` | Private-lesson attendance → declined/failed charge | admin |
| `privateClassCancellation` | Private enrollment cancellation | admin, coach |

Every `send*` function in `mail.service.js` (1) assembles the template's `data` (populating
whatever refs it needs — a populate failure must never fail the caller's mutation, so this
happens inside the function's own try/catch), (2) calls `renderEmail(key, data)`, (3) calls
`sendMailSafely({ to, cc, subject, text, html, attachments })`. **Every send function catches its
own errors and never throws** — email is a fire-and-forget side effect of an operation that has
already committed to the database.

## PDF invoice attachments (docs/plans/manual-charge-and-pdf-invoice-plan.md PR 2)

`sendMailSafely`'s optional `attachments` param is nodemailer's own shape verbatim
(`[{ filename, content: Buffer, contentType }]`), passed through to `transporter.sendMail`
unchanged — the `APP_ENV` staging gate sits upstream of the transport call, so a blocked send
stays blocked whether or not it carries an attachment. Three senders carry one:
`sendRegistrationConfirmationEmail`, `sendRenewalReceiptEmail`, and
`sendPrivateClassSessionReceiptEmail` each accept optional `invoiceNumber`/`invoicePdf` params;
`mail.service.js`'s own `invoiceAttachment(invoiceNumber, invoicePdf)` helper turns them into the
attachments array (or `undefined` when `invoicePdf` is falsy, so `sendMailSafely` omits the field
entirely rather than sending an empty array).

The PDF itself is built by `backend/src/services/invoice.service.js` (`buildInvoiceData` +
`renderInvoicePdf`, via `pdfkit`) from the completed `Registration` ledger row the charge just
wrote — every caller (`registration.service.js`'s `create()`, `renewal.service.js`'s
`sendReceiptEmail()`, `privateClassSession.service.js`'s `chargeSession()`) generates it inside
its **own** nested try/catch, separate from the email-sending try/catch that already wraps it: a
PDF generation failure logs and leaves `invoiceNumber`/`invoicePdf` `undefined` (dropping only the
attachment), it never skips or fails the receipt email itself, and it can never undo or fail an
already-successful charge. Full design (location fallback rules, the hard-coded academy identity,
the on-demand `GET /registrations/:id/invoice` download endpoint): `docs/features/private-class.md`
and the plan doc above.

## Staging email gate (`APP_ENV`, fail-closed)

```js
const isEmailBlocked = () =>
  Boolean(process.env.SMTP_HOST) && process.env.APP_ENV !== 'production';
```

- Checked **after** the message is fully rendered — staging still exercises every bit of the
  render path (templates, layout, text twin); only the final `transporter.sendMail` call is
  skipped.
- **Fail-closed**: anything other than `APP_ENV === 'production'` blocks. `NODE_ENV` cannot be
  used for this — Vercel sets `production` on Preview deployments too.
- **Ethereal exemption**: when `SMTP_HOST` is unset (the zero-setup local dev path — Nodemailer
  auto-creates a free Ethereal test account), the gate never blocks. Ethereal never delivers to a
  real inbox, so blocking it would break local dev for no safety benefit.
- A block returns `{ blocked: true }` from `sendMailSafely` (truthy — matches every call site's
  "truthy == sent" contract; a deliberate block is not a failure) and logs
  `console.warn('[mail] blocked (APP_ENV=...): to=..., subject="...")`.
- Env vars: `APP_ENV` (set to `production` in the Vercel Production scope only; leave unset or
  `staging` on Preview), `ADMIN_EMAIL` (CC target, default `friscofencingacademy@gmail.com`),
  `LOGO_URL` (optional). See `docs/plans/deployment-launch-plan.md` §4a.

## Preview script

`backend/scripts/preview-emails.js` renders every registry key against `SAMPLE_DATA` to
`backend/email-preview/*.html` + `*.txt` + an `index.html` (gitignored — `email-preview/` is in
`.gitignore`). This is the QA loop for a hard-blocked staging environment: run it locally to see
every template rendered without ever sending real mail.

```bash
cd backend && node scripts/preview-emails.js
# open backend/email-preview/index.html
```
