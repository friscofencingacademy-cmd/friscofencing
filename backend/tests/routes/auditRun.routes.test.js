process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const AuditRun = require('../../src/models/auditRun.model');
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

const VALID_RUN = {
  auditName: 'audit-live-registration',
  group: null,
  overall: 'pass',
  scenarios: [
    { id: 'S1', name: 'Trial booking', result: 'pass', note: '' },
    { id: 'S2', name: 'Add card + register', result: 'pass', note: '' },
  ],
  summary: '2/2 scenarios passed.',
  startedAt: '2026-08-23T14:00:00.000Z',
  finishedAt: '2026-08-23T14:05:00.000Z',
  runner: 'playwright-script',
};

describe('AuditRun routes', () => {
  describe('POST /api/v1/audit-runs', () => {
    it('lets a superadmin create a run with all fields persisted', async () => {
      await seedUser({ role: 'superadmin', email: 'audit-super1@example.com' });
      const superAgent = await loginAgent('audit-super1@example.com');

      const res = await superAgent.post('/api/v1/audit-runs').send(VALID_RUN);

      expect(res.status).toBe(201);
      expect(res.body.data.auditName).toBe('audit-live-registration');
      expect(res.body.data.overall).toBe('pass');
      expect(res.body.data.scenarios).toHaveLength(2);
      expect(res.body.data.scenarios[0]).toMatchObject({ id: 'S1', name: 'Trial booking', result: 'pass' });

      const persisted = await AuditRun.findOne({ auditName: 'audit-live-registration' });
      expect(persisted).not.toBeNull();
      expect(persisted.runner).toBe('playwright-script');
    });

    it('returns 400 when a required field is missing', async () => {
      await seedUser({ role: 'superadmin', email: 'audit-super2@example.com' });
      const superAgent = await loginAgent('audit-super2@example.com');

      const { overall, ...incomplete } = VALID_RUN;

      const res = await superAgent.post('/api/v1/audit-runs').send(incomplete);

      expect(res.status).toBe(400);
      expect(await AuditRun.countDocuments()).toBe(0);
    });

    it('returns 403 for a non-superadmin (admin, coach, parent)', async () => {
      await seedUser({ role: 'admin', email: 'audit-admin@example.com' });
      await seedUser({ role: 'coach', email: 'audit-coach@example.com' });
      await seedUser({ role: 'parent', email: 'audit-parent@example.com' });

      for (const email of ['audit-admin@example.com', 'audit-coach@example.com', 'audit-parent@example.com']) {
        const agent = await loginAgent(email);
        const res = await agent.post('/api/v1/audit-runs').send(VALID_RUN);
        expect(res.status).toBe(403);
      }

      expect(await AuditRun.countDocuments()).toBe(0);
    });
  });

  describe('GET /api/v1/audit-runs?latest=true', () => {
    it('returns one row per auditName — the most recent run only', async () => {
      await seedUser({ role: 'superadmin', email: 'audit-super3@example.com' });
      const superAgent = await loginAgent('audit-super3@example.com');

      await AuditRun.create({
        ...VALID_RUN,
        overall: 'fail',
        startedAt: new Date('2026-08-20T00:00:00.000Z'),
        finishedAt: new Date('2026-08-20T00:05:00.000Z'),
      });
      // Second, newer run for the SAME auditName.
      await new Promise((resolve) => setTimeout(resolve, 5));
      await AuditRun.create({
        ...VALID_RUN,
        overall: 'pass',
        startedAt: new Date('2026-08-23T00:00:00.000Z'),
        finishedAt: new Date('2026-08-23T00:05:00.000Z'),
      });

      const res = await superAgent.get('/api/v1/audit-runs?latest=true');

      expect(res.status).toBe(200);
      expect(res.body.data.runs).toHaveLength(1);
      expect(res.body.data.runs[0].overall).toBe('pass');
      expect(res.body.data.total).toBe(1);
    });

    it('returns 403 for a non-superadmin', async () => {
      await seedUser({ role: 'admin', email: 'audit-admin2@example.com' });
      const agent = await loginAgent('audit-admin2@example.com');

      const res = await agent.get('/api/v1/audit-runs?latest=true');

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/audit-runs/:id', () => {
    it('returns a single run by id', async () => {
      await seedUser({ role: 'superadmin', email: 'audit-super4@example.com' });
      const superAgent = await loginAgent('audit-super4@example.com');

      const created = await AuditRun.create(VALID_RUN);

      const res = await superAgent.get(`/api/v1/audit-runs/${created._id}`);

      expect(res.status).toBe(200);
      expect(res.body.data._id).toBe(String(created._id));
    });

    it('returns 404 for an unknown id', async () => {
      await seedUser({ role: 'superadmin', email: 'audit-super5@example.com' });
      const superAgent = await loginAgent('audit-super5@example.com');

      const res = await superAgent.get('/api/v1/audit-runs/64c0000000000000000000aa');

      expect(res.status).toBe(404);
    });
  });
});
