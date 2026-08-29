// Seeds a handful of published Testimonials so the home page's
// TestimonialsSection marquee has something to show. Unlike seedServices
// (canonical, code-driven data corrected back on drift every run), a
// Testimonial is owner-editable content — this only ever creates a row
// that doesn't exist yet (matched by authorName) and NEVER touches an
// existing one, so a second run can't clobber an edit the owner made via
// /admin/testimonials.
//
// Only Steve's is a confirmed-real testimonial (from the owner's own
// reference screenshot of the live site, 2026-08-29). The other three are
// original placeholder copy — reasonable, fencing-appropriate text written
// to populate the section until the owner replaces them with real
// testimonials — not verbatim customer quotes. Photos reuse the
// coach-{abel,chris,lauren}.png assets already in frontend/public/marketing/
// (downloaded during the Phase 2 WP-alignment build for TeamBand, which no
// longer renders on the home page — see wordpress-ui-alignment-plan.md's
// testimonials addendum) rather than the who-we-are.png/program-*.
// images ProgramsSection/IntroSection already show elsewhere on this same
// page.
const Testimonial = require('../../src/models/testimonial.model');

const SEED_TESTIMONIALS = [
  {
    authorName: 'Steve',
    quote:
      'Training at FFA has helped me feel more confident and disciplined. The coaches explain things clearly, and environment makes it easy to focus and improve!',
    caption: 'More than a sport, an environment for growth',
    imageUrl: '/marketing/who-we-are.png',
    isPublished: true,
    order: 1,
  },
  {
    authorName: 'Maria',
    quote:
      "My daughter was shy at her first class and now she can't wait to get to practice. The coaches take real time with each kid.",
    caption: 'Confidence. Growth. Community.',
    imageUrl: '/marketing/coach-abel.png',
    isPublished: true,
    order: 2,
  },
  {
    authorName: 'David',
    quote:
      'What impressed us most is how patient and encouraging the coaches are. Our son has grown so much in both skill and confidence since joining.',
    caption: 'Structured. Caring. Professional.',
    imageUrl: '/marketing/coach-chris.png',
    isPublished: true,
    order: 3,
  },
  {
    authorName: 'Priya',
    quote:
      'The community here is incredible. Parents and kids all support each other, and it really shows in how the students carry themselves on and off the strip.',
    caption: 'More than a sport, a second family.',
    imageUrl: '/marketing/coach-lauren.png',
    isPublished: true,
    order: 4,
  },
];

async function seedTestimonials() {
  const results = [];

  for (const seed of SEED_TESTIMONIALS) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, a
    // handful of static rows — no benefit to parallelizing.
    const existing = await Testimonial.findOne({ authorName: seed.authorName });

    if (existing) {
      results.push({ authorName: seed.authorName, action: 'skipped-exists', id: existing._id });
      // eslint-disable-next-line no-continue -- clearer than nesting the
      // rest of this loop body one level deeper.
      continue;
    }

    // eslint-disable-next-line no-await-in-loop -- see note above.
    const created = await Testimonial.create(seed);
    results.push({ authorName: seed.authorName, action: 'created', id: created._id });
  }

  return { results };
}

module.exports = { seedTestimonials, SEED_TESTIMONIALS };
