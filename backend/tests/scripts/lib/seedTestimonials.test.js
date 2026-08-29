const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const Testimonial = require('../../../src/models/testimonial.model');

const { seedTestimonials, SEED_TESTIMONIALS } = require('../../../scripts/lib/seedTestimonials');

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

describe('scripts/lib/seedTestimonials', () => {
  it('creates all four seed testimonials on a fresh database, published', async () => {
    const { results } = await seedTestimonials();

    expect(results.every((r) => r.action === 'created')).toBe(true);
    expect(await Testimonial.countDocuments()).toBe(4);

    const steve = await Testimonial.findOne({ authorName: 'Steve' });
    expect(steve.isPublished).toBe(true);
    expect(steve.caption).toBe('More than a sport, an environment for growth');
  });

  it('is idempotent: a second run creates nothing new and skips every row', async () => {
    await seedTestimonials();
    const { results } = await seedTestimonials();

    expect(results.every((r) => r.action === 'skipped-exists')).toBe(true);
    expect(await Testimonial.countDocuments()).toBe(4);
  });

  it('never touches an existing row the owner has already edited — owner state, not seed state', async () => {
    await seedTestimonials();
    await Testimonial.updateOne(
      { authorName: 'Steve' },
      { $set: { quote: 'Owner-edited quote.', isPublished: false } }
    );

    await seedTestimonials();

    const reloaded = await Testimonial.findOne({ authorName: 'Steve' });
    expect(reloaded.quote).toBe('Owner-edited quote.');
    expect(reloaded.isPublished).toBe(false);
  });

  it('SEED_TESTIMONIALS exports exactly the four author names this seed adds', () => {
    expect(SEED_TESTIMONIALS.map((t) => t.authorName).sort()).toEqual([
      'David',
      'Maria',
      'Priya',
      'Steve',
    ]);
  });
});
