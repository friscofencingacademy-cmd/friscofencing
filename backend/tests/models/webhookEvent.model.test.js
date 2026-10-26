const WebhookEvent = require('../../src/models/webhookEvent.model');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
  // The unique index must exist before the duplicate-insert case below.
  await WebhookEvent.syncIndexes();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

afterEach(async () => {
  await clearTestDB();
});

function baseEvent(overrides = {}) {
  return { provider: 'stripe', providerEventId: 'evt_1', type: 'payment_intent.succeeded', ...overrides };
}

describe('WebhookEvent dedup key (provider, providerEventId)', () => {
  it('rejects a second event with the same id from the same provider', async () => {
    await WebhookEvent.create(baseEvent());

    await expect(WebhookEvent.create(baseEvent())).rejects.toMatchObject({ code: 11000 });
  });

  it('accepts the same event id from a different provider — ids are only unique within one provider', async () => {
    await WebhookEvent.create(baseEvent());

    const other = await WebhookEvent.create(baseEvent({ provider: 'square', type: 'payment.updated' }));

    expect(other.provider).toBe('square');
    expect(await WebhookEvent.countDocuments({ providerEventId: 'evt_1' })).toBe(2);
  });

  it('requires a known provider', async () => {
    await expect(WebhookEvent.create(baseEvent({ provider: undefined }))).rejects.toThrow(/provider/);
    await expect(WebhookEvent.create(baseEvent({ provider: 'paypal' }))).rejects.toThrow(/provider/);
  });
});
