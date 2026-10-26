const { login } = require('./login');

// P0 — checks every precondition the scenarios depend on BEFORE any of them
// runs (docs/plans/audit-and-health-refresh-plan.md D6). Without it, a missing
// fixture, an empty session table, an unseeded Service registry or a missing
// publishable key each surfaced as six unrelated Playwright timeouts.
//
// Read-only: one login and GETs only, all through the staging frontend's own
// /api/v1/* proxy (the path a real browser takes, so the login cookie is
// sent — see staging-guard.js). This package never talks to the database.
//
// Every check runs and contributes its own reason; the caller reports them
// all at once.

const AUDIT_PARENT_EMAIL = 'audit-parent-1@example.com';
const AUDIT_CLASS_NAMES = ['Audit Class A', 'Audit Class B'];
const AUDIT_STUDENT_LAST_NAME = 'ChildOne';

async function getJson(context, url) {
  const res = await context.request.get(url);
  let body = null;

  try {
    body = await res.json();
  } catch {
    body = null;
  }

  return { status: res.status(), body };
}

async function runPreflight(context, config) {
  const reasons = [];
  const api = `${config.stagingUrl}/api/v1`;
  const page = await context.newPage();

  try {
    // (b) first — public, so it is meaningful even if login fails.
    const paymentConfig = await getJson(context, `${api}/payments/config`);
    if (paymentConfig.status !== 200 || !paymentConfig.body || !paymentConfig.body.provider) {
      reasons.push(
        `GET /payments/config returned ${paymentConfig.status} — the backend has no payment public config ` +
          '(set STRIPE_PUBLISHABLE_KEY on the backend Preview env)'
      );
    }

    // (a) the seeded audit accounts exist and accept the audit password.
    try {
      await login(page, config.stagingUrl, AUDIT_PARENT_EMAIL, config.testPassword);
    } catch {
      reasons.push(`login as ${AUDIT_PARENT_EMAIL} failed — run \`npm run audit:seed\` in backend/`);
      return { ok: false, reasons };
    }

    // (c) both audit classes exist.
    const classes = await getJson(context, `${api}/group-classes`);
    const auditClasses = AUDIT_CLASS_NAMES.map((name) =>
      ((classes.body && classes.body.groupClasses) || []).find((groupClass) => groupClass.name === name)
    );
    AUDIT_CLASS_NAMES.forEach((name, i) => {
      if (!auditClasses[i]) reasons.push(`"${name}" not found — run \`npm run audit:seed\` in backend/`);
    });

    // (d) each audit class has an upcoming session to book.
    const sessionsByClass = [];
    for (const groupClass of auditClasses.filter(Boolean)) {
      // eslint-disable-next-line no-await-in-loop -- two classes, sequential.
      const sessions = await getJson(context, `${api}/group-class-sessions/by-class/${groupClass._id}`);
      const list = (sessions.body && sessions.body.sessions) || [];
      sessionsByClass.push({ groupClass, sessions: list });
      if (list.length === 0) {
        reasons.push(
          `no upcoming sessions for "${groupClass.name}" — run \`npm run extend-sessions -- --live\` (or \`npm run audit:seed\`) on staging`
        );
      }
    }

    // (e) the live price preview works end to end — a 500 here is almost
    // always the Service registry not seeded on this database.
    const students = await getJson(context, `${api}/students/mine`);
    const child = ((students.body && students.body.students) || []).find(
      (student) => student.lastName === AUDIT_STUDENT_LAST_NAME
    );
    const firstBookable = sessionsByClass.find((entry) => entry.sessions.length > 0);

    if (!child) {
      reasons.push(`audit student "${AUDIT_STUDENT_LAST_NAME}" not found — run \`npm run audit:seed\` in backend/`);
    } else if (firstBookable) {
      const session = firstBookable.sessions[0];
      const query = new URLSearchParams({
        studentId: child._id,
        scheduleId: session.scheduleId._id,
        startDate: session.date,
      });
      const preview = await getJson(context, `${api}/registrations/preview?${query}`);
      // The preview never refuses an already-registered child (it only
      // prices), so anything but 200 is a real backend problem.
      if (preview.status !== 200) {
        reasons.push(
          `GET /registrations/preview returned ${preview.status}` +
            (preview.status >= 500 ? ' — is the Service registry seeded? (`npm run seed:services` in backend/)' : '') +
            (preview.body && preview.body.message ? `: ${preview.body.message}` : '')
        );
      }
    }
  } finally {
    await page.close();
  }

  return { ok: reasons.length === 0, reasons };
}

module.exports = { runPreflight };
