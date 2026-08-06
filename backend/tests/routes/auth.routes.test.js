process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
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

async function seedTestUser(overrides = {}) {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  return User.create({
    role: 'parent',
    firstName: 'Test',
    lastName: 'Parent',
    email: 'test-parent@example.com',
    passwordHash,
    ...overrides,
  });
}

describe('POST /api/v1/auth/login', () => {
  it('logs in successfully, sets the accessToken cookie, and omits passwordHash', async () => {
    await seedTestUser();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test-parent@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('test-parent@example.com');
    expect(res.body.user.passwordHash).toBeUndefined();

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some((cookie) => cookie.startsWith('accessToken='))).toBe(true);
  });

  it('returns 401 for a wrong password', async () => {
    await seedTestUser();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test-parent@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('returns 401 for an unknown email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the user when the accessToken cookie from a successful login is sent', async () => {
    await seedTestUser();

    const agent = request.agent(app);

    const loginRes = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'test-parent@example.com', password: TEST_PASSWORD });

    expect(loginRes.status).toBe(200);

    const meRes = await agent.get('/api/v1/auth/me');

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe('test-parent@example.com');
    expect(meRes.body.user.passwordHash).toBeUndefined();
  });

  it('returns 401 with no cookie', async () => {
    const res = await request(app).get('/api/v1/auth/me');

    expect(res.status).toBe(401);
  });
});
