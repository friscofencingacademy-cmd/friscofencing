const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const Service = require('../../src/models/service.model');

const { getServiceByCode } = require('../../src/services/serviceCatalog.service');

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

describe('serviceCatalog.service — getServiceByCode', () => {
  it('returns the seeded service for a real code', async () => {
    await Service.create({ code: 'group-classes', name: 'Group Classes', billingShape: 'subscription_cycle' });

    const service = await getServiceByCode('group-classes');

    expect(service.code).toBe('group-classes');
    expect(service.billingShape).toBe('subscription_cycle');
  });

  it('fails closed with a 500-shaped error when the service is not seeded at all', async () => {
    await expect(getServiceByCode('nonexistent-service')).rejects.toMatchObject({ status: 500 });
  });

  it('returns an inactive service fine when requireActive is not set', async () => {
    await Service.create({ code: 'camps', name: 'Camps', billingShape: 'one_time_event', isActive: false });

    const service = await getServiceByCode('camps');

    expect(service.isActive).toBe(false);
  });

  it('rejects an inactive service with a 409 when requireActive is set', async () => {
    await Service.create({ code: 'camps', name: 'Camps', billingShape: 'one_time_event', isActive: false });

    await expect(getServiceByCode('camps', { requireActive: true })).rejects.toMatchObject({ status: 409 });
  });

  it('resolves an active service fine when requireActive is set', async () => {
    await Service.create({ code: 'private-lessons', name: 'Private Lessons', billingShape: 'per_session', isActive: true });

    const service = await getServiceByCode('private-lessons', { requireActive: true });

    expect(service.code).toBe('private-lessons');
  });

  it('reads fresh every call — no caching', async () => {
    await Service.create({ code: 'group-classes', name: 'Group Classes', billingShape: 'subscription_cycle' });

    const first = await getServiceByCode('group-classes');
    expect(first.isActive).toBe(true);

    await Service.updateOne({ code: 'group-classes' }, { $set: { isActive: false } });

    const second = await getServiceByCode('group-classes');
    expect(second.isActive).toBe(false);
  });
});
