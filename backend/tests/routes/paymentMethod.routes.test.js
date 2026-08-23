process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// STRIPE_SECRET_KEY must be loaded from the real .env BEFORE app.js (and
// therefore src/config/stripe.js) is required below — this test hits
// Stripe's real TEST-mode API over the network rather than mocking the
// Stripe SDK (see paymentMethod.routes.test.js spec: Stripe explicitly
// designs test mode for exactly this kind of real integration testing).
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const PaymentMethod = require('../../src/models/paymentMethod.model');
const stripe = require('../../src/config/stripe');
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

// Mints a fresh, real Stripe TEST-mode PaymentMethod via Stripe's documented
// `tok_visa` test token, ready to be attached to a customer. A PaymentMethod
// can only ever be attached once, so every test that needs one calls this
// fresh rather than sharing a single id.
async function mintTestPaymentMethodId() {
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' },
  });

  return paymentMethod.id;
}

// Stripe's documented decline-card TOKEN (maps to card number
// 4000000000000002) — NOT a raw card number: this Stripe account has raw
// server-side card-data APIs disabled (confirmed live, not assumed — a
// first attempt using the raw number here was rejected outright with
// "Sending credit card numbers directly to the Stripe API is generally
// unsafe... To enable testing raw card data APIs, see..."), same as any
// standard account. The token represents the identical underlying test
// card the live browser audit used via Stripe.js — only the creation
// mechanism differs, not which card/decline behavior is exercised.
// Confirmed live that this card declines at attach() itself, not only at
// charge time — unlike registration.routes.test.js's pm_card_chargeDeclined,
// a shared pre-built PaymentMethod that only declines when actually
// charged. Creating the PaymentMethod object here succeeds; attaching it
// is what fails, matching real behavior exactly.
async function mintDeclineTestPaymentMethodId() {
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_chargeDeclined' },
  });

  return paymentMethod.id;
}

describe('PaymentMethod routes', () => {
  describe('POST /api/v1/payment-methods', () => {
    it('creates a Stripe Customer and saves the card on first save', async () => {
      const parent = await seedUser({ role: 'parent', email: 'pm-parent1@example.com' });
      const parentAgent = await loginAgent('pm-parent1@example.com');

      const stripePaymentMethodId = await mintTestPaymentMethodId();

      const res = await parentAgent.post('/api/v1/payment-methods').send({ stripePaymentMethodId });

      expect(res.status).toBe(201);
      expect(res.body.paymentMethod).toMatchObject({
        cardBrand: 'visa',
        cardLast4: '4242',
      });
      expect(res.body.paymentMethod.cardExpMonth).toBeGreaterThanOrEqual(1);
      expect(res.body.paymentMethod.cardExpYear).toBeGreaterThan(2020);

      const updatedUser = await User.findById(parent._id);
      expect(updatedUser.stripeCustomerId).toBeTruthy();
      expect(updatedUser.stripeCustomerId).toMatch(/^cus_/);

      const savedDoc = await PaymentMethod.findOne({ parentId: parent._id });
      expect(savedDoc).not.toBeNull();
      expect(savedDoc.stripePaymentMethodId).toBe(stripePaymentMethodId);
    }, 20000);

    it('replaces the existing card when a parent saves a second one', async () => {
      const parent = await seedUser({ role: 'parent', email: 'pm-parent2@example.com' });
      const parentAgent = await loginAgent('pm-parent2@example.com');

      const firstPaymentMethodId = await mintTestPaymentMethodId();
      const firstRes = await parentAgent
        .post('/api/v1/payment-methods')
        .send({ stripePaymentMethodId: firstPaymentMethodId });
      expect(firstRes.status).toBe(201);

      const secondPaymentMethodId = await mintTestPaymentMethodId();
      const secondRes = await parentAgent
        .post('/api/v1/payment-methods')
        .send({ stripePaymentMethodId: secondPaymentMethodId });
      expect(secondRes.status).toBe(201);

      // Still exactly one doc for this parent (unique index), pointing at
      // the new card, not the old one.
      const docs = await PaymentMethod.find({ parentId: parent._id });
      expect(docs).toHaveLength(1);
      expect(docs[0].stripePaymentMethodId).toBe(secondPaymentMethodId);
      expect(docs[0].stripePaymentMethodId).not.toBe(firstPaymentMethodId);

      // Nice-to-have: confirm the old PaymentMethod was actually detached
      // from the Stripe customer, not left orphaned/attached.
      const oldOnStripe = await stripe.paymentMethods.retrieve(firstPaymentMethodId);
      expect(oldOnStripe.customer).toBeNull();
    }, 30000);

    it(
      'returns 402 and creates nothing when the card is declined at save time (attach, not charge)',
      async () => {
        const parent = await seedUser({ role: 'parent', email: 'pm-decline1@example.com' });
        const parentAgent = await loginAgent('pm-decline1@example.com');

        const declinePaymentMethodId = await mintDeclineTestPaymentMethodId();

        const res = await parentAgent
          .post('/api/v1/payment-methods')
          .send({ stripePaymentMethodId: declinePaymentMethodId });

        expect(res.status).toBe(402);
        expect(res.body.message).toBeTruthy();

        // Pin down exactly where the failure happens: ensureStripeCustomer
        // runs BEFORE the attach and succeeds regardless — only the attach
        // itself fails.
        const updatedUser = await User.findById(parent._id);
        expect(updatedUser.stripeCustomerId).toBeTruthy();
        expect(updatedUser.stripeCustomerId).toMatch(/^cus_/);

        expect(await PaymentMethod.countDocuments({ parentId: parent._id })).toBe(0);

        // Verify on Stripe's own side too, not just our DB — the attach was
        // genuinely rejected, not silently no-opped.
        const onStripe = await stripe.paymentMethods.retrieve(declinePaymentMethodId);
        expect(onStripe.customer).toBeNull();
      },
      20000
    );

    it('returns 403 when a non-parent role attempts to save a card', async () => {
      await seedUser({ role: 'admin', email: 'pm-admin1@example.com' });
      const adminAgent = await loginAgent('pm-admin1@example.com');

      const stripePaymentMethodId = await mintTestPaymentMethodId();

      const res = await adminAgent
        .post('/api/v1/payment-methods')
        .send({ stripePaymentMethodId });

      expect(res.status).toBe(403);
    }, 20000);
  });

  describe('GET /api/v1/payment-methods/mine', () => {
    it("returns the parent's saved card", async () => {
      await seedUser({ role: 'parent', email: 'pm-parent3@example.com' });
      const parentAgent = await loginAgent('pm-parent3@example.com');

      const stripePaymentMethodId = await mintTestPaymentMethodId();
      await parentAgent.post('/api/v1/payment-methods').send({ stripePaymentMethodId });

      const res = await parentAgent.get('/api/v1/payment-methods/mine');

      expect(res.status).toBe(200);
      expect(res.body.paymentMethod).toMatchObject({
        cardBrand: 'visa',
        cardLast4: '4242',
      });
    }, 20000);

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
