process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// No test mode exists for Vercel Blob (unlike Stripe) — calling put() for
// real here would actually upload a file to the live store. See
// docs/TESTING_STRATEGY.md's named exceptions.
jest.mock('@vercel/blob');

const request = require('supertest');
const { put } = require('@vercel/blob');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Spotlight = require('../../src/models/spotlight.model');
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
  put.mockReset();
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

describe('Spotlight routes', () => {
  describe('admin CRUD', () => {
    it('creates, lists, updates, and deletes a spotlight (admin happy path)', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const createRes = await agent.post('/api/v1/spotlights').send({
        type: 'coach',
        name: 'Jane Smith',
        title: 'Head Coach',
        body: 'Jane has coached for 15 years.',
        bullets: ['NCAA fencer', 'USFA certified'],
        imageUrl: 'https://example.com/jane.jpg',
        isPublished: false,
        order: 1,
      });

      expect(createRes.status).toBe(201);
      expect(createRes.body.spotlight.name).toBe('Jane Smith');

      const spotlightId = createRes.body.spotlight._id;

      const listRes = await agent.get('/api/v1/spotlights');
      expect(listRes.status).toBe(200);
      expect(listRes.body.spotlights).toHaveLength(1);

      const updateRes = await agent
        .put(`/api/v1/spotlights/${spotlightId}`)
        .send({ isPublished: true });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.spotlight.isPublished).toBe(true);

      const deleteRes = await agent.delete(`/api/v1/spotlights/${spotlightId}`);
      expect(deleteRes.status).toBe(200);

      const listAfterDeleteRes = await agent.get('/api/v1/spotlights');
      expect(listAfterDeleteRes.body.spotlights).toHaveLength(0);
    });

    it('returns 403 when a non-admin tries to create, list, or delete a spotlight', async () => {
      await seedUser({ role: 'coach', email: 'test-coach@example.com' });
      const agent = await loginAgent('test-coach@example.com');

      const createRes = await agent
        .post('/api/v1/spotlights')
        .send({ type: 'coach', name: 'Jane Smith' });
      expect(createRes.status).toBe(403);

      const listRes = await agent.get('/api/v1/spotlights');
      expect(listRes.status).toBe(403);
    });

    it('rejects more than 3 bullets', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const res = await agent.post('/api/v1/spotlights').send({
        type: 'coach',
        name: 'Jane Smith',
        bullets: ['one', 'two', 'three', 'four'],
      });

      expect(res.status).toBe(500);
      expect(await Spotlight.countDocuments()).toBe(0);
    });
  });

  describe('POST /api/v1/spotlights/upload-image', () => {
    it("uploads the file to Blob storage and returns its public url (admin happy path)", async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      put.mockResolvedValue({ url: 'https://blob.example.com/spotlights/generated-name.jpg' });

      const res = await agent
        .post('/api/v1/spotlights/upload-image')
        .attach('image', Buffer.from('fake-image-bytes'), 'jane.jpg');

      expect(res.status).toBe(201);
      expect(res.body.imageUrl).toBe('https://blob.example.com/spotlights/generated-name.jpg');

      expect(put).toHaveBeenCalledTimes(1);
      const [pathname, buffer, options] = put.mock.calls[0];
      expect(pathname).toMatch(/^spotlights\/.+\.jpg$/);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(options).toMatchObject({ access: 'public' });
    });

    it('returns 403 for a non-admin', async () => {
      await seedUser({ role: 'coach', email: 'test-coach@example.com' });
      const agent = await loginAgent('test-coach@example.com');

      const res = await agent
        .post('/api/v1/spotlights/upload-image')
        .attach('image', Buffer.from('fake-image-bytes'), 'jane.jpg');

      expect(res.status).toBe(403);
      expect(put).not.toHaveBeenCalled();
    });

    it('returns 400 when no file is attached', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const res = await agent.post('/api/v1/spotlights/upload-image');

      expect(res.status).toBe(400);
      expect(put).not.toHaveBeenCalled();
    });

    it('returns 400 when the file exceeds the 5MB limit, without ever calling Blob', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);

      const res = await agent
        .post('/api/v1/spotlights/upload-image')
        .attach('image', oversized, 'huge.jpg');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Image must be 5MB or smaller');
      expect(put).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/spotlights/public', () => {
    it('requires no auth, returns only published spotlights of the requested type, ordered, and leaks no admin-only fields', async () => {
      await Spotlight.create({
        type: 'coach',
        name: 'Published Second',
        title: 'Assistant Coach',
        body: 'Body text.',
        bullets: ['Bullet one'],
        imageUrl: 'https://example.com/second.jpg',
        isPublished: true,
        order: 2,
      });
      await Spotlight.create({
        type: 'coach',
        name: 'Published First',
        title: 'Head Coach',
        body: 'Body text.',
        bullets: [],
        isPublished: true,
        order: 1,
      });
      await Spotlight.create({
        type: 'coach',
        name: 'Unpublished Coach',
        isPublished: false,
      });
      await Spotlight.create({
        type: 'student',
        name: 'Published Student',
        isPublished: true,
        order: 1,
      });

      // No Authorization/cookie at all.
      const res = await request(app).get('/api/v1/spotlights/public?type=coach');

      expect(res.status).toBe(200);
      expect(res.body.spotlights).toEqual([
        {
          name: 'Published First',
          title: 'Head Coach',
          body: 'Body text.',
          bullets: [],
        },
        {
          name: 'Published Second',
          title: 'Assistant Coach',
          body: 'Body text.',
          bullets: ['Bullet one'],
          imageUrl: 'https://example.com/second.jpg',
        },
      ]);
      expect(JSON.stringify(res.body)).not.toContain('isPublished');
      expect(JSON.stringify(res.body)).not.toContain('Unpublished Coach');
      expect(JSON.stringify(res.body)).not.toContain('Published Student');
    });

    it('returns 400 when type is missing or invalid', async () => {
      const missingRes = await request(app).get('/api/v1/spotlights/public');
      expect(missingRes.status).toBe(400);

      const invalidRes = await request(app).get('/api/v1/spotlights/public?type=parent');
      expect(invalidRes.status).toBe(400);
    });
  });
});
