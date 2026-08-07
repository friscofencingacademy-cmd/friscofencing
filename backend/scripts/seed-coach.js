require('dotenv/config');

const mongoose = require('mongoose');

const User = require('../src/models/user.model');
const { hashPassword } = require('../src/utils/password');

// Stopgap until there's a real admin-facing path to create staff accounts
// (coach/admin) -- currently the only account-creation paths are public
// parent self-signup and this style of one-off seed script. Tracked as a
// known gap, not fixed here.
const REQUIRED_ENV_VARS = [
  'COACH_EMAIL',
  'COACH_PASSWORD',
  'COACH_FIRST_NAME',
  'COACH_LAST_NAME',
];

async function main() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      `Missing required env vars: ${missing.join(', ')}. Set them in backend/.env before running this script.`
    );
    process.exit(1);
  }

  const email = process.env.COACH_EMAIL.toLowerCase().trim();
  const password = process.env.COACH_PASSWORD;
  const firstName = process.env.COACH_FIRST_NAME;
  const lastName = process.env.COACH_LAST_NAME;

  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const existing = await User.findOne({ email });

    if (existing) {
      console.log(`Coach with email "${email}" already exists, skipping.`);
      process.exitCode = 0;
      return;
    }

    const passwordHash = await hashPassword(password);

    await User.create({
      role: 'coach',
      firstName,
      lastName,
      email,
      passwordHash,
    });

    console.log(`Coach "${email}" created successfully.`);
    process.exitCode = 0;
  } catch (error) {
    console.error('Failed to seed coach:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
