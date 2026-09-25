const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const CoachContract = require('../../src/models/coachContract.model');
const PaymentMethod = require('../../src/models/paymentMethod.model');
const PrivateClassEnrollment = require('../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');
const { hashPassword } = require('../../src/utils/password');
const { combineDayAndTimeInTZ } = require('../../src/utils/dateShapes');

// Shared fixtures for the private-lesson booking suites (docs/decisions/011-
// private-per-session-booking.md). Every fixture goes through the real API or
// the real schema — instants are built by the production gate
// (combineDayAndTimeInTZ), never by hand (docs/TESTING_STRATEGY.md §Date
// rules).

const TEST_PASSWORD = 'correct-password';

// The suites' frozen "now": Monday Oct 5, 2026, 9:00 AM Central (CDT).
const FROZEN_NOW = new Date('2026-10-05T14:00:00.000Z');

// The default published availability: Tuesdays 4:30–5:30 PM Central, two
// 30-minute slots (16:30, 17:00), bookable Oct 1 – Dec 31, 2026.
const DEFAULT_RULES = {
  daysOfWeek: [2],
  windowStart: '16:30',
  windowEnd: '17:30',
  slotDurationMinutes: 30,
  startDate: '2026-10-01',
  endDate: '2026-12-31',
};

// Fakes ONLY Date, leaving every timer real — the Mongo driver, supertest,
// and the Stripe SDK all need real timers.
function freezeDate(now = FROZEN_NOW) {
  jest.useFakeTimers({
    now,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick'],
  });
}

async function seedUser(overrides = {}) {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  return User.create({ firstName: 'Test', lastName: 'User', passwordHash, ...overrides });
}

async function loginAgent(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });

  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status}`);
  }

  return agent;
}

// A coach with an active contract (and `privateLessonPacks`, when given —
// docs/plans/coach-pack-pricing-plan.md), logged in, with DEFAULT_RULES (or
// `rules`) published through the real bulk endpoint.
async function seedCoachWithRules({
  suffix,
  studentBillingRate = 65,
  sessionDurationMinutes = 30,
  rules = DEFAULT_RULES,
  privateLessonPacks,
}) {
  const coach = await seedUser({ role: 'coach', firstName: 'Dana', lastName: `Coach${suffix}`, email: `coach-${suffix}@example.com` });
  const adminEmail = `admin-${suffix}@example.com`;
  await seedUser({ role: 'admin', email: adminEmail });
  const adminAgent = await loginAgent(adminEmail);

  const contractRes = await adminAgent.post('/api/v1/coach-contracts').send({
    coachId: coach._id.toString(),
    studentBillingRate,
    coachCompensationRate: 40,
    sessionDurationMinutes,
    ...(privateLessonPacks ? { privateLessonPacks } : {}),
  });

  if (contractRes.status !== 201) {
    throw new Error(`contract create failed: ${contractRes.status} ${JSON.stringify(contractRes.body)}`);
  }

  const contract = await CoachContract.findById(contractRes.body.contract._id);
  const coachAgent = await loginAgent(coach.email);

  let schedules = [];
  if (rules) {
    const res = await coachAgent.post('/api/v1/private-class-schedules').send(rules);

    if (res.status !== 201) {
      throw new Error(`publish failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    ({ schedules } = res.body);
  }

  return { coach, contract, coachAgent, adminAgent, schedules };
}

async function seedParentWithStudent(suffix) {
  const parent = await seedUser({ role: 'parent', firstName: 'Pat', lastName: suffix, email: `parent-${suffix}@example.com` });
  const student = await User.create({ role: 'student', firstName: 'Sam', lastName: suffix, parentId: parent._id });
  const parentAgent = await loginAgent(parent.email);
  return { parent, student, parentAgent };
}

// Saves a real Stripe TEST-mode card through the real endpoint.
async function saveCard(parentAgent, stripe) {
  const paymentMethod = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } });
  const res = await parentAgent.post('/api/v1/payment-methods').send({ stripePaymentMethodId: paymentMethod.id });

  if (res.status !== 201) {
    throw new Error(`card save failed: ${res.status}`);
  }
}

// Stripe's documented shared test id for a guaranteed decline at charge
// time (the technique registration.routes.test.js uses).
async function makeCardDecline(parentId) {
  await PaymentMethod.updateOne({ parentId }, { stripePaymentMethodId: 'pm_card_chargeDeclined' });
}

// An already-paid purchase, written straight to the schema — for suites that
// exercise booking with a credit, attendance, or cancellation without going
// through Stripe.
async function seedActiveEnrollment({ parent, student, coach, contract, quantity = 10, sessionsUsed = 0, sessionDurationMinutes = 30, createdAt }) {
  const enrollment = await PrivateClassEnrollment.create({
    studentId: student._id,
    parentId: parent._id,
    coachId: coach._id,
    coachContractId: contract._id,
    agreedHourlyRate: contract.studentBillingRate,
    sessionDurationMinutes,
    quantity,
    sessionsUsed,
    status: 'active',
  });

  if (createdAt) {
    await PrivateClassEnrollment.collection.updateOne({ _id: enrollment._id }, { $set: { createdAt } });
    return PrivateClassEnrollment.findById(enrollment._id);
  }

  return enrollment;
}

// A booking row for `schedule` on `day`, instants from the production gate.
async function seedBooking({ schedule, day, enrollment, status = 'confirmed', createdAt, ...rest }) {
  const startDate = combineDayAndTimeInTZ(day, schedule.startTime);
  const session = await PrivateClassSession.create({
    scheduleId: schedule._id,
    enrollmentId: enrollment ? enrollment._id : rest.enrollmentId,
    coachId: schedule.coachId,
    studentId: enrollment ? enrollment.studentId : rest.studentId,
    parentId: enrollment ? enrollment.parentId : rest.parentId,
    startDate,
    endDate: new Date(startDate.getTime() + schedule.durationMinutes * 60000),
    status,
  });

  if (createdAt) {
    await PrivateClassSession.collection.updateOne({ _id: session._id }, { $set: { createdAt } });
    return PrivateClassSession.findById(session._id);
  }

  return session;
}

module.exports = {
  TEST_PASSWORD,
  FROZEN_NOW,
  DEFAULT_RULES,
  freezeDate,
  seedUser,
  loginAgent,
  seedCoachWithRules,
  seedParentWithStudent,
  saveCard,
  makeCardDecline,
  seedActiveEnrollment,
  seedBooking,
};
