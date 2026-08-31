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
const registrationRoutes = require('./routes/registration.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const stripeWebhookRoutes = require('./routes/stripeWebhook.routes');
const coachContractRoutes = require('./routes/coachContract.routes');
const privateClassScheduleRoutes = require('./routes/privateClassSchedule.routes');
const privateClassEnrollmentRoutes = require('./routes/privateClassEnrollment.routes');
const privateClassSessionRoutes = require('./routes/privateClassSession.routes');
const spotlightRoutes = require('./routes/spotlight.routes');
const testimonialRoutes = require('./routes/testimonial.routes');
const auditRunRoutes = require('./routes/auditRun.routes');
const evaluationRoutes = require('./routes/evaluation.routes');
const settingRoutes = require('./routes/setting.routes');
const holidayRoutes = require('./routes/holiday.routes');

configurePassport(passport);

const app = express();

// Mounted BEFORE the global express.json() below, with its own
// express.raw() middleware, so this route sees the exact raw request bytes.
// Stripe's `stripe.webhooks.constructEvent` signature check requires the
// unparsed body — if express.json() ran first, it would already have
// consumed/parsed the body into an object and signature verification would
// always fail. Express matches routes in registration order, so registering
// this specific route ahead of the global JSON parser makes it "win" for
// this path only; every other route below still gets JSON parsing as usual.
app.use(
  '/api/v1/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  stripeWebhookRoutes
);

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
app.use('/api/v1/registrations', registrationRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/coach-contracts', coachContractRoutes);
app.use('/api/v1/private-class-schedules', privateClassScheduleRoutes);
app.use('/api/v1/private-class-enrollments', privateClassEnrollmentRoutes);
app.use('/api/v1/private-class-sessions', privateClassSessionRoutes);
app.use('/api/v1/spotlights', spotlightRoutes);
app.use('/api/v1/testimonials', testimonialRoutes);
app.use('/api/v1/audit-runs', auditRunRoutes);
app.use('/api/v1/evaluations', evaluationRoutes);
app.use('/api/v1/settings', settingRoutes);
app.use('/api/v1/holidays', holidayRoutes);

module.exports = app;
