const mongoose = require('mongoose');

const User = require('../../../src/models/user.model');
const PaymentMethod = require('../../../src/models/paymentMethod.model');
const Registration = require('../../../src/models/registration.model');
const WebhookEvent = require('../../../src/models/webhookEvent.model');
const { migrateProviderFields } = require('../../../scripts/lib/migrateProviderFields');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

afterEach(async () => {
  await clearTestDB();
  // Leave no index from one test behind for the next.
  for (const name of ['users', 'webhookevents']) {
    // eslint-disable-next-line no-await-in-loop
    await mongoose.connection.db.collection(name).dropIndexes().catch(() => {});
  }
});

const db = () => mongoose.connection.db;

// Documents and indexes exactly as they exist before the port's rename —
// written through the raw collections, since the models no longer know these
// field names.
async function seedPrePortData() {
  await db().collection('users').createIndex({ stripeCustomerId: 1 }, { unique: true, sparse: true, name: 'stripeCustomerId_1' });
  await db().collection('webhookevents').createIndex({ stripeEventId: 1 }, { unique: true, name: 'stripeEventId_1' });

  const parentId = new mongoose.Types.ObjectId();
  const nullCustomerId = new mongoose.Types.ObjectId();
  const noCustomerId = new mongoose.Types.ObjectId();
  await db().collection('users').insertMany([
    { _id: parentId, role: 'parent', firstName: 'Pat', lastName: 'Card', email: 'pat@example.com', stripeCustomerId: 'cus_real1' },
    { _id: nullCustomerId, role: 'parent', firstName: 'Nil', lastName: 'Value', email: 'nil@example.com', stripeCustomerId: null },
    { _id: noCustomerId, role: 'coach', firstName: 'No', lastName: 'Customer', email: 'coach@example.com' },
  ]);

  await db().collection('paymentmethods').insertOne({
    parentId,
    stripePaymentMethodId: 'pm_real1',
    cardBrand: 'visa',
    cardLast4: '4242',
    cardExpMonth: 12,
    cardExpYear: 2030,
  });

  const base = {
    serviceId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    parentId,
    billingShape: 'per_session',
    sessionId: new mongoose.Types.ObjectId(),
    enrollmentId: new mongoose.Types.ObjectId(),
    amount: 50,
    attempt: 1,
  };
  // Per-session ledger rows are unique per purchase and per session.
  const ownPurchase = () => ({ sessionId: new mongoose.Types.ObjectId(), enrollmentId: new mongoose.Types.ObjectId() });
  const charged = new mongoose.Types.ObjectId();
  const declinedNoPayment = new mongoose.Types.ObjectId();
  const manual = new mongoose.Types.ObjectId();
  await db().collection('registrations').insertMany([
    { ...base, _id: charged, status: 'completed', stripePaymentIntentId: 'pi_real1' },
    { ...base, ...ownPurchase(), _id: declinedNoPayment, status: 'failed', stripePaymentIntentId: null },
    { ...base, ...ownPurchase(), _id: manual, status: 'completed', chargeMethod: 'manual' },
  ]);

  await db().collection('webhookevents').insertOne({
    stripeEventId: 'evt_real1',
    type: 'payment_intent.succeeded',
    paymentIntentId: 'pi_real1',
    status: 'succeeded',
  });

  return { parentId, nullCustomerId, noCustomerId, charged, declinedNoPayment, manual };
}

const indexNames = async (collection) => (await db().collection(collection).indexes()).map((index) => index.name);

describe('migrateProviderFields', () => {
  it('dry run reports what it would change — correctly for the steps that depend on the rename — and writes nothing', async () => {
    const ids = await seedPrePortData();

    const report = await migrateProviderFields({ apply: false });

    expect(report.applied).toBe(false);
    expect(report.verified).toBeNull();
    expect(report.steps.map((step) => [step.label, step.matched, step.modified])).toEqual([
      ['users: stripeCustomerId -> providerCustomerId (+ paymentProvider stripe)', 1, 0],
      ['users: null stripeCustomerId removed', 1, 0],
      ['paymentmethods: stripePaymentMethodId -> providerPaymentMethodId (+ provider stripe)', 1, 0],
      ['registrations: stripePaymentIntentId -> providerPaymentId', 2, 0],
      ['registrations: provider stripe where a payment id is recorded', 1, 0],
      ['registrations: provider null where no payment id is recorded', 2, 0],
      [
        'webhookevents: stripeEventId -> providerEventId, paymentIntentId -> providerPaymentId (+ provider stripe)',
        1,
        0,
      ],
    ]);
    expect(report.indexesToDrop).toEqual(['users.stripeCustomerId_1', 'webhookevents.stripeEventId_1']);

    const user = await db().collection('users').findOne({ _id: ids.parentId });
    expect(user.stripeCustomerId).toBe('cus_real1');
    expect(user.providerCustomerId).toBeUndefined();
    expect(await indexNames('users')).toContain('stripeCustomerId_1');
  });

  it('live run renames every field, stamps the provider, swaps the indexes and verifies clean', async () => {
    const ids = await seedPrePortData();

    const report = await migrateProviderFields({ apply: true });

    expect(report.verified).toBe(true);
    expect(report.verification.every((item) => item.count === 0)).toBe(true);
    expect(report.indexesDropped).toEqual(['users.stripeCustomerId_1', 'webhookevents.stripeEventId_1']);

    const users = db().collection('users');
    expect(await users.findOne({ _id: ids.parentId })).toMatchObject({ paymentProvider: 'stripe', providerCustomerId: 'cus_real1' });
    const nullUser = await users.findOne({ _id: ids.nullCustomerId });
    expect(nullUser).not.toHaveProperty('stripeCustomerId');
    expect(nullUser).not.toHaveProperty('providerCustomerId');
    expect(nullUser).not.toHaveProperty('paymentProvider');
    expect(await users.findOne({ _id: ids.noCustomerId })).not.toHaveProperty('paymentProvider');

    const registrations = db().collection('registrations');
    expect(await registrations.findOne({ _id: ids.charged })).toMatchObject({ provider: 'stripe', providerPaymentId: 'pi_real1' });
    expect(await registrations.findOne({ _id: ids.declinedNoPayment })).toMatchObject({ provider: null, providerPaymentId: null });
    expect(await registrations.findOne({ _id: ids.manual })).toMatchObject({ provider: null, providerPaymentId: null });

    expect(await db().collection('webhookevents').findOne({})).toMatchObject({
      provider: 'stripe',
      providerEventId: 'evt_real1',
      providerPaymentId: 'pi_real1',
      type: 'payment_intent.succeeded',
    });

    const userIndexes = await indexNames('users');
    expect(userIndexes).not.toContain('stripeCustomerId_1');
    expect(userIndexes).toContain('providerCustomerId_1');
    const webhookIndexes = await indexNames('webhookevents');
    expect(webhookIndexes).not.toContain('stripeEventId_1');
    expect(webhookIndexes).toContain('provider_1_providerEventId_1');
  });

  it('leaves data the models read by the new names, with the new unique keys enforced', async () => {
    const ids = await seedPrePortData();
    await migrateProviderFields({ apply: true });

    expect((await User.findById(ids.parentId)).providerCustomerId).toBe('cus_real1');
    expect((await PaymentMethod.findOne({ parentId: ids.parentId })).toObject()).toMatchObject({
      provider: 'stripe',
      providerPaymentMethodId: 'pm_real1',
    });
    expect((await Registration.findById(ids.charged)).providerPaymentId).toBe('pi_real1');
    await expect(
      WebhookEvent.create({ provider: 'stripe', providerEventId: 'evt_real1', type: 'payment_intent.succeeded' })
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      User.create({ role: 'parent', firstName: 'Dup', lastName: 'Customer', email: 'dup@example.com', providerCustomerId: 'cus_real1' })
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('is idempotent: a second live run changes nothing and still verifies clean', async () => {
    await seedPrePortData();
    await migrateProviderFields({ apply: true });

    const second = await migrateProviderFields({ apply: true });

    expect(second.steps.every((step) => step.modified === 0)).toBe(true);
    expect(second.indexesDropped).toEqual([]);
    expect(second.verified).toBe(true);
  });

  it('runs cleanly on a database with nothing to migrate', async () => {
    const report = await migrateProviderFields({ apply: true });

    expect(report.steps.every((step) => step.matched === 0)).toBe(true);
    expect(report.verified).toBe(true);
  });
});
