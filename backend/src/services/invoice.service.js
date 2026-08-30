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

    doc.end();
  });
}

// Convenience — fetch (if given an id) + build + render in one call.
async function generateInvoicePdf(registrationRowOrId) {
  const data = await buildInvoiceData(registrationRowOrId);
  return renderInvoicePdf(data);
}

module.exports = { buildInvoiceData, renderInvoicePdf, generateInvoicePdf };
