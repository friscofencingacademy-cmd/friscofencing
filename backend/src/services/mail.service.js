const nodemailer = require('nodemailer');

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
async function sendMailSafely({ to, subject, text, html }) {
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

    const result = await transporter.sendMail({
      from: FROM_ADDRESS(),
      to,
      subject,
      text,
      html,
    });

    return result || true;
  } catch (error) {
    // eslint-disable-next-line no-console -- operational logging for a
    // fire-and-forget email side effect, not debug output.
    console.error(`mail.service: failed to send "${subject}" to ${to}:`, error.message);
    return false;
  }
}

async function sendTrialConfirmationEmail({ parent, student, session }) {
  const sessionDate = session && session.date ? new Date(session.date).toDateString() : 'the scheduled date';

  const subject = `Trial class confirmed for ${student.firstName}`;
  const text =
    `Hi ${parent.firstName},\n\n` +
    `${student.firstName}'s trial class is confirmed for ${sessionDate}.\n\n` +
    `We look forward to seeing you at Frisco Fencing Academy!`;
  const html =
    `<p>Hi ${parent.firstName},</p>` +
    `<p><strong>${student.firstName}'s</strong> trial class is confirmed for <strong>${sessionDate}</strong>.</p>` +
    `<p>We look forward to seeing you at Frisco Fencing Academy!</p>`;

  return sendMailSafely({ to: parent.email, subject, text, html });
}

async function sendRegistrationConfirmationEmail({
  parent,
  student,
  schedule,
  chargeAmount,
  siblingDiscountApplied,
}) {
  const subject = `Registration confirmed for ${student.firstName}`;
  const discountLine = siblingDiscountApplied
    ? '\nA 10% sibling discount was applied to this charge.'
    : '';
  const discountHtml = siblingDiscountApplied
    ? '<p>A 10% sibling discount was applied to this charge.</p>'
    : '';

  const text =
    `Hi ${parent.firstName},\n\n` +
    `${student.firstName} is registered! We charged $${chargeAmount} for the first billing period.${discountLine}\n\n` +
    `Welcome to Frisco Fencing Academy!`;
  const html =
    `<p>Hi ${parent.firstName},</p>` +
    `<p><strong>${student.firstName}</strong> is registered! We charged <strong>$${chargeAmount}</strong> for the first billing period.</p>` +
    `${discountHtml}` +
    `<p>Welcome to Frisco Fencing Academy!</p>`;

  return sendMailSafely({ to: parent.email, subject, text, html });
}

async function sendRenewalReceiptEmail({ parent, student, schedule, chargeAmount, siblingDiscountApplied }) {
  const subject = `Renewal receipt for ${student.firstName}`;
  const discountLine = siblingDiscountApplied
    ? '\nA 10% sibling discount was applied to this charge.'
    : '';
  const discountHtml = siblingDiscountApplied
    ? '<p>A 10% sibling discount was applied to this charge.</p>'
    : '';

  const text =
    `Hi ${parent.firstName},\n\n` +
    `${student.firstName}'s class was renewed. We charged $${chargeAmount} for the new billing period.${discountLine}\n\n` +
    `Thank you for continuing with Frisco Fencing Academy!`;
  const html =
    `<p>Hi ${parent.firstName},</p>` +
    `<p><strong>${student.firstName}'s</strong> class was renewed. We charged <strong>$${chargeAmount}</strong> for the new billing period.</p>` +
    `${discountHtml}` +
    `<p>Thank you for continuing with Frisco Fencing Academy!</p>`;

  return sendMailSafely({ to: parent.email, subject, text, html });
}

module.exports = {
  getTransporter,
  sendTrialConfirmationEmail,
  sendRegistrationConfirmationEmail,
  sendRenewalReceiptEmail,
};
