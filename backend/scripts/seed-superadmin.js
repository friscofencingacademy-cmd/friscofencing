require('dotenv/config');

const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const { hashPassword } = require('../src/utils/password');

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
    const existing = await User.findOne({ email });

    if (existing) {
      console.log(`Superadmin with email "${email}" already exists, skipping.`);
      process.exitCode = 0;
      return;
    }

    const passwordHash = await hashPassword(password);

    await User.create({
      role: 'superadmin',
      firstName,
      lastName,
      email,
      passwordHash,
    });

    console.log(`Superadmin "${email}" created successfully.`);
    process.exitCode = 0;
  } catch (error) {
    console.error('Failed to seed superadmin:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
