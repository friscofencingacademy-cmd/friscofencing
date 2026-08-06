const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const passport = require('passport');

const configurePassport = require('./config/passport');
const authRoutes = require('./routes/auth.routes');
const locationRoutes = require('./routes/location.routes');
const levelRoutes = require('./routes/level.routes');
const groupClassRoutes = require('./routes/groupClass.routes');
const groupClassScheduleRoutes = require('./routes/groupClassSchedule.routes');
const groupClassSessionRoutes = require('./routes/groupClassSession.routes');
const priceRoutes = require('./routes/price.routes');
const userRoutes = require('./routes/user.routes');
const studentRoutes = require('./routes/student.routes');
const trialClassRoutes = require('./routes/trialClass.routes');
const paymentMethodRoutes = require('./routes/paymentMethod.routes');

configurePassport(passport);

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(passport.initialize());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/locations', locationRoutes);
app.use('/api/v1/levels', levelRoutes);
app.use('/api/v1/group-classes', groupClassRoutes);
app.use('/api/v1/group-class-schedules', groupClassScheduleRoutes);
app.use('/api/v1/group-class-sessions', groupClassSessionRoutes);
app.use('/api/v1/prices', priceRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/trial-classes', trialClassRoutes);
app.use('/api/v1/payment-methods', paymentMethodRoutes);

module.exports = app;
