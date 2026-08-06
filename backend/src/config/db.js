const mongoose = require('mongoose');

/**
 * Connects to MongoDB using MONGO_URI.
 * Fire-and-forget from the caller's perspective: on failure, this logs a
 * clear error and resolves without throwing or exiting the process — the
 * server (and its /health endpoint) must stay up even if MongoDB is not
 * installed/running locally.
 */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error(
      'MongoDB connection failed — is MongoDB installed and running locally? See CLAUDE.md.'
    );
  }
}

module.exports = { connectDB };
