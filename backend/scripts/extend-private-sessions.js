require('dotenv/config');

const mongoose = require('mongoose');

const PrivateClassEnrollment = require('../src/models/privateClassEnrollment.model');
const { generateSessions } = require('../src/services/privateClassSession.service');

// Manual-run model, same as run-renewals.js — no real scheduler yet
// (docs/plans/deployment-launch-plan.md's deferred-cron note). Re-runs the
// 8-week session generator for every active enrollment; generateSessions()
// is idempotent (in-memory dedup + the unique index backstop), so running
// this repeatedly is always safe.
async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  try {
    const enrollments = await PrivateClassEnrollment.find({ status: 'active' }, '_id');

    let totalCreated = 0;

    for (const enrollment of enrollments) {
      // eslint-disable-next-line no-await-in-loop -- sequential by design,
      // matches run-renewals.js's own model.
      const { sessions } = await generateSessions({ enrollmentId: enrollment._id });
      totalCreated += sessions.length;
    }

    console.log(
      `Extended private-class sessions for ${enrollments.length} active enrollment(s) — ${totalCreated} new session(s) created.`
    );
    process.exitCode = 0;
  } catch (error) {
    console.error('extend-private-sessions run failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
