process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Location = require('../../src/models/location.model');
const Level = require('../../src/models/level.model');
const GroupClass = require('../../src/models/groupClass.model');
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
    role: 'admin',
    firstName: 'Test',
    lastName: 'Admin',
    email: 'test-admin@example.com',
    passwordHash,
    ...overrides,
  });
}

async function loginAgent(email) {
  const agent = request.agent(app);

  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });

  return agent;
}

describe('Location routes', () => {
  it('creates, lists, updates, and deletes a location (admin happy path)', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const createRes = await agent.post('/api/v1/locations').send({
      name: 'Frisco HQ',
      address: '123 Main St',
      timezone: 'America/Chicago',
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.location.name).toBe('Frisco HQ');

    const locationId = createRes.body.location._id;

    const listRes = await agent.get('/api/v1/locations');
    expect(listRes.status).toBe(200);
    expect(listRes.body.locations).toHaveLength(1);

    const updateRes = await agent
      .put(`/api/v1/locations/${locationId}`)
      .send({ address: '456 Elm St' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.location.address).toBe('456 Elm St');

    const deleteRes = await agent.delete(`/api/v1/locations/${locationId}`);
    expect(deleteRes.status).toBe(200);

    const listAfterDeleteRes = await agent.get('/api/v1/locations');
    expect(listAfterDeleteRes.body.locations).toHaveLength(0);
  });

  it('returns 403 when a non-admin tries to create a location', async () => {
    await seedUser({ role: 'parent', email: 'test-parent@example.com' });
    const agent = await loginAgent('test-parent@example.com');

    const res = await agent.post('/api/v1/locations').send({
      name: 'Frisco HQ',
      address: '123 Main St',
    });

    expect(res.status).toBe(403);
  });

  // docs/plans/timezone-consistency-plan.md D8 — an invalid IANA timezone
  // name must fail loudly with a clean 400, not silently default to UTC
  // (moment-timezone's own behavior for an unrecognized zone) or 500.
  it('returns 400 with a clear message when creating a location with an invalid timezone', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const res = await agent.post('/api/v1/locations').send({
      name: 'Frisco HQ',
      address: '123 Main St',
      timezone: 'America/Chigaco', // typo
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not a valid IANA timezone/);
    expect(await Location.countDocuments()).toBe(0);
  });

  it('returns 400 with a clear message when updating a location to an invalid timezone', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });

    const res = await agent
      .put(`/api/v1/locations/${location._id}`)
      .send({ timezone: 'Not/A_Real_Zone' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not a valid IANA timezone/);

    const persisted = await Location.findById(location._id);
    expect(persisted.timezone).toBe('America/Chicago'); // unchanged, still the default
  });

  it('accepts a valid, non-default IANA timezone name', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const res = await agent.post('/api/v1/locations').send({
      name: 'Frisco West',
      address: '456 Elm St',
      timezone: 'America/Denver',
    });

    expect(res.status).toBe(201);
    expect(res.body.location.timezone).toBe('America/Denver');
  });

  it('returns 409 when deleting a location referenced by a GroupClass', async () => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });
    const level = await Level.create({ name: 'Beginner', order: 1 });
    await GroupClass.create({
      name: 'Beginner Foil',
      levelId: level._id,
      locationId: location._id,
      capacity: 10,
    });

    const res = await agent.delete(`/api/v1/locations/${location._id}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 class\(es\) reference this location/);
  });

  // docs/plans/frontend-polish-plan.md PR 5.3 — optional public contact
  // info, empty by default; the owner fills the real values in via the
  // admin form whenever they're ready.
  describe('phone/email', () => {
    it('persists phone and email on create and returns them in the response', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const res = await agent.post('/api/v1/locations').send({
        name: 'Frisco HQ',
        address: '123 Main St',
        phone: '(214) 555-0100',
        email: 'info@friscofencingacademy.com',
      });

      expect(res.status).toBe(201);
      expect(res.body.location.phone).toBe('(214) 555-0100');
      expect(res.body.location.email).toBe('info@friscofencingacademy.com');

      const persisted = await Location.findById(res.body.location._id);
      expect(persisted.phone).toBe('(214) 555-0100');
      expect(persisted.email).toBe('info@friscofencingacademy.com');
    });

    it('defaults phone and email to empty strings when omitted — never a fabricated placeholder', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const res = await agent.post('/api/v1/locations').send({
        name: 'Frisco HQ',
        address: '123 Main St',
      });

      expect(res.status).toBe(201);
      expect(res.body.location.phone).toBe('');
      expect(res.body.location.email).toBe('');
    });

    it('persists an updated phone/email on an existing location', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });

      const res = await agent
        .put(`/api/v1/locations/${location._id}`)
        .send({ phone: '(214) 555-0199', email: 'updated@friscofencingacademy.com' });

      expect(res.status).toBe(200);
      expect(res.body.location.phone).toBe('(214) 555-0199');
      expect(res.body.location.email).toBe('updated@friscofencingacademy.com');
    });

    it('returns 400 with a clear message when the email is not a valid address, and persists nothing', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const res = await agent.post('/api/v1/locations').send({
        name: 'Frisco HQ',
        address: '123 Main St',
        email: 'not-an-email',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not a valid email address/);
      expect(await Location.countDocuments()).toBe(0);
    });

    it('accepts an empty string email on update without error', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const location = await Location.create({
        name: 'Frisco HQ',
        address: '123 Main St',
        email: 'info@friscofencingacademy.com',
      });

      const res = await agent.put(`/api/v1/locations/${location._id}`).send({ email: '' });

      expect(res.status).toBe(200);
      expect(res.body.location.email).toBe('');
    });
  });

  describe('GET /api/v1/locations/public', () => {
    it('requires no auth and returns a thin {name, address, timezone, phone, email} projection', async () => {
      await Location.create({
        name: 'Frisco HQ',
        address: '123 Main St',
        timezone: 'America/Chicago',
        phone: '(214) 555-0100',
        email: 'info@friscofencingacademy.com',
      });

      // No Authorization/cookie at all.
      const res = await request(app).get('/api/v1/locations/public');

      expect(res.status).toBe(200);
      expect(res.body.locations).toEqual([
        {
          name: 'Frisco HQ',
          address: '123 Main St',
          timezone: 'America/Chicago',
          phone: '(214) 555-0100',
          email: 'info@friscofencingacademy.com',
        },
      ]);
    });

    it('includes empty-string phone/email in the public projection when neither is set — never omitted, never a placeholder', async () => {
      await Location.create({ name: 'Frisco HQ', address: '123 Main St' });

      const res = await request(app).get('/api/v1/locations/public');

      expect(res.status).toBe(200);
      expect(res.body.locations[0].phone).toBe('');
      expect(res.body.locations[0].email).toBe('');
    });
  });
});
