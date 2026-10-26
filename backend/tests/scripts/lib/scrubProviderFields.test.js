const mongoose = require('mongoose');

const User = require('../../../src/models/user.model');
const PaymentMethod = require('../../../src/models/paymentMethod.model');
const { SubscriptionCycleRegistration } = require('../../../src/models/registration.model');
const { scrubProviderFields } = require('../../../scripts/lib/scrubProviderFields');
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
});

function baseRegistrationRow(overrides = {}) {
  return {
    serviceId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    parentId: new mongoose.Types.ObjectId(),
    subscriptionId: new mongoose.Types.ObjectId(),
    scheduleId: new mongoose.Types.ObjectId(),
    eventType: 'initial',
    status: 'completed',
    amount: 100,
    breakdown: { monthlyFee: 100 },
    periodStart: new Date('2026-02-01T00:00:00.000Z'),
    periodEnd: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('scrubProviderFields', () => {
  it('clears providerCustomerId off every User that has one, leaving users without one untouched', async () => {
    const withCustomer = await User.create({
      role: 'parent',
      firstName: 'Pat',
      lastName: 'Rivera',
      email: 'pat@example.com',
      paymentProvider: 'stripe',
      providerCustomerId: 'cus_real123',
    });
    const withoutCustomer = await User.create({
      role: 'parent',
      firstName: 'Sam',
      lastName: 'Lee',
      email: 'sam@example.com',
    });

    const result = await scrubProviderFields();

    expect(result.providerCustomerIdsCleared).toBe(1);

    const updated = await User.findById(withCustomer._id);
    expect(updated.providerCustomerId).toBeUndefined();
    expect(updated.paymentProvider).toBeUndefined();

    const unchanged = await User.findById(withoutCustomer._id);
    expect(unchanged.providerCustomerId).toBeUndefined();
  });

  it('deletes every PaymentMethod document', async () => {
    await PaymentMethod.create({
      parentId: new mongoose.Types.ObjectId(),
      provider: 'stripe',
      providerPaymentMethodId: 'pm_real123',
      cardBrand: 'visa',
      cardLast4: '4242',
      cardExpMonth: 12,
      cardExpYear: 2030,
    });

    const result = await scrubProviderFields();

    expect(result.paymentMethodsDeleted).toBe(1);
    expect(await PaymentMethod.countDocuments({})).toBe(0);
  });

  it('clears providerPaymentId off every Registration row that has one', async () => {
    const row = await SubscriptionCycleRegistration.create(
      baseRegistrationRow({ provider: 'stripe', providerPaymentId: 'pi_real123' })
    );
    const rowWithout = await SubscriptionCycleRegistration.create(baseRegistrationRow());

    const result = await scrubProviderFields();

    expect(result.providerPaymentIdsCleared).toBe(1);

    const updated = await SubscriptionCycleRegistration.findById(row._id);
    expect(updated.providerPaymentId).toBeNull();
    expect(updated.provider).toBeNull();

    const unchanged = await SubscriptionCycleRegistration.findById(rowWithout._id);
    expect(unchanged.providerPaymentId).toBeNull();
  });

  it('is a clean no-op (all-zero counts) when there is nothing to scrub', async () => {
    const result = await scrubProviderFields();

    expect(result).toEqual({
      providerCustomerIdsCleared: 0,
      paymentMethodsDeleted: 0,
      providerPaymentIdsCleared: 0,
    });
  });
});
