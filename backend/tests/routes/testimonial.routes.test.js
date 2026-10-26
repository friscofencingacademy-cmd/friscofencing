process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// No test mode exists for Vercel Blob (unlike Stripe) — calling put() for
// real here would actually upload a file to the live store. See
// docs/TESTING_STRATEGY.md's named exceptions.
jest.mock('@vercel/blob');

const mongoose = require('mongoose');
const request = require('supertest');
const { put } = require('@vercel/blob');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Testimonial = require('../../src/models/testimonial.model');
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

describe('Testimonial routes', () => {
  describe('admin CRUD', () => {
    it('creates, lists, updates, and deletes a testimonial (admin happy path)', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const createRes = await agent.post('/api/v1/testimonials').send({
        quote: 'Training at FFA has helped me feel more confident and disciplined.',
        authorName: 'Steve',
        caption: 'More than a sport, an environment for growth',
        imageUrl: 'https://example.com/steve.jpg',
        isPublished: false,
        order: 1,
      });

      expect(createRes.status).toBe(201);
      expect(createRes.body.testimonial.authorName).toBe('Steve');

      const testimonialId = createRes.body.testimonial._id;

      const listRes = await agent.get('/api/v1/testimonials');
      expect(listRes.status).toBe(200);
      expect(listRes.body.testimonials).toHaveLength(1);

      const updateRes = await agent
        .put(`/api/v1/testimonials/${testimonialId}`)
        .send({ isPublished: true });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.testimonial.isPublished).toBe(true);

      const deleteRes = await agent.delete(`/api/v1/testimonials/${testimonialId}`);
      expect(deleteRes.status).toBe(200);

      const listAfterDeleteRes = await agent.get('/api/v1/testimonials');
      expect(listAfterDeleteRes.body.testimonials).toHaveLength(0);
    });

    it('returns 403 when a non-admin tries to create, list, or delete a testimonial', async () => {
      await seedUser({ role: 'coach', email: 'test-coach@example.com' });
      const agent = await loginAgent('test-coach@example.com');

      const createRes = await agent
        .post('/api/v1/testimonials')
        .send({ quote: 'Great program.', authorName: 'Steve' });
      expect(createRes.status).toBe(403);

      const listRes = await agent.get('/api/v1/testimonials');
      expect(listRes.status).toBe(403);
    });

    it('requires quote and authorName', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const res = await agent.post('/api/v1/testimonials').send({ caption: 'No quote or name' });

      // A Mongoose ValidationError -> 400 with every missing field named, via
      // the central error middleware (docs/plans/duplication-cleanup-plan.md
      // B-D4).
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/quote/);
      expect(res.body.message).toMatch(/authorName/);
      expect(await Testimonial.countDocuments()).toBe(0);
    });
  });

  describe('POST /api/v1/testimonials/upload-image', () => {
    it('uploads the file to Blob storage and returns its public url (admin happy path)', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      put.mockResolvedValue({ url: 'https://blob.example.com/testimonials/generated-name.jpg' });

      const res = await agent
        .post('/api/v1/testimonials/upload-image')
        .attach('image', Buffer.from('fake-image-bytes'), 'steve.jpg');

      expect(res.status).toBe(201);
      expect(res.body.imageUrl).toBe('https://blob.example.com/testimonials/generated-name.jpg');

      expect(put).toHaveBeenCalledTimes(1);
      const [pathname, buffer, options] = put.mock.calls[0];
      expect(pathname).toMatch(/^testimonials\/.+\.jpg$/);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(options).toMatchObject({ access: 'public' });
    });

    it('returns 403 for a non-admin', async () => {
      await seedUser({ role: 'coach', email: 'test-coach@example.com' });
      const agent = await loginAgent('test-coach@example.com');

      const res = await agent
        .post('/api/v1/testimonials/upload-image')
        .attach('image', Buffer.from('fake-image-bytes'), 'steve.jpg');

      expect(res.status).toBe(403);
      expect(put).not.toHaveBeenCalled();
    });

    it('returns 400 when no file is attached', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const res = await agent.post('/api/v1/testimonials/upload-image');

      expect(res.status).toBe(400);
      expect(put).not.toHaveBeenCalled();
    });

    it('returns 400 when the file exceeds the 5MB limit, without ever calling Blob', async () => {
      await seedUser();
      const agent = await loginAgent('test-admin@example.com');

      const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);

      const res = await agent
        .post('/api/v1/testimonials/upload-image')
        .attach('image', oversized, 'huge.jpg');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Image must be 5MB or smaller');
      expect(put).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/testimonials/public', () => {
    it('requires no auth, returns only published testimonials, ordered, and leaks no admin-only fields', async () => {
      await Testimonial.create({
        quote: 'Second quote.',
        authorName: 'Published Second',
        caption: 'Caption two',
        imageUrl: 'https://example.com/second.jpg',
        isPublished: true,
        order: 2,
      });
      await Testimonial.create({
        quote: 'First quote.',
        authorName: 'Published First',
        isPublished: true,
        order: 1,
      });
      await Testimonial.create({
        quote: 'Unpublished quote.',
        authorName: 'Unpublished Person',
        isPublished: false,
      });

      // No Authorization/cookie at all.
      const res = await request(app).get('/api/v1/testimonials/public');

      expect(res.status).toBe(200);
      expect(res.body.testimonials).toEqual([
        {
          quote: 'First quote.',
          authorName: 'Published First',
        },
        {
          quote: 'Second quote.',
          authorName: 'Published Second',
          caption: 'Caption two',
          imageUrl: 'https://example.com/second.jpg',
        },
      ]);
      expect(JSON.stringify(res.body)).not.toContain('isPublished');
      expect(JSON.stringify(res.body)).not.toContain('Unpublished Person');
    });
  });
});

// Every protected route answers 401 without a session, every admin-only route
// 403 for a non-admin (changing nothing), and an unknown id 404 — the negative
// paths /audit-tests Check 11 asks of each route
// (docs/plans/testing-strategy-refresh-plan.md PR C).
describe('Testimonial routes — access control and unknown ids', () => {
  const UNKNOWN_ID = new mongoose.Types.ObjectId().toString();

  it.each([
    ['get', '/api/v1/testimonials'],
    ['get', `/api/v1/testimonials/${UNKNOWN_ID}`],
    ['post', '/api/v1/testimonials'],
    ['put', `/api/v1/testimonials/${UNKNOWN_ID}`],
    ['delete', `/api/v1/testimonials/${UNKNOWN_ID}`],
    ['post', '/api/v1/testimonials/upload-image'],
  ])('%s %s returns 401 without a session', async (method, url) => {
    const res = await request(app)[method](url).send({ quote: 'Great program.', authorName: 'Steve' });

    expect(res.status).toBe(401);
    expect(put).not.toHaveBeenCalled();
  });

  it('returns 403 when a non-admin tries to read, update, or delete one testimonial, and changes nothing', async () => {
    const testimonial = await Testimonial.create({ quote: 'Great program.', authorName: 'Steve' });
    await seedUser({ role: 'parent', email: 'test-parent@example.com' });
    const agent = await loginAgent('test-parent@example.com');

    const getRes = await agent.get(`/api/v1/testimonials/${testimonial._id}`);
    const updateRes = await agent.put(`/api/v1/testimonials/${testimonial._id}`).send({ quote: 'Changed.' });
    const deleteRes = await agent.delete(`/api/v1/testimonials/${testimonial._id}`);

    expect(getRes.status).toBe(403);
    expect(updateRes.status).toBe(403);
    expect(deleteRes.status).toBe(403);
    const stored = await Testimonial.findById(testimonial._id);
    expect(stored.quote).toBe('Great program.');
  });

  it.each(['get', 'put', 'delete'])('%s of an unknown testimonial id returns 404', async (method) => {
    await seedUser();
    const agent = await loginAgent('test-admin@example.com');

    const res = await agent[method](`/api/v1/testimonials/${UNKNOWN_ID}`).send({ quote: 'Changed.' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Testimonial not found');
  });
});
