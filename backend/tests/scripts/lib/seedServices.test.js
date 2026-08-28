const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const Service = require('../../../src/models/service.model');

const { seedServices, CANONICAL_SERVICES } = require('../../../scripts/lib/seedServices');

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

describe('scripts/lib/seedServices', () => {
  it('creates exactly the four canonical services on a fresh database, with camps/meets inactive', async () => {
    const { results } = await seedServices();

    expect(results.every((r) => r.action === 'created')).toBe(true);
    expect(await Service.countDocuments()).toBe(4);

    const groupClasses = await Service.findOne({ code: 'group-classes' });
    expect(groupClasses.name).toBe('Group Classes');
    expect(groupClasses.billingShape).toBe('subscription_cycle');
    expect(groupClasses.isActive).toBe(true);

    const privateLessons = await Service.findOne({ code: 'private-lessons' });
    expect(privateLessons.billingShape).toBe('per_session');
    expect(privateLessons.isActive).toBe(true);

    const camps = await Service.findOne({ code: 'camps' });
    expect(camps.billingShape).toBe('one_time_event');
    expect(camps.isActive).toBe(false);

    const meets = await Service.findOne({ code: 'meets' });
    expect(meets.billingShape).toBe('one_time_event');
    expect(meets.isActive).toBe(false);
  });

  it('is idempotent: a second run creates nothing new and reports every row unchanged', async () => {
    await seedServices();
    const { results } = await seedServices();

    expect(results.every((r) => r.action === 'unchanged')).toBe(true);
    expect(await Service.countDocuments()).toBe(4);
  });

  it('corrects a drifted name and billingShape back to the canonical list', async () => {
    await seedServices();
    await Service.updateOne(
      { code: 'private-lessons' },
      { $set: { name: 'Mangled Name', billingShape: 'one_time_event' } }
    );

    const { results } = await seedServices();

    const corrected = results.find((r) => r.code === 'private-lessons');
    expect(corrected.action).toBe('corrected');
    expect(corrected.fields.sort()).toEqual(['billingShape', 'name']);

    const reloaded = await Service.findOne({ code: 'private-lessons' });
    expect(reloaded.name).toBe('Private Lessons');
    expect(reloaded.billingShape).toBe('per_session');
  });

  it('never touches isActive on an existing row — owner state, not seed state', async () => {
    await seedServices();
    await Service.updateOne({ code: 'group-classes' }, { $set: { isActive: false } });
    await Service.updateOne({ code: 'camps' }, { $set: { isActive: true } });

    await seedServices();

    expect((await Service.findOne({ code: 'group-classes' })).isActive).toBe(false);
    expect((await Service.findOne({ code: 'camps' })).isActive).toBe(true);
  });

  it('CANONICAL_SERVICES exports exactly the four codes the plan specifies', () => {
    expect(CANONICAL_SERVICES.map((s) => s.code).sort()).toEqual([
      'camps',
      'group-classes',
      'meets',
      'private-lessons',
    ]);
  });
});
