const AuditRun = require('../../src/models/auditRun.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const GroupClassSession = require('../../src/models/groupClassSession.model');
const PaymentMethod = require('../../src/models/paymentMethod.model');
const Registration = require('../../src/models/registration.model');
const Service = require('../../src/models/service.model');
const Subscription = require('../../src/models/subscription.model');
const User = require('../../src/models/user.model');
const { SESSION_COUNT } = require('../../src/services/groupClassSession.service');
const { MAX_PAYMENT_RETRIES } = require('../../src/config/billing');
const { CANONICAL_SERVICES } = require('./seedServices');
const { findDuplicateActiveSubscriptions } = require('./findDuplicateActiveSubscriptions');
const { findOrphanedReferences } = require('./findOrphanedReferences');
const { AUDIT_FAMILIES, AUDIT_LEVELS } = require('./seedAuditFixtures');

// Read-only data health report for one environment
// (docs/plans/audit-and-health-refresh-plan.md PR 3) — the data half of the
// `/health` skill. Never writes: only find/count/aggregate, and the reused
// diagnostics are themselves read-only. Each check returns
// { id, label, status: 'ok' | 'warn' | 'fail', detail }.
//
// Thresholds are named here, in one place:
const DAY_MS = 24 * 60 * 60 * 1000;
// A schedule with fewer upcoming sessions than this is running low: the
// weekly extension should keep it at SESSION_COUNT.
const LOW_SESSION_THRESHOLD = SESSION_COUNT / 2;
// A pending ledger row is a charge whose outcome was never recorded; one
// older than a day means a crash nothing has recovered.
const STUCK_PENDING_MS = DAY_MS;
// The services the app writes ledger rows and Visits for today. Whether a
// dormant service (camps, meets) is active is owner state, never checked.
const REQUIRED_ACTIVE_SERVICE_CODES = ['group-classes', 'private-lessons'];
// The live audit runs weekly; two missed weeks is stale.
const AUDIT_STALE_MS = 14 * DAY_MS;

// Fields the payment-provider migration removed (docs/decisions/013) — read
// through the raw collections, since the models no longer declare them.
const LEGACY_PAYMENT_FIELDS = [
  { collection: () => Registration.collection, field: 'stripePaymentIntentId', label: 'registrations' },
  { collection: () => PaymentMethod.collection, field: 'stripePaymentMethodId', label: 'payment methods' },
  { collection: () => User.collection, field: 'stripeCustomerId', label: 'users' },
];

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

async function checkSessions(now) {
  const schedules = await GroupClassSchedule.find({}, '_id').lean();

  if (schedules.length === 0) {
    return check('sessions', 'Upcoming group sessions', 'warn', 'no group-class schedules exist');
  }

  const counts = await GroupClassSession.aggregate([
    { $match: { scheduleId: { $in: schedules.map((s) => s._id) }, startsAt: { $gt: now } } },
    { $group: { _id: '$scheduleId', upcoming: { $sum: 1 } } },
  ]);
  const upcomingBySchedule = new Map(counts.map((entry) => [String(entry._id), entry.upcoming]));
  const perSchedule = schedules.map((s) => upcomingBySchedule.get(String(s._id)) || 0);

  const empty = perSchedule.filter((count) => count === 0).length;
  const low = perSchedule.filter((count) => count > 0 && count < LOW_SESSION_THRESHOLD).length;
  const detail =
    `${schedules.length} schedule(s); fewest upcoming: ${Math.min(...perSchedule)}` +
    (empty > 0 ? `; ${empty} with NONE` : '') +
    (low > 0 ? `; ${low} below ${LOW_SESSION_THRESHOLD}` : '') +
    (empty + low > 0 ? ' — run `npm run extend-sessions -- --live`' : '');

  if (empty > 0) return check('sessions', 'Upcoming group sessions', 'fail', detail);
  if (low > 0) return check('sessions', 'Upcoming group sessions', 'warn', detail);
  return check('sessions', 'Upcoming group sessions', 'ok', detail);
}

async function checkServices() {
  const services = await Service.find({}, 'code isActive').lean();
  const byCode = new Map(services.map((service) => [service.code, service]));
  const problems = [];

  CANONICAL_SERVICES.forEach(({ code }) => {
    const actual = byCode.get(code);
    if (!actual) problems.push(`${code} missing`);
    else if (REQUIRED_ACTIVE_SERVICE_CODES.includes(code) && !actual.isActive) problems.push(`${code} is inactive`);
  });

  return problems.length > 0
    ? check('services', 'Service registry', 'fail', `${problems.join('; ')} — run \`npm run seed:services\``)
    : check('services', 'Service registry', 'ok', `${CANONICAL_SERVICES.length} services, as seeded`);
}

async function checkLegacyPaymentFields() {
  const leftovers = [];

  for (const { collection, field, label } of LEGACY_PAYMENT_FIELDS) {
    // eslint-disable-next-line no-await-in-loop -- three counts.
    const count = await collection().countDocuments({ [field]: { $exists: true } });
    if (count > 0) leftovers.push(`${count} ${label} with ${field}`);
  }

  return leftovers.length > 0
    ? check('legacy-payment-fields', 'Payment-provider migration', 'fail', `${leftovers.join('; ')} — run scripts/migrate-provider-fields.js`)
    : check('legacy-payment-fields', 'Payment-provider migration', 'ok', 'no legacy stripe* fields');
}

async function checkInactiveProviderCards(activeProvider) {
  const count = await PaymentMethod.countDocuments({ provider: { $ne: activeProvider } });

  return count > 0
    ? check('inactive-provider-cards', `Saved cards on a provider other than "${activeProvider}"`, 'warn', `${count} card(s) — those families must add a card again`)
    : check('inactive-provider-cards', `Saved cards on a provider other than "${activeProvider}"`, 'ok', 'none');
}

async function checkStuckPending(now) {
  const cutoff = new Date(now.getTime() - STUCK_PENDING_MS);
  const rows = await Registration.find({ status: 'pending', createdAt: { $lt: cutoff } }, '_id billingShape createdAt').lean();

  return rows.length > 0
    ? check(
        'stuck-pending',
        'Ledger rows stuck in pending',
        'fail',
        `${rows.length} row(s) pending for over a day: ${rows.slice(0, 5).map((row) => `${row._id} (${row.billingShape})`).join(', ')}`
      )
    : check('stuck-pending', 'Ledger rows stuck in pending', 'ok', 'none');
}

// An ACTIVE subscription whose retries are exhausted should have been
// cancelled by the retry run (renewal.service.js cancel-after-exhaustion);
// one still active means retries are not being run or a cancel failed.
async function checkDunning() {
  const count = await Subscription.countDocuments({ status: 'active', retryCount: { $gte: MAX_PAYMENT_RETRIES } });

  return count > 0
    ? check('dunning', 'Subscriptions at retry exhaustion', 'warn', `${count} active subscription(s) with retryCount >= ${MAX_PAYMENT_RETRIES} — run \`npm run renewals\``)
    : check('dunning', 'Subscriptions at retry exhaustion', 'ok', 'none');
}

async function checkDuplicateActiveSubscriptions() {
  const { duplicates } = await findDuplicateActiveSubscriptions();

  return duplicates.length > 0
    ? check('duplicate-subscriptions', 'One active subscription per student', 'fail', `${duplicates.length} student(s) with more than one`)
    : check('duplicate-subscriptions', 'One active subscription per student', 'ok', 'holds');
}

async function checkOrphanedReferences() {
  const { orphans } = await findOrphanedReferences();

  return orphans.length > 0
    ? check('orphaned-references', 'Private-lesson references resolve', 'fail', `${orphans.length} orphaned reference(s) — run scripts/find-orphaned-references.js`)
    : check('orphaned-references', 'Private-lesson references resolve', 'ok', 'all resolve');
}

async function checkAuditFixtures(expectAuditFixtures) {
  const parents = await User.countDocuments({ role: 'parent', email: { $in: AUDIT_FAMILIES.map((family) => family.email) } });
  const classes = await GroupClass.countDocuments({ name: { $in: AUDIT_LEVELS.map((level) => level.groupClass) } });
  const present = parents === AUDIT_FAMILIES.length && classes === AUDIT_LEVELS.length;
  const detail = `${parents}/${AUDIT_FAMILIES.length} audit parents, ${classes}/${AUDIT_LEVELS.length} audit classes`;

  if (present) return check('audit-fixtures', 'Live-audit fixtures', 'ok', detail);
  return check(
    'audit-fixtures',
    'Live-audit fixtures',
    expectAuditFixtures ? 'fail' : 'ok',
    expectAuditFixtures ? `${detail} — run \`npm run audit:seed\`` : `${detail} (not expected in this environment)`
  );
}

async function checkLastAuditRun(now, expectAuditFixtures) {
  const latest = await AuditRun.findOne({ auditName: 'audit-live-registration' }).sort({ createdAt: -1 }).lean();

  if (!expectAuditFixtures) {
    return check('last-audit', 'Last live audit', 'ok', latest ? `${latest.createdAt.toISOString()} ${latest.overall}` : 'never (runs on staging only)');
  }
  if (!latest) {
    return check('last-audit', 'Last live audit', 'fail', 'never run — see docs/plans/audit-and-health-refresh-plan.md §7.4');
  }

  const ageDays = Math.floor((now.getTime() - latest.createdAt.getTime()) / DAY_MS);
  const detail = `${latest.createdAt.toISOString().slice(0, 10)} (${ageDays} day(s) ago) — ${latest.overall}: ${latest.summary}`;

  if (latest.overall !== 'pass') return check('last-audit', 'Last live audit', 'fail', detail);
  if (now.getTime() - latest.createdAt.getTime() > AUDIT_STALE_MS) return check('last-audit', 'Last live audit', 'warn', `${detail} — stale`);
  return check('last-audit', 'Last live audit', 'ok', detail);
}

/**
 * @param {{ now?: Date, activeProvider: string, expectAuditFixtures?: boolean }} options
 *   expectAuditFixtures: true on staging, where the live audit runs.
 */
async function collectHealth({ now = new Date(), activeProvider, expectAuditFixtures = false }) {
  if (!activeProvider) {
    throw new Error('collectHealth: activeProvider is required');
  }

  const checks = [
    await checkSessions(now),
    await checkServices(),
    await checkLegacyPaymentFields(),
    await checkInactiveProviderCards(activeProvider),
    await checkStuckPending(now),
    await checkDunning(),
    await checkDuplicateActiveSubscriptions(),
    await checkOrphanedReferences(),
    await checkAuditFixtures(expectAuditFixtures),
    await checkLastAuditRun(now, expectAuditFixtures),
  ];

  const summary = {
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };

  return { checks, summary };
}

module.exports = {
  collectHealth,
  LOW_SESSION_THRESHOLD,
  STUCK_PENDING_MS,
  AUDIT_STALE_MS,
  REQUIRED_ACTIVE_SERVICE_CODES,
};
