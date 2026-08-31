// pdfkit's built-in fonts (Helvetica, etc.) load through a dynamic subpath
// import (`#standard-fonts/*`, resolved via pdfkit's own package.json
// `imports` map + a runtime-created `require`) that Vercel's build-time file
// tracer cannot follow statically — it never bundles those files into the
// deployed serverless function on its own, even though pdfkit itself is a
// real, listed dependency. This shipped once already: production/staging
// threw `Cannot find module '.../pdfkit/js/standard-fonts/Helvetica.cjs'` on
// every invoice download, invisible to the Jest suite (which runs against a
// real, complete node_modules on disk, not a Vercel bundle). Fixed by
// `backend/vercel.json`'s `functions["api/index.js"].includeFiles` glob,
// which force-includes `node_modules/pdfkit/js/standard-fonts/**` regardless
// of what the tracer can see. `pdfkit` is pinned to an EXACT version in
// package.json (no `^`) because that glob targets this version's specific
// internal file layout — pdfkit has already restructured how it ships
// standard fonts once before (older versions read raw `.afm` files directly
// via `fs`, this version embeds them as `.cjs` modules instead), and an
// unpinned bump could silently move the files the glob targets with zero
// test coverage catching it (this whole failure mode is Vercel-bundling-only
// and structurally invisible to Jest). Bumping pdfkit requires re-verifying
// this glob still matches a real path, via a real deploy, not just tests.
const PDFDocument = require('pdfkit');

const Registration = require('../models/registration.model');
const User = require('../models/user.model');
const Service = require('../models/service.model');
const GroupClassSchedule = require('../models/groupClassSchedule.model');
const GroupClass = require('../models/groupClass.model');
const Location = require('../models/location.model');
const PrivateClassSession = require('../models/privateClassSession.model');
const { sessionDurationMinutes } = require('../utils/privateClassPricing');
const { dateFull, dateOnlyFull } = require('../email/dates');
const academy = require('../config/academy');

// docs/plans/manual-charge-and-pdf-invoice-plan.md, PR 2 — the invoice PDF
// draws entirely from one immutable, completed Registration ledger row
// (ADR 004). Split into data-assembly (this file's buildInvoiceData, unit-
// testable without parsing PDF binary) and rendering (renderInvoicePdf) so
// field logic and layout can be verified independently.

function conflictError(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function fullName(user) {
  if (!user) return '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ');
}

function formatMoney(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

// D9 — a real Location when the group-class chain resolves, the academy's
// own address otherwise (deleted schedule/class/location, OR a per_session
// row, which has no location field of its own at all). Never throws.
function academyFallbackLocation() {
  return { name: academy.name, addressLines: academy.addressLines };
}

async function resolveGroupClassLocation(scheduleId) {
  const schedule = scheduleId ? await GroupClassSchedule.findById(scheduleId) : null;
  const groupClass = schedule ? await GroupClass.findById(schedule.classId) : null;
  const location = groupClass ? await Location.findById(groupClass.locationId) : null;

  return {
    className: groupClass ? groupClass.name : '',
    location: location ? { name: location.name, addressLines: [location.address] } : academyFallbackLocation(),
  };
}

const EVENT_TYPE_DESCRIPTIONS = {
  initial: 'Group Class Registration',
  renewal: 'Group Class Monthly Renewal',
  legacy: 'Group Class Charge',
};

async function buildSubscriptionCycleData(row) {
  const { className, location } = await resolveGroupClassLocation(row.scheduleId);
  const { breakdown } = row;

  const baseAmount = breakdown.prorated ? breakdown.proratedAmount : breakdown.monthlyFee;
  const baseLabel = breakdown.prorated
    ? `${className || 'Group class'} — prorated monthly fee`
    : `${className || 'Group class'} — monthly fee`;

  const lineItems = [{ label: baseLabel, amount: baseAmount }];

  if (breakdown.siblingDiscountApplied) {
    lineItems.push({ label: 'Sibling discount (10%)', amount: -breakdown.siblingDiscountAmount });
  }

  if (breakdown.registrationFeeCharged > 0) {
    lineItems.push({ label: 'Registration fee', amount: breakdown.registrationFeeCharged });
  }

  return {
    serviceLabel: EVENT_TYPE_DESCRIPTIONS[row.eventType] || 'Group Class Charge',
    location,
    lineItems,
    // periodStart/periodEnd are calendar-day sentinels, not real instants
    // (docs/plans/utc-date-standard-plan.md) — dateOnlyFull renders them
    // UTC-anchored, never dateFull (Central), which would shift a period
    // boundary onto the wrong calendar day on the invoice.
    periodLabel: `${dateOnlyFull(row.periodStart)} – ${dateOnlyFull(row.periodEnd)}`,
  };
}

async function buildPerSessionData(row) {
  const session = row.sessionId ? await PrivateClassSession.findById(row.sessionId) : null;
  const coach = session ? await User.findById(session.coachId) : null;
  const durationMinutes = session ? sessionDurationMinutes(session.startDate, session.endDate) : null;

  const coachLabel = coach ? `with ${fullName(coach)}` : '';
  const durationLabel = durationMinutes != null ? `${durationMinutes} min` : '';
  const sessionDateLabel = session ? dateFull(session.startDate) : '';

  return {
    serviceLabel: 'Private Lesson Session',
    // Private lessons have no Location of their own (D9) — always the
    // academy's own address.
    location: academyFallbackLocation(),
    lineItems: [
      {
        label: [`Private lesson`, coachLabel, durationLabel && `— ${durationLabel}`].filter(Boolean).join(' '),
        amount: row.amount,
      },
    ],
    periodLabel: sessionDateLabel,
  };
}

// Accepts any COMPLETED Registration ledger row (either discriminator, or a
// plain id) and resolves everything the PDF needs. Never recomputes `total`
// — it is always `row.amount`, the immutable record of what was actually
// charged (Hard Rule 7), regardless of whether the line items above happen
// to sum to it exactly (they always should, but the total is never derived
// FROM them).
async function buildInvoiceData(registrationRowOrId) {
  // Duck-typed rather than an instanceof check — a hydrated Mongoose
  // discriminator document always carries its own `status`; a bare id
  // (string or ObjectId) never does.
  const row =
    registrationRowOrId && registrationRowOrId.status !== undefined
      ? registrationRowOrId
      : await Registration.findById(registrationRowOrId);

  if (!row) {
    throw notFoundError('Registration not found');
  }

  if (row.status !== 'completed') {
    throw conflictError('No invoice exists for an unpaid charge');
  }

  const [parent, student, service] = await Promise.all([
    User.findById(row.parentId),
    User.findById(row.studentId),
    Service.findById(row.serviceId),
  ]);

  const shapeData =
    row.billingShape === 'per_session' ? await buildPerSessionData(row) : await buildSubscriptionCycleData(row);

  // Method-aware line (docs/plans/payment-airtight-plan.md D9) — a manual
  // recording is only possible on a subscription_cycle row (per_session
  // rows never go through recordManualPayment), but this reads
  // `row.chargeMethod` directly rather than branching on billingShape, so
  // it degrades correctly either way. `!== 'manual'` (not `=== 'card'`) on
  // purpose — a row created before this field existed reads back as
  // `undefined` and must still render as a card charge, no migration
  // needed for this field (see the schema's own comment).
  const paymentMethodLabel =
    row.chargeMethod === 'manual'
      ? `Payment recorded by the academy${row.manualNote ? ` — ${row.manualNote}` : ''}.`
      : 'Charged to card on file.';

  return {
    invoiceNumber: `INV-${row._id}`,
    invoiceDate: row.paidAt,
    billTo: {
      parentName: fullName(parent),
      parentEmail: parent ? parent.email : '',
      studentName: fullName(student),
    },
    serviceName: service ? service.name : '',
    total: row.amount,
    paymentMethodLabel,
    academy,
    ...shapeData,
  };
}

// Pure layout, no DB access — a Buffer collected off the doc's own stream,
// no filesystem writes (serverless-safe). Never throws for a missing
// optional field; every value read below already has a safe default from
// buildInvoiceData above.
function renderInvoicePdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(data.academy.name);
    doc.fontSize(10);
    data.academy.addressLines.forEach((line) => doc.text(line));
    if (data.academy.phone) doc.text(data.academy.phone);
    if (data.academy.email) doc.text(data.academy.email);
    doc.text(`EIN: ${data.academy.ein}`);

    doc.moveDown();
    doc.fontSize(16).text('INVOICE', { align: 'right' });
    doc.fontSize(10);
    doc.text(`Invoice #: ${data.invoiceNumber}`, { align: 'right' });
    doc.text(`Date: ${data.invoiceDate ? dateFull(data.invoiceDate) : ''}`, { align: 'right' });

    doc.moveDown();
    doc.fontSize(12).text('Bill To');
    doc.fontSize(10);
    doc.text(data.billTo.parentName || '');
    if (data.billTo.parentEmail) doc.text(data.billTo.parentEmail);
    doc.text(`Student: ${data.billTo.studentName || ''}`);

    doc.moveDown();
    doc.fontSize(12).text(data.serviceLabel);
    doc.fontSize(10).text(data.location.name);
    data.location.addressLines.forEach((line) => doc.text(line));
    if (data.periodLabel) doc.text(data.periodLabel);

    doc.moveDown();
    data.lineItems.forEach((item) => {
      doc.fontSize(10).text(`${item.label}: ${formatMoney(item.amount)}`);
    });

    doc.moveDown();
    doc.fontSize(14).text(`Total: ${formatMoney(data.total)}`, { align: 'right' });

    doc.moveDown();
    doc
      .fontSize(10)
      .text(`Paid${data.invoiceDate ? ` on ${dateFull(data.invoiceDate)}` : ''} — thank you.`);
    if (data.paymentMethodLabel) doc.text(data.paymentMethodLabel);

    doc.end();
  });
}

// Convenience — fetch (if given an id) + build + render in one call.
async function generateInvoicePdf(registrationRowOrId) {
  const data = await buildInvoiceData(registrationRowOrId);
  return renderInvoicePdf(data);
}

module.exports = { buildInvoiceData, renderInvoicePdf, generateInvoicePdf };
