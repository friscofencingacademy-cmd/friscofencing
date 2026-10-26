const request = require('supertest');

const app = require('../../src/app');
const { _resetForTests } = require('../../src/payments');

// GET /api/v1/payments/config — public; serves the ACTIVE provider's browser
// configuration from the adapter (docs/plans/payment-provider-port-plan.md D10).
describe('GET /api/v1/payments/config', () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const key of ['PAYMENT_PROVIDER', 'STRIPE_PUBLISHABLE_KEY']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    _resetForTests();
  });

  it('serves the active provider and its public config, with no login', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_route_suite';

    const res = await request(app).get('/api/v1/payments/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ provider: 'stripe', stripe: { publishableKey: 'pk_test_route_suite' } });
  });

  it('never carries a secret credential', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_route_suite';

    const res = await request(app).get('/api/v1/payments/config');
    const body = JSON.stringify(res.body);

    expect(body).not.toMatch(/sk_(test|live)_/);
    if (process.env.STRIPE_SECRET_KEY) expect(body).not.toContain(process.env.STRIPE_SECRET_KEY);
    if (process.env.STRIPE_WEBHOOK_SECRET) expect(body).not.toContain(process.env.STRIPE_WEBHOOK_SECRET);
  });

  it('answers the generic 500 when the active provider has no public config — never a partial body', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/api/v1/payments/config');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Something went wrong' });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
