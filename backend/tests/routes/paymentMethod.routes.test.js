process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// The payment provider's credentials must be loaded from the real .env BEFORE
// app.js is required below — this suite hits the active provider's real TEST
// mode over the network rather than mocking its SDK (docs/TESTING_STRATEGY.md
// Mocking rules), through tests/testUtils/payments.js only.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const PaymentMethod = require('../../src/models/paymentMethod.model');
const { mintCardToken, successCardDetails, listCustomerCards } = require('../testUtils/payments');
const { hashPassword } = require('../../src/utils/password');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

const TEST_PASSWORD = 'correct-password';

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

async function seedUser(overrides = {}) {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  return User.create({
    firstName: 'Test',
    lastName: 'User',
    passwordHash,
    ...overrides,
  });
}

async function loginAgent(email) {
  const agent = request.agent(app);

  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });

  return agent;
}

describe('PaymentMethod routes', () => {
  describe('POST /api/v1/payment-methods', () => {
    it('creates a provider customer and saves the card on first save', async () => {
      const parent = await seedUser({ role: 'parent', email: 'pm-parent1@example.com' });
      const parentAgent = await loginAgent('pm-parent1@example.com');

      const paymentMethodToken = await mintCardToken('success');

      const res = await parentAgent.post('/api/v1/payment-methods').send({ paymentMethodToken });

      expect(res.status).toBe(201);
      const card = successCardDetails();
      expect(res.body.paymentMethod).toMatchObject({
        cardBrand: card.brand,
        cardLast4: card.last4,
      });
      expect(res.body.paymentMethod.cardExpMonth).toBeGreaterThanOrEqual(1);
      expect(res.body.paymentMethod.cardExpYear).toBeGreaterThan(2020);

      const updatedUser = await User.findById(parent._id);
      expect(typeof updatedUser.providerCustomerId).toBe('string');
      expect(updatedUser.providerCustomerId.length).toBeGreaterThan(0);

      // The stored card is the one actually attached to this parent's own
      // provider customer — and the only one.
      const savedDoc = await PaymentMethod.findOne({ parentId: parent._id });
      expect(savedDoc).not.toBeNull();
      expect(savedDoc.provider).toBe('stripe');
      expect(updatedUser.paymentProvider).toBe('stripe');
      expect(await listCustomerCards(parent._id)).toEqual([savedDoc.providerPaymentMethodId]);
    }, 20000);

    it('replaces the existing card when a parent saves a second one', async () => {
      const parent = await seedUser({ role: 'parent', email: 'pm-parent2@example.com' });
      const parentAgent = await loginAgent('pm-parent2@example.com');

      const firstRes = await parentAgent
        .post('/api/v1/payment-methods')
        .send({ paymentMethodToken: await mintCardToken('success') });
      expect(firstRes.status).toBe(201);
      const firstCardId = (await PaymentMethod.findOne({ parentId: parent._id })).providerPaymentMethodId;

      const secondRes = await parentAgent
        .post('/api/v1/payment-methods')
        .send({ paymentMethodToken: await mintCardToken('success') });
      expect(secondRes.status).toBe(201);

      // Still exactly one doc for this parent (unique index), pointing at
      // the new card, not the old one.
      const docs = await PaymentMethod.find({ parentId: parent._id });
      expect(docs).toHaveLength(1);
      expect(docs[0].providerPaymentMethodId).not.toBe(firstCardId);

      // The old card was actually detached from the provider customer, not
      // left orphaned: only the new card is attached.
      expect(await listCustomerCards(parent._id)).toEqual([docs[0].providerPaymentMethodId]);
    }, 30000);

    it(
      'returns 402 and creates nothing when the card is declined at save time (attach, not charge)',
      async () => {
        const parent = await seedUser({ role: 'parent', email: 'pm-decline1@example.com' });
        const parentAgent = await loginAgent('pm-decline1@example.com');

        const declinePaymentMethodId = await mintCardToken('declineAtAttach');

        const res = await parentAgent
          .post('/api/v1/payment-methods')
          .send({ paymentMethodToken: declinePaymentMethodId });

        expect(res.status).toBe(402);
        expect(res.body.message).toBeTruthy();

        // Pin down exactly where the failure happens: ensureCustomer
        // runs BEFORE the attach and succeeds regardless — only the attach
        // itself fails.
        const updatedUser = await User.findById(parent._id);
        expect(typeof updatedUser.providerCustomerId).toBe('string');

        expect(await PaymentMethod.countDocuments({ parentId: parent._id })).toBe(0);

        // Verify on the provider's own side too, not just our DB — the attach
        // was genuinely rejected, not silently no-opped.
        expect(await listCustomerCards(parent._id)).toEqual([]);
      },
      20000
    );

    it('replaces a card saved with a provider that is no longer active, without calling that provider (plan D7)', async () => {
      const parent = await seedUser({ role: 'parent', email: 'pm-switched@example.com' });
      await PaymentMethod.create({
        parentId: parent._id,
        provider: 'square',
        providerPaymentMethodId: 'ccof:card-from-the-previous-provider',
        cardBrand: 'MASTERCARD',
        cardLast4: '9999',
        cardExpMonth: 1,
        cardExpYear: 2031,
      });
      const parentAgent = await loginAgent('pm-switched@example.com');

      // The old card's id is not a Stripe id, so any detach call on the
      // active provider for it would fail the request — a 201 proves none was made.
      const res = await parentAgent.post('/api/v1/payment-methods').send({ paymentMethodToken: await mintCardToken('success') });

      expect(res.status).toBe(201);
      const docs = await PaymentMethod.find({ parentId: parent._id });
      expect(docs).toHaveLength(1);
      expect(docs[0].provider).toBe('stripe');
      expect(await listCustomerCards(parent._id)).toEqual([docs[0].providerPaymentMethodId]);
    }, 30000);

    it('returns 400 and saves nothing when no paymentMethodToken is sent', async () => {
      const parent = await seedUser({ role: 'parent', email: 'pm-notoken@example.com' });
      const parentAgent = await loginAgent('pm-notoken@example.com');

      const res = await parentAgent.post('/api/v1/payment-methods').send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('paymentMethodToken is required');
      expect(await PaymentMethod.countDocuments({ parentId: parent._id })).toBe(0);
    });

    it('returns 403 when a non-parent role attempts to save a card', async () => {
      await seedUser({ role: 'admin', email: 'pm-admin1@example.com' });
      const adminAgent = await loginAgent('pm-admin1@example.com');

      const paymentMethodToken = await mintCardToken('success');

      const res = await adminAgent
        .post('/api/v1/payment-methods')
        .send({ paymentMethodToken });

      expect(res.status).toBe(403);
    }, 20000);
  });

  describe('GET /api/v1/payment-methods/mine', () => {
    it("returns the parent's saved card", async () => {
      await seedUser({ role: 'parent', email: 'pm-parent3@example.com' });
      const parentAgent = await loginAgent('pm-parent3@example.com');

      const paymentMethodToken = await mintCardToken('success');
      await parentAgent.post('/api/v1/payment-methods').send({ paymentMethodToken });

      const res = await parentAgent.get('/api/v1/payment-methods/mine');

      expect(res.status).toBe(200);
      const card = successCardDetails();
      expect(res.body.paymentMethod).toMatchObject({
        cardBrand: card.brand,
        cardLast4: card.last4,
      });
    }, 20000);

    it('returns null for a card saved with a provider that is no longer active — "no card on file" (plan D7)', async () => {
      const parent = await seedUser({ role: 'parent', email: 'pm-inactive@example.com' });
      await PaymentMethod.create({
        parentId: parent._id,
        provider: 'square',
        providerPaymentMethodId: 'ccof:inactive-provider-card',
        cardBrand: 'VISA',
        cardLast4: '1111',
        cardExpMonth: 1,
        cardExpYear: 2031,
      });
      const parentAgent = await loginAgent('pm-inactive@example.com');

      const res = await parentAgent.get('/api/v1/payment-methods/mine');

      expect(res.status).toBe(200);
      expect(res.body.paymentMethod).toBeNull();
      // Kept, never deleted — switching back makes it usable again.
      expect(await PaymentMethod.countDocuments({ parentId: parent._id })).toBe(1);
    });

    it('returns null when the parent has no saved card yet', async () => {
      await seedUser({ role: 'parent', email: 'pm-parent4@example.com' });
      const parentAgent = await loginAgent('pm-parent4@example.com');

      const res = await parentAgent.get('/api/v1/payment-methods/mine');

      expect(res.status).toBe(200);
      expect(res.body.paymentMethod).toBeNull();
    });

    it('returns 403 when a non-parent role calls it', async () => {
      await seedUser({ role: 'coach', email: 'pm-coach1@example.com' });
      const coachAgent = await loginAgent('pm-coach1@example.com');

      const res = await coachAgent.get('/api/v1/payment-methods/mine');

      expect(res.status).toBe(403);
    });
  });
});
