const mongoose = require('mongoose');

const PaymentMethod = require('../../src/models/paymentMethod.model');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

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

function baseCard(overrides = {}) {
  return {
    parentId: new mongoose.Types.ObjectId(),
    provider: 'stripe',
    providerPaymentMethodId: 'pm_1',
    cardBrand: 'visa',
    cardLast4: '4242',
    cardExpMonth: 12,
    cardExpYear: 2030,
    ...overrides,
  };
}

describe('PaymentMethod.provider', () => {
  it('saves a card that names a known provider', async () => {
    const card = await PaymentMethod.create(baseCard({ provider: 'square', providerPaymentMethodId: 'ccof:abc' }));

    expect(card.provider).toBe('square');
  });

  it('requires the provider — a card without one could never be matched to the active provider', async () => {
    await expect(PaymentMethod.create(baseCard({ provider: undefined }))).rejects.toThrow(/provider/);
  });

  it('rejects an unknown provider name', async () => {
    await expect(PaymentMethod.create(baseCard({ provider: 'paypal' }))).rejects.toThrow(/provider/);
  });

  it('requires the provider card id', async () => {
    await expect(PaymentMethod.create(baseCard({ providerPaymentMethodId: undefined }))).rejects.toThrow(
      /providerPaymentMethodId/
    );
  });
});
