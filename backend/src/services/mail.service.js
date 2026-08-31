const nodemailer = require('nodemailer');
const { renderEmail } = require('../email');
const { dateFull, dateOnlyFull, timeOfDay, dayOfWeekLabel } = require('../email/dates');
const { MAX_PAYMENT_RETRIES } = require('../config/billing');

// Lazy, memoized module-level cache — created once per process. If
// SMTP_HOST is configured, we build a real transporter from the SMTP_*
// env vars. If not (the supported zero-setup local dev path), we mint a
// free Ethereal test account on first use and log its credentials so
// whatever gets "sent" during local dev can be viewed at
// https://ethereal.email without signing up for any real email provider.
let transporterPromise = null;

async function buildTransporter() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  const testAccount = await nodemailer.createTestAccount();

  // Operational logging, not debug output: this is the only way to find
  // the generated Ethereal inbox credentials for a local dev run.
  // eslint-disable-next-line no-console
  console.log(
    `No SMTP_HOST configured — using an Ethereal test account for local dev email.\n` +
      `View sent emails at https://ethereal.email using:\n` +
      `  user: ${testAccount.user}\n` +
      `  pass: ${testAccount.pass}`
  );

  return nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
}

function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = buildTransporter();
  }

  return transporterPromise;
}

const FROM_ADDRESS = () => process.env.MAIL_FROM_ADDRESS || 'noreply@friscofencing.local';
const ADMIN_EMAIL = () => process.env.ADMIN_EMAIL || 'friscofencingacademy@gmail.com';

// Staging email gate (fail-closed): anything other than APP_ENV=production
// blocks real SMTP sends. Ethereal (no SMTP_HOST) is exempt — it never
// delivers to a real inbox and is the local-dev preview loop; blocking it
// too would break the zero-setup local dev path for no safety benefit.
// Mirrors CKQ's Brevo X-Sib-Sandbox design applied to a Nodemailer
// transport: render everything (so staging still exercises the full
// message-building path), then skip only the final transport.sendMail call.
// Read at call time, never captured at module load — the test suite uses
// jest.resetModules() and toggles process.env.APP_ENV between cases.
const isEmailBlocked = () =>
  Boolean(process.env.SMTP_HOST) && process.env.APP_ENV !== 'production';

// Hard contract: every send* function below catches its own errors,
// logs them, and returns false — it must NEVER throw. Email is a
// fire-and-forget side effect of an operation that has already
// successfully committed to the database (a trial booking, a
// registration, a renewal charge); a mail failure must never make an
// otherwise-successful operation look like it failed to its caller.
// `attachments` (optional) is passed through verbatim to nodemailer's own
// shape: [{ filename, content: Buffer, contentType }]. Added for PDF
// invoices (docs/plans/manual-charge-and-pdf-invoice-plan.md PR 2) — no
// other call site needs to change, since this param is optional and simply
// omitted (never an empty array, which nodemailer would still accept fine,
// but omitting matches every OTHER optional field's convention here).
async function sendMailSafely({ to, cc, subject, text, html, attachments }) {
  try {
    // Gate checked AFTER the caller has already built the full message (the
    // subject/text/html arguments above are already assembled) so staging
    // still exercises every bit of render logic — only the real network send
    // is skipped. A deliberate block is not a failure: { blocked: true } is
    // truthy, matching every call site's "truthy == sent" contract.
    if (isEmailBlocked()) {
      // eslint-disable-next-line no-console -- operational logging: the
      // only visibility into a blocked staging send.
      console.warn(
        `[mail] blocked (APP_ENV=${process.env.APP_ENV || 'unset'}): to=${to}, subject="${subject}"`
      );
      return { blocked: true };
    }

    const transporter = await getTransporter();

    // Filter out any falsy cc entry (e.g. a coach with no email on file) —
    // nodemailer would otherwise send a literal "undefined" recipient.
    const ccList = (cc || []).filter(Boolean);

    const result = await transporter.sendMail({
      from: FROM_ADDRESS(),
      to,
      ...(ccList.length ? { cc: ccList } : {}),
      subject,
      text,
      html,
      ...(attachments && attachments.length ? { attachments } : {}),
    });

    return result || true;
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error(`mail.service: failed to send "${subject}" to ${to}:`, error.message);
    return false;
  }
}

function fullName(user) {
  if (!user) return '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ');
}

// Shared by the three receipt senders below that can carry an invoice PDF
// (docs/plans/manual-charge-and-pdf-invoice-plan.md PR 2). `invoicePdf` is
// undefined whenever the caller's own PDF generation failed or wasn't
// attempted — this returns undefined in that case too, so sendMailSafely's
// spread (`...(attachments && attachments.length ? ... : {})`) omits the
// field entirely rather than sending an empty array.
function invoiceAttachment(invoiceNumber, invoicePdf) {
  if (!invoicePdf) return undefined;

  return [{ filename: `${invoiceNumber}.pdf`, content: invoicePdf, contentType: 'application/pdf' }];
}

function scheduleLabel(schedule) {
  // Guard on startTime/endTime specifically (not just truthy `schedule`) —
  // timeOfDay() feeds an "HH:mm" string into Intl.DateTimeFormat, which
  // throws RangeError: Invalid time value on a missing/malformed one. A
  // real GroupClassSchedule always has both; a minimal test fixture or a
  // not-yet-populated ref must degrade to '' instead of crashing the send.
  if (!schedule || !schedule.startTime || !schedule.endTime) return '';
  return `${dayOfWeekLabel(schedule.dayOfWeek)}, ${timeOfDay(schedule.startTime)} - ${timeOfDay(schedule.endTime)}`;
}

// ── Group class ──────────────────────────────────────────────────────────

async function sendTrialConfirmationEmail({ parent, student, session, schedule, groupClass, level, location, coach }) {
  try {
    // session.date is a calendar-day sentinel, not a real instant
    // (docs/plans/utc-date-standard-plan.md) — dateOnlyFull renders it
    // UTC-anchored. Using dateFull (Central) here was the original,
    // real-shipped instance of this bug: a Monday trial's confirmation
    // email stated "Sunday."
    const whenLabel = [
      session && session.date ? dateOnlyFull(session.date) : null,
      schedule ? timeOfDay(schedule.startTime) : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const data = {
      studentName: fullName(student),
      className: groupClass ? groupClass.name : '',
      levelName: level ? level.name : '',
      coachName: fullName(coach),
      whenLabel: whenLabel || 'the scheduled date',
      locationName: location ? location.name : '',
    };

    const { subject, html, text } = renderEmail('trialConfirmation', data);

    return sendMailSafely({
      to: parent.email,
      cc: [ADMIN_EMAIL(), coach && coach.email],
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error('mail.service: failed to build trialConfirmation email:', error.message);
    return false;
  }
}

async function sendTrialEvaluationEmail({ parent, student, coach, level, notes }) {
  try {
    const data = {
      studentName: fullName(student),
      coachName: fullName(coach),
      levelName: level ? level.name : '',
      notes: notes || '',
    };

    const { subject, html, text } = renderEmail('trialEvaluation', data);

    return sendMailSafely({
      to: parent.email,
      cc: [ADMIN_EMAIL()],
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error('mail.service: failed to build trialEvaluation email:', error.message);
    return false;
  }
}

async function sendRegistrationConfirmationEmail({
  parent,
  student,
  schedule,
  groupClass,
  level,
  location,
  coach,
  chargeAmount,
  monthlyFee,
  siblingDiscountAmount,
  registrationFeeCharged,
  prorated,
  totalClassDays,
  remainingClassDays,
  invoiceNumber,
  invoicePdf,
}) {
  try {
    const firstClassDateLabel = schedule ? dayOfWeekLabel(schedule.dayOfWeek) : '';

    const data = {
      studentName: fullName(student),
      className: groupClass ? groupClass.name : '',
      levelName: level ? level.name : '',
      coachName: fullName(coach),
      scheduleLabel: scheduleLabel(schedule),
      locationName: location ? location.name : '',
      monthlyFee,
      siblingDiscountAmount: siblingDiscountAmount || 0,
      registrationFeeCharged: registrationFeeCharged || 0,
      prorated: prorated || false,
      totalClassDays: totalClassDays || 0,
      remainingClassDays: remainingClassDays || 0,
      chargeAmount,
      firstClassDateLabel: firstClassDateLabel ? `next ${firstClassDateLabel}` : 'your next scheduled class',
    };

    const { subject, html, text } = renderEmail('registrationConfirmation', data);

    return sendMailSafely({
      to: parent.email,
      cc: [ADMIN_EMAIL(), coach && coach.email],
      subject,
      text,
      html,
      attachments: invoiceAttachment(invoiceNumber, invoicePdf),
    });
  } catch (error) {
    console.error('mail.service: failed to build registrationConfirmation email:', error.message);
    return false;
  }
}

async function sendRenewalReceiptEmail({
  parent,
  student,
  schedule,
  groupClass,
  monthLabel,
  chargeAmount,
  monthlyFee,
  siblingDiscountAmount,
  paymentMethodLabel,
  invoiceNumber,
  invoicePdf,
}) {
  try {
    const data = {
      studentName: fullName(student),
      className: groupClass ? groupClass.name : '',
      monthLabel: monthLabel || '',
      billingPeriodLabel: monthLabel || '',
      monthlyFee,
      siblingDiscountAmount: siblingDiscountAmount || 0,
      chargeAmount,
      paymentMethodLabel: paymentMethodLabel || 'Charged to your saved card.',
    };

    const { subject, html, text } = renderEmail('renewalReceipt', data);

    return sendMailSafely({
      to: parent.email,
      subject,
      text,
      html,
      attachments: invoiceAttachment(invoiceNumber, invoicePdf),
    });
  } catch (error) {
    console.error('mail.service: failed to build renewalReceipt email:', error.message);
    return false;
  }
}

// Renewal/retry payment failure (docs/plans/registration-ledger-plan.md
// D4/D6). Same template, three renderings driven by isFinal/attemptNumber —
// see templates.js's own comment on the 'paymentFailure' entry. Admin-only
// CC (no coach) — matches sendPrivateClassPaymentFailedEmail's precedent: a
// billing/parent-account matter, not the coach's concern.
async function sendPaymentFailureEmail({ parent, student, schedule, groupClass, amountDue, attemptNumber, isFinal, nextRetryDate }) {
  try {
    const data = {
      studentName: fullName(student),
      className: groupClass ? groupClass.name : '',
      amountDueLabel: amountDue != null ? `$${Number(amountDue).toFixed(2)}` : '',
      attemptNumber: attemptNumber || 1,
      maxAttempts: MAX_PAYMENT_RETRIES,
      isFinal: Boolean(isFinal),
      nextRetryDateLabel: nextRetryDate ? dateFull(nextRetryDate) : '',
      subjectPrefix: isFinal ? 'Subscription cancelled' : 'Payment failed',
      preheaderLine: isFinal
        ? 'Your subscription has been cancelled after repeated payment failures.'
        : "We couldn't charge your saved card — please update your payment method.",
    };

    const { subject, html, text } = renderEmail('paymentFailure', data);

    return sendMailSafely({ to: parent.email, cc: [ADMIN_EMAIL()], subject, text, html });
  } catch (error) {
    console.error('mail.service: failed to build paymentFailure email:', error.message);
    return false;
  }
}

async function sendCancellationConfirmationEmail({ parent, student, groupClass, schedule, coach, endDate }) {
  try {
    // endDate is Subscription.currentPeriodEnd — a calendar-day sentinel,
    // not a real instant (docs/plans/utc-date-standard-plan.md).
    const data = {
      studentName: fullName(student),
      className: groupClass ? groupClass.name : '',
      scheduleLabel: scheduleLabel(schedule),
      endDateLabel: endDate ? dateOnlyFull(endDate) : '',
    };

    const { subject, html, text } = renderEmail('cancellationConfirmation', data);

    // Deliberately no admin CC — matches CKQ's pattern for this template.
    return sendMailSafely({ to: parent.email, cc: [coach && coach.email], subject, text, html });
  } catch (error) {
    console.error('mail.service: failed to build cancellationConfirmation email:', error.message);
    return false;
  }
}

async function sendReactivationConfirmationEmail({ parent, student, groupClass, schedule, nextBillingDate }) {
  try {
    // nextBillingDate is Subscription.nextBillingDate — a calendar-day
    // sentinel, not a real instant (docs/plans/utc-date-standard-plan.md).
    const data = {
      studentName: fullName(student),
      className: groupClass ? groupClass.name : '',
      scheduleLabel: scheduleLabel(schedule),
      nextBillingDateLabel: nextBillingDate ? dateOnlyFull(nextBillingDate) : '',
    };

    const { subject, html, text } = renderEmail('reactivationConfirmation', data);

    return sendMailSafely({ to: parent.email, subject, text, html });
  } catch (error) {
    console.error('mail.service: failed to build reactivationConfirmation email:', error.message);
    return false;
  }
}

async function sendScheduleChangeConfirmationEmail({ parent, student, old, next }) {
  try {
    const data = {
      studentName: fullName(student),
      previousClassName: old && old.groupClass ? old.groupClass.name : '',
      previousScheduleLabel: old ? scheduleLabel(old.schedule) : '',
      newClassName: next && next.groupClass ? next.groupClass.name : '',
      newScheduleLabel: next ? scheduleLabel(next.schedule) : '',
      newCoachName: next ? fullName(next.coach) : '',
    };

    const { subject, html, text } = renderEmail('scheduleChangeConfirmation', data);

    return sendMailSafely({
      to: parent.email,
      cc: [next && next.coach && next.coach.email],
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error('mail.service: failed to build scheduleChangeConfirmation email:', error.message);
    return false;
  }
}

// ── Private class ─────────────────────────────────────────────────────────

async function sendPrivateClassConfirmationEmail({
  parent,
  student,
  coach,
  slotLabel,
  rateLabel,
  firstSessionDate,
  sessionPriceLabel,
}) {
  try {
    const data = {
      studentName: fullName(student),
      coachName: fullName(coach),
      slotLabel: slotLabel || '',
      rateLabel: rateLabel || '',
      firstSessionDateLabel: firstSessionDate ? dateFull(firstSessionDate) : '',
      sessionPriceLabel: sessionPriceLabel || '',
    };

    const { subject, html, text } = renderEmail('privateClassConfirmation', data);

    return sendMailSafely({
      to: parent.email,
      cc: [ADMIN_EMAIL(), coach && coach.email],
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error('mail.service: failed to build privateClassConfirmation email:', error.message);
    return false;
  }
}

async function sendPrivateClassSessionReceiptEmail({
  parent,
  student,
  coach,
  sessionDate,
  durationMinutes,
  amount,
  invoiceNumber,
  invoicePdf,
}) {
  try {
    const data = {
      studentName: fullName(student),
      coachName: fullName(coach),
      sessionDateLabel: sessionDate ? dateFull(sessionDate) : '',
      durationLabel: durationMinutes != null ? `${durationMinutes} min` : '',
      amountLabel: amount != null ? `$${Number(amount).toFixed(2)}` : '',
    };

    const { subject, html, text } = renderEmail('privateClassSessionReceipt', data);

    return sendMailSafely({
      to: parent.email,
      cc: [ADMIN_EMAIL()],
      subject,
      text,
      html,
      attachments: invoiceAttachment(invoiceNumber, invoicePdf),
    });
  } catch (error) {
    console.error('mail.service: failed to build privateClassSessionReceipt email:', error.message);
    return false;
  }
}

async function sendPrivateClassPaymentFailedEmail({ parent, student, sessionDate, amount, paymentMethodUrl }) {
  try {
    const data = {
      studentName: fullName(student),
      sessionDateLabel: sessionDate ? dateFull(sessionDate) : '',
      amountLabel: amount != null ? `$${Number(amount).toFixed(2)}` : '',
      paymentMethodUrl,
    };

    const { subject, html, text } = renderEmail('privateClassPaymentFailed', data);

    return sendMailSafely({ to: parent.email, cc: [ADMIN_EMAIL()], subject, text, html });
  } catch (error) {
    console.error('mail.service: failed to build privateClassPaymentFailed email:', error.message);
    return false;
  }
}

async function sendPrivateClassCancellationEmail({ parent, student, coach, slotLabel }) {
  try {
    const data = {
      studentName: fullName(student),
      coachName: fullName(coach),
      slotLabel: slotLabel || '',
    };

    const { subject, html, text } = renderEmail('privateClassCancellation', data);

    return sendMailSafely({
      to: parent.email,
      cc: [ADMIN_EMAIL(), coach && coach.email],
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error('mail.service: failed to build privateClassCancellation email:', error.message);
    return false;
  }
}

module.exports = {
  getTransporter,
  sendTrialConfirmationEmail,
  sendTrialEvaluationEmail,
  sendRegistrationConfirmationEmail,
  sendRenewalReceiptEmail,
  sendPaymentFailureEmail,
  sendCancellationConfirmationEmail,
  sendReactivationConfirmationEmail,
  sendScheduleChangeConfirmationEmail,
  sendPrivateClassConfirmationEmail,
  sendPrivateClassSessionReceiptEmail,
  sendPrivateClassPaymentFailedEmail,
  sendPrivateClassCancellationEmail,
};
