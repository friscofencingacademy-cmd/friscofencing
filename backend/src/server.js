require('dotenv/config');

const app = require('./app');
const { connectDB } = require('./config/db');

// Fire-and-forget: startup does not block on DB connectivity.
connectDB();

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Frisco Fencing backend listening on port ${PORT}`);
});
