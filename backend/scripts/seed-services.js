require('dotenv/config');

const mongoose = require('mongoose');

const { seedServices } = require('./lib/seedServices');

// Idempotent — safe to run any time, including as part of every deploy or
// staging refresh (see scripts/lib/refreshStagingData.js, which calls
// seedServices() directly rather than shelling out to this wrapper).
async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const { results } = await seedServices();

    console.log('Service registry:');
    results.forEach((result) => {
      if (result.action === 'corrected') {
        console.log(`  - ${result.code}: corrected (${result.fields.join(', ')})`);
      } else {
        console.log(`  - ${result.code}: ${result.action}`);
      }
    });

    process.exitCode = 0;
  } catch (error) {
    console.error('Failed to seed services:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
