require('dotenv/config');

const app = require('../src/app');
const { connectDB } = require('../src/config/db');

// Vercel serverless entry: no app.listen() — Vercel invokes the exported
// Express app per request. connectDB() runs once per cold start; mongoose
// reuses the connection across warm invocations.
connectDB();

module.exports = app;
