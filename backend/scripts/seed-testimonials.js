require('dotenv/config');

const mongoose = require('mongoose');

const { seedTestimonials } = require('./lib/seedTestimonials');

// Idempotent — safe to run any time. Unlike seed-services.js, never
// corrects an existing row (see lib/seedTestimonials.js's comment) — this
// is owner-editable content, not canonical code-driven data.
async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const { results } = await seedTestimonials();

    console.log('Testimonials:');
    results.forEach((result) => {
      console.log(`  - ${result.authorName}: ${result.action}`);
    });

    process.exitCode = 0;
  } catch (error) {
    console.error('Failed to seed testimonials:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
