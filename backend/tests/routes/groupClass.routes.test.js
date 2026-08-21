process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
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

async function seedAdmin() {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  return User.create({
    role: 'admin',
    firstName: 'Test',
    lastName: 'Admin',
    email: 'test-admin@example.com',
    passwordHash,
  });
}

async function loginAgent(email) {
  const agent = request.agent(app);

  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });

  return agent;
}

describe('GroupClass routes', () => {
  it('creates a group class when levelId and locationId are valid', async () => {
    await seedAdmin();
    const agent = await loginAgent('test-admin@example.com');

    const level = await Level.create({ name: 'Beginner', order: 1 });
    const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });

    const res = await agent.post('/api/v1/group-classes').send({
      name: 'Beginner Foil',
      levelId: level._id.toString(),
      locationId: location._id.toString(),
      capacity: 10,
    });

    expect(res.status).toBe(201);
    expect(res.body.groupClass.name).toBe('Beginner Foil');
  });

  it('returns 404 when levelId does not exist', async () => {
    await seedAdmin();
    const agent = await loginAgent('test-admin@example.com');

    const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });
    const bogusLevelId = new mongoose.Types.ObjectId().toString();

    const res = await agent.post('/api/v1/group-classes').send({
      name: 'Beginner Foil',
      levelId: bogusLevelId,
      locationId: location._id.toString(),
      capacity: 10,
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Level not found/);
  });

  it('returns 404 when locationId does not exist', async () => {
    await seedAdmin();
    const agent = await loginAgent('test-admin@example.com');

    const level = await Level.create({ name: 'Beginner', order: 1 });
    const bogusLocationId = new mongoose.Types.ObjectId().toString();

    const res = await agent.post('/api/v1/group-classes').send({
      name: 'Beginner Foil',
      levelId: level._id.toString(),
      locationId: bogusLocationId,
      capacity: 10,
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Location not found/);
  });

  it('deletes a group class with no referencing schedules (happy path)', async () => {
    await seedAdmin();
    const agent = await loginAgent('test-admin@example.com');

    const level = await Level.create({ name: 'Beginner', order: 1 });
    const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });
    const groupClass = await GroupClass.create({
      name: 'Beginner Foil',
      levelId: level._id,
      locationId: location._id,
      capacity: 10,
    });

    const res = await agent.delete(`/api/v1/group-classes/${groupClass._id}`);
    expect(res.status).toBe(200);

    const listRes = await agent.get('/api/v1/group-classes');
    expect(listRes.body.groupClasses).toHaveLength(0);
  });

  it('returns 409 when deleting a group class referenced by a GroupClassSchedule', async () => {
    await seedAdmin();
    const agent = await loginAgent('test-admin@example.com');

    const level = await Level.create({ name: 'Beginner', order: 1 });
    const location = await Location.create({ name: 'Frisco HQ', address: '123 Main St' });
    const groupClass = await GroupClass.create({
      name: 'Beginner Foil',
      levelId: level._id,
      locationId: location._id,
      capacity: 10,
    });
    const coach = await User.create({
      role: 'coach',
      firstName: 'Coach',
      lastName: 'One',
      email: 'coach-one@example.com',
      passwordHash: await hashPassword(TEST_PASSWORD),
    });
    await GroupClassSchedule.create({
      classId: groupClass._id,
      coachId: coach._id,
      dayOfWeek: 1,
      startTime: '16:00',
      endTime: '17:00',
    });

    const res = await agent.delete(`/api/v1/group-classes/${groupClass._id}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 schedule\(s\) reference this class/);
  });
});
