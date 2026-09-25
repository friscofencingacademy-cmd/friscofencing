require('dotenv/config');

const app = require('../src/app');
const { connectDB } = require('../src/config/db');

// Vercel serverless entry: no app.listen() — Vercel invokes this handler per
// request. Every request first makes sure the database is connected:
// instant once connected (Mongoose reuses the connection across warm
// invocations), and a fresh attempt if an earlier one failed — so an
// instance whose first connect failed recovers on its next request instead
// of staying broken until the next deploy (src/config/db.js). connectDB never
// throws; the request is handled either way (/health needs no database).
connectDB();

module.exports = async function handler(req, res) {
  await connectDB();
  return app(req, res);
};
