require('dotenv/config');

const mongoose = require('mongoose');

const { seedSuperadmin } = require('./lib/seedSuperadmin');

const REQUIRED_ENV_VARS = [
  'SUPERADMIN_EMAIL',
  'SUPERADMIN_PASSWORD',
  'SUPERADMIN_FIRST_NAME',
  'SUPERADMIN_LAST_NAME',
];

async function main() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      `Missing required env vars: ${missing.join(', ')}. Set them in backend/.env before running this script.`
    );
    process.exit(1);
  }

  const email = process.env.SUPERADMIN_EMAIL.toLowerCase().trim();
  const password = process.env.SUPERADMIN_PASSWORD;
  const firstName = process.env.SUPERADMIN_FIRST_NAME;
  const lastName = process.env.SUPERADMIN_LAST_NAME;

  // Unlike the app's connectDB(), this script must hard-fail (non-zero exit)
  // if it can't reach MongoDB — a seed script that "succeeds" without a DB
  // connection is worse than useless.
  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const { created } = await seedSuperadmin({ email, password, firstName, lastName });

    console.log(
      created
        ? `Superadmin "${email}" created successfully.`
        : `Superadmin with email "${email}" already exists, skipping.`
    );
    process.exitCode = 0;
  } catch (error) {
    console.error('Failed to seed superadmin:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
