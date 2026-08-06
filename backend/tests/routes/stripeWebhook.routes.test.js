// Dummy signing secret — signature verification is pure local HMAC
// crypto (sign with this value, verify with the same value), so this test
// suite never makes a real network call to Stripe, unlike the PaymentIntent
// charge tests in earlier phases (registration.routes.test.js,
// paymentMethod.routes.test.js) which hit Stripe's real TEST-mode API.
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy_secret';

const request = require('supertest');

const app = require('../../src/app');
const stripe = require('../../src/config/stripe');
const WebhookEvent = require('../../src/models/webhookEvent.model');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');

const WEBHOOK_PATH = '/api/v1/webhooks/stripe';

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

function buildEvent(overrides = {}) {
  return {
    id: 'evt_test_123',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_test_123',
        status: 'succeeded',
      },
    },
    ...overrides,
  };
}

// Signs `event` (JSON.stringify'd) with generateTestHeaderString, the
// documented Stripe SDK testing utility for constructing a validly-signed
// `stripe-signature` header offline against a shared secret — no network
// call involved.
function signedRequest(event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });

  return request(app)
    .post(WEBHOOK_PATH)
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(payload);
}

describe('POST /api/v1/webhooks/stripe', () => {
  it('records a payment_intent.succeeded event and responds 200', async () => {
    const event = buildEvent();

    const res = await signedRequest(event);

    expect(res.status).toBe(200);

    const stored = await WebhookEvent.findOne({ stripeEventId: event.id });
    expect(stored).not.toBeNull();
    expect(stored.type).toBe('payment_intent.succeeded');
    expect(stored.paymentIntentId).toBe('pi_test_123');
    expect(stored.status).toBe('succeeded');
  });

  it('is a safe no-op on redelivery of the same event id (dedup)', async () => {
    const event = buildEvent();

    const firstRes = await signedRequest(event);
    expect(firstRes.status).toBe(200);

    const secondRes = await signedRequest(event);
    expect(secondRes.status).toBe(200);

    const count = await WebhookEvent.countDocuments({ stripeEventId: event.id });
    expect(count).toBe(1);
  });

  it('records a payment_intent.payment_failed event and responds 200', async () => {
    const event = buildEvent({
      id: 'evt_test_failed_123',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_test_failed_123',
          status: 'requires_payment_method',
        },
      },
    });

    const res = await signedRequest(event);

    expect(res.status).toBe(200);

    const stored = await WebhookEvent.findOne({ stripeEventId: event.id });
    expect(stored).not.toBeNull();
    expect(stored.type).toBe('payment_intent.payment_failed');
    expect(stored.paymentIntentId).toBe('pi_test_failed_123');
    expect(stored.status).toBe('requires_payment_method');
  });

  it('responds 200 without creating a WebhookEvent for an uninteresting event type', async () => {
    const event = buildEvent({
      id: 'evt_test_uninteresting_123',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_test_123',
          status: 'needs_response',
        },
      },
    });

    const res = await signedRequest(event);

    expect(res.status).toBe(200);

    const count = await WebhookEvent.countDocuments({ stripeEventId: event.id });
    expect(count).toBe(0);
  });

  it('responds 400 and creates nothing when the signature header is missing', async () => {
    const event = buildEvent({ id: 'evt_test_no_sig_123' });
    const payload = JSON.stringify(event);

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(400);

    const count = await WebhookEvent.countDocuments({ stripeEventId: event.id });
    expect(count).toBe(0);
  });

  it('responds 400 and creates nothing when the payload has been tampered with after signing', async () => {
    const event = buildEvent({ id: 'evt_test_tampered_123' });
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    });

    const tamperedPayload = JSON.stringify({ ...event, type: 'payment_intent.payment_failed' });

    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(tamperedPayload);

    expect(res.status).toBe(400);

    const count = await WebhookEvent.countDocuments({ stripeEventId: event.id });
    expect(count).toBe(0);
  });
});
