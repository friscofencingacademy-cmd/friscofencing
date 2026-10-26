// ensureCustomer against the active provider's real test mode (never mocked).
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const User = require('../../src/models/user.model');
const { ensureCustomer } = require('../../src/services/paymentCustomer.service');
const { customerIdOf } = require('../testUtils/payments');
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

async function seedParent(email) {
  return User.create({ role: 'parent', firstName: 'Pay', lastName: 'Customer', email });
}

describe('ensureCustomer', () => {
  it('creates a provider customer the first time and persists its id on the user', async () => {
    const parent = await seedParent('pc-first@example.com');

    const customerId = await ensureCustomer(parent);

    expect(typeof customerId).toBe('string');
    expect(customerId.length).toBeGreaterThan(0);
    expect(await customerIdOf(parent._id)).toBe(customerId);
  }, 20000);

  it('returns the stored id without creating another customer once one exists', async () => {
    const parent = await seedParent('pc-reuse@example.com');
    const first = await ensureCustomer(parent);

    const reloaded = await User.findById(parent._id);
    const second = await ensureCustomer(reloaded);

    expect(second).toBe(first);
  }, 20000);

  it('creates a separate customer per parent', async () => {
    const one = await ensureCustomer(await seedParent('pc-one@example.com'));
    const two = await ensureCustomer(await seedParent('pc-two@example.com'));

    expect(one).not.toBe(two);
  }, 20000);
});
