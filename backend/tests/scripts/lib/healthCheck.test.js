const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const { createSession } = require('../../testUtils/sessions');
const AuditRun = require('../../../src/models/auditRun.model');
const GroupClassSchedule = require('../../../src/models/groupClassSchedule.model');
const PaymentMethod = require('../../../src/models/paymentMethod.model');
const Registration = require('../../../src/models/registration.model');
const Service = require('../../../src/models/service.model');
const Subscription = require('../../../src/models/subscription.model');
const User = require('../../../src/models/user.model');
const { MAX_PAYMENT_RETRIES } = require('../../../src/config/billing');
const { seedServices } = require('../../../scripts/lib/seedServices');
const { seedAuditFixtures } = require('../../../scripts/lib/seedAuditFixtures');
const { freezeAt } = require('../../testUtils/clock');

const { collectHealth } = require('../../../scripts/lib/healthCheck');

// docs/plans/audit-and-health-refresh-plan.md PR 3. Clock pinned; `now` is
// also passed explicitly so every threshold is computed from a literal.
const NOW = new Date('2026-10-28T15:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(() => {
  freezeAt(NOW.toISOString());
});

afterEach(async () => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  await clearTestDB();
});

function health(options = {}) {
  return collectHealth({ now: NOW, activeProvider: 'stripe', ...options });
}

function byId(report, id) {
  return report.checks.find((c) => c.id === id);
}

function seedSchedule(overrides = {}) {
  return GroupClassSchedule.create({
    classId: new mongoose.Types.ObjectId(),
    coachId: new mongoose.Types.ObjectId(),
    dayOfWeek: 1,
    startTime: '18:00',
    endTime: '19:00',
    students: [],
    ...overrides,
  });
}

async function addUpcoming(schedule, count) {
  const mondays = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21'];
  await Promise.all(mondays.slice(0, count).map((iso) => createSession(schedule, new Date(`${iso}T00:00:00.000Z`))));
}

function subscriptionFixture(overrides = {}) {
  return {
    studentId: new mongoose.Types.ObjectId(),
    scheduleId: new mongoose.Types.ObjectId(),
    parentId: new mongoose.Types.ObjectId(),
    status: 'active',
    currentPeriodStart: new Date('2026-10-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z'),
    nextBillingDate: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('scripts/lib/healthCheck — collectHealth', () => {
  it('reports every check ok on a healthy database', async () => {
    await seedServices();
    const schedule = await seedSchedule();
    await addUpcoming(schedule, 8);

    const report = await health();

    expect(report.checks.map((c) => [c.id, c.status])).toEqual([
      ['sessions', 'ok'],
      ['services', 'ok'],
      ['legacy-payment-fields', 'ok'],
      ['inactive-provider-cards', 'ok'],
      ['stuck-pending', 'ok'],
      ['dunning', 'ok'],
      ['duplicate-subscriptions', 'ok'],
      ['orphaned-references', 'ok'],
      ['audit-fixtures', 'ok'],
      ['last-audit', 'ok'],
    ]);
    expect(report.summary).toEqual({ ok: 10, warn: 0, fail: 0 });
  });

  describe('sessions', () => {
    it('fails when a schedule has no upcoming session — past sessions do not count', async () => {
      await seedServices();
      const stocked = await seedSchedule();
      await addUpcoming(stocked, 8);
      const dry = await seedSchedule({ dayOfWeek: 3 });
      await createSession(dry, new Date('2026-10-21T00:00:00.000Z'));

      const check = byId(await health(), 'sessions');

      expect(check.status).toBe('fail');
      expect(check.detail).toContain('1 with NONE');
      expect(check.detail).toContain('npm run extend-sessions');
    });

    it('warns when a schedule is below half the horizon', async () => {
      await seedServices();
      const schedule = await seedSchedule();
      await addUpcoming(schedule, 3);

      expect(byId(await health(), 'sessions').status).toBe('warn');
    });

    it('warns when no schedule exists at all', async () => {
      expect(byId(await health(), 'sessions')).toMatchObject({ status: 'warn', detail: 'no group-class schedules exist' });
    });
  });

  describe('services', () => {
    it('fails when a service is missing or a live service is inactive, but not when a dormant one is active', async () => {
      await seedServices();
      await Service.updateOne({ code: 'camps' }, { isActive: true });

      expect(byId(await health(), 'services').status).toBe('ok');

      await Service.updateOne({ code: 'private-lessons' }, { isActive: false });
      await Service.deleteOne({ code: 'meets' });

      const check = byId(await health(), 'services');
      expect(check.status).toBe('fail');
      expect(check.detail).toContain('meets missing');
      expect(check.detail).toContain('private-lessons is inactive');
    });
  });

  it('fails on any legacy stripe* payment field left by the provider migration', async () => {
    await User.collection.insertOne({ role: 'parent', firstName: 'A', lastName: 'B', stripeCustomerId: 'cus_old' });

    const check = byId(await health(), 'legacy-payment-fields');

    expect(check.status).toBe('fail');
    expect(check.detail).toContain('1 users with stripeCustomerId');
  });

  it('warns about cards saved with a provider other than the active one', async () => {
    await PaymentMethod.create({
      parentId: new mongoose.Types.ObjectId(),
      provider: 'stripe',
      providerPaymentMethodId: 'pm_1',
      cardBrand: 'visa',
      cardLast4: '4242',
      cardExpMonth: 12,
      cardExpYear: 2030,
    });

    expect(byId(await health({ activeProvider: 'stripe' }), 'inactive-provider-cards').status).toBe('ok');
    expect(byId(await health({ activeProvider: 'square' }), 'inactive-provider-cards').status).toBe('warn');
  });

  it('fails on a pending ledger row older than a day, not on a fresh one', async () => {
    const base = {
      serviceId: new mongoose.Types.ObjectId(),
      studentId: new mongoose.Types.ObjectId(),
      parentId: new mongoose.Types.ObjectId(),
      status: 'pending',
      amount: 100,
      billingShape: 'subscription_cycle',
    };
    await Registration.collection.insertOne({ ...base, createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) });

    expect(byId(await health(), 'stuck-pending').status).toBe('ok');

    await Registration.collection.insertOne({ ...base, createdAt: new Date(NOW.getTime() - 2 * DAY) });

    const check = byId(await health(), 'stuck-pending');
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('1 row(s)');
  });

  it('warns about an active subscription whose retries are exhausted', async () => {
    await Subscription.create(subscriptionFixture({ retryCount: MAX_PAYMENT_RETRIES - 1 }));
    expect(byId(await health(), 'dunning').status).toBe('ok');

    await Subscription.create(subscriptionFixture({ retryCount: MAX_PAYMENT_RETRIES }));
    expect(byId(await health(), 'dunning').status).toBe('warn');
  });

  it('fails when a student has two active subscriptions (Guard A bypassed)', async () => {
    const studentId = new mongoose.Types.ObjectId();
    // Raw inserts — the model's unique index would (correctly) refuse the second.
    await Subscription.collection.dropIndexes().catch(() => undefined);

    try {
      await Subscription.collection.insertMany([subscriptionFixture({ studentId }), subscriptionFixture({ studentId })]);

      expect(byId(await health(), 'duplicate-subscriptions').status).toBe('fail');
    } finally {
      await Subscription.deleteMany({});
      await Subscription.syncIndexes();
    }
  });

  describe('live-audit checks', () => {
    it('on staging, fails without the fixtures and without any audit run', async () => {
      const report = await health({ expectAuditFixtures: true });

      expect(byId(report, 'audit-fixtures').status).toBe('fail');
      expect(byId(report, 'last-audit')).toMatchObject({ status: 'fail' });
    });

    it('on staging, passes with fixtures and a recent passing run, warns when stale, fails when it failed', async () => {
      await seedServices();
      await seedAuditFixtures({ testPassword: 'pw-123456' });
      const run = {
        auditName: 'audit-live-registration',
        overall: 'pass',
        scenarios: [],
        summary: '6/6 scenarios passed.',
        startedAt: NOW,
        finishedAt: NOW,
      };
      const recent = await AuditRun.create(run);
      await AuditRun.collection.updateOne({ _id: recent._id }, { $set: { createdAt: new Date(NOW.getTime() - 3 * DAY) } });

      let report = await health({ expectAuditFixtures: true });
      expect(byId(report, 'audit-fixtures').status).toBe('ok');
      expect(byId(report, 'last-audit').status).toBe('ok');

      await AuditRun.collection.updateOne({ _id: recent._id }, { $set: { createdAt: new Date(NOW.getTime() - 20 * DAY) } });
      report = await health({ expectAuditFixtures: true });
      expect(byId(report, 'last-audit').status).toBe('warn');

      await AuditRun.collection.updateOne({ _id: recent._id }, { $set: { createdAt: NOW, overall: 'fail' } });
      report = await health({ expectAuditFixtures: true });
      expect(byId(report, 'last-audit').status).toBe('fail');
    });

    it('on production, missing fixtures and no audit run are expected, not failures', async () => {
      const report = await health({ expectAuditFixtures: false });

      expect(byId(report, 'audit-fixtures').status).toBe('ok');
      expect(byId(report, 'last-audit').status).toBe('ok');
    });
  });

  it('never writes: no create, save, update or delete on any model', async () => {
    await seedServices();
    const schedule = await seedSchedule();
    await addUpcoming(schedule, 8);

    const writes = [
      jest.spyOn(mongoose.Model, 'create'),
      jest.spyOn(mongoose.Model, 'insertMany'),
      jest.spyOn(mongoose.Model, 'updateOne'),
      jest.spyOn(mongoose.Model, 'updateMany'),
      jest.spyOn(mongoose.Model, 'findOneAndUpdate'),
      jest.spyOn(mongoose.Model, 'deleteOne'),
      jest.spyOn(mongoose.Model, 'deleteMany'),
      jest.spyOn(mongoose.Model, 'bulkWrite'),
      jest.spyOn(mongoose.Model.prototype, 'save'),
    ];

    await health({ expectAuditFixtures: true });

    writes.forEach((spy) => expect(spy).not.toHaveBeenCalled());

    // The spies really intercept a model write (so the assertion above can fail).
    await Service.updateOne({ code: 'meets' }, { name: 'Meets' });
    expect(writes[2]).toHaveBeenCalled();
  });

  it('requires the active provider name', async () => {
    await expect(collectHealth({ now: NOW })).rejects.toThrow('activeProvider is required');
  });
});
