const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { connectDB } = require('../../src/config/db');

// src/config/db.js — the connection must recover after a failed attempt
// (the 2026-09-25 staging outage: one failed first connect left an instance
// broken until the next deploy, with no cause in the logs).

// A port nothing listens on, with a password, so the test proves both that
// the attempt fails fast and that the connection string never reaches a log.
const UNREACHABLE_URI = 'mongodb://user:s3cret-pw@127.0.0.1:1/frisco?directConnection=true';

let mongod;
let errorSpy;
const originalUri = process.env.MONGO_URI;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
});

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  errorSpy.mockRestore();
  await mongoose.disconnect();
  process.env.MONGO_URI = originalUri;
});

afterAll(async () => {
  await mongod.stop();
});

describe('connectDB', () => {
  it('connects, and a second call reuses the live connection', async () => {
    process.env.MONGO_URI = mongod.getUri();

    await connectDB();
    const connection = mongoose.connection.getClient();
    await connectDB();

    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.getClient()).toBe(connection);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('reconnects after a connection that had succeeded is lost', async () => {
    process.env.MONGO_URI = mongod.getUri();
    await connectDB();
    await mongoose.disconnect();
    expect(mongoose.connection.readyState).toBe(0);

    await connectDB();

    expect(mongoose.connection.readyState).toBe(1);
  });

  it('shares one attempt between simultaneous callers', async () => {
    process.env.MONGO_URI = mongod.getUri();

    await Promise.all([connectDB(), connectDB(), connectDB()]);

    expect(mongoose.connection.readyState).toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('never throws on a failed attempt, and logs the real cause without the connection string', async () => {
    process.env.MONGO_URI = UNREACHABLE_URI;

    await expect(connectDB()).resolves.toBeUndefined();

    expect(mongoose.connection.readyState).not.toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0][0];
    expect(logged).toMatch(/^MongoDB connection failed \(MongooseServerSelectionError\): /);
    expect(logged).toMatch(/will retry on the next request/);
    expect(logged).not.toContain('s3cret-pw');
  }, 20000);

  it('recovers on the next call after a failed attempt — the outage fix', async () => {
    process.env.MONGO_URI = UNREACHABLE_URI;
    await connectDB();
    expect(mongoose.connection.readyState).not.toBe(1);

    // The database becomes reachable (here: the same process, a good URI).
    process.env.MONGO_URI = mongod.getUri();
    await connectDB();

    expect(mongoose.connection.readyState).toBe(1);
  }, 20000);
});
