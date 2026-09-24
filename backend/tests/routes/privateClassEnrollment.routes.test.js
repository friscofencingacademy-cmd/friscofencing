process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

// mail.service is mocked (same rationale as registration.routes.test.js) —
// this suite asserts WHICH emails a purchase sends and with what; the
// rendered content is mail.service.test.js's job.
jest.mock('../../src/services/mail.service');

// STRIPE_SECRET_KEY must be loaded from the real .env BEFORE app.js is
// required — purchases hit Stripe's real TEST-mode API.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request = require('supertest');

const app = require('../../src/app');
const Holiday = require('../../src/models/holiday.model');
const Setting = require('../../src/models/setting.model');
const Service = require('../../src/models/service.model');
const Visit = require('../../src/models/visit.model');
const PrivateClassEnrollment = require('../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');
const { PerSessionRegistration } = require('../../src/models/registration.model');
const stripe = require('../../src/config/stripe');
const mailService = require('../../src/services/mail.service');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');
const {
  freezeDate,
  seedCoachWithRules,
  seedParentWithStudent,
  saveCard,
  makeCardDecline,
  seedActiveEnrollment,
  seedBooking,
} = require('../testUtils/privateLessons');

const STRIPE_TIMEOUT = 30000;

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  freezeDate();
  await seedServices();
  await Setting.create({ privateClassPackages: [{ quantity: 10, discountPercent: 10 }] });
});

afterEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  await clearTestDB();
});

// A coach (Tuesdays 16:30 + 17:00, 30 min, $65/hr -> $32.50/session) and a
// parent with a child and a saved real test card.
async function seedPurchaseScene(suffix, { card = true } = {}) {
  const coachScene = await seedCoachWithRules({ suffix });
  const parentScene = await seedParentWithStudent(suffix);

  if (card) {
    await saveCard(parentScene.parentAgent, stripe);
  }

  return { ...coachScene, ...parentScene, slot: coachScene.schedules[0] };
}

function purchase(parentAgent, { student, slot, day = '2026-10-06', quantity = 1 }) {
  return parentAgent.post('/api/v1/private-class-enrollments').send({
    studentId: student._id.toString(),
    scheduleId: String(slot._id),
    day,
    quantity,
  });
}

// docs/decisions/011-private-per-session-booking.md
describe('Private class enrollment (purchase) routes', () => {
  describe('GET /quote', () => {
    it('prices every purchase option for the rule, server-side, with no credits yet', async () => {
      const { parentAgent, student, slot } = await seedPurchaseScene('quote', { card: false });

      const res = await parentAgent.get(
        `/api/v1/private-class-enrollments/quote?studentId=${student._id}&scheduleId=${slot._id}`
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        durationMinutes: 30,
        hourlyRate: 65,
        availableCredits: 0,
        cancelCutoffHours: 24,
        options: [
          { unitPrice: 32.5, quantity: 1, discountPercent: 0, subtotal: 32.5, discountAmount: 0, total: 32.5 },
          { unitPrice: 32.5, quantity: 10, discountPercent: 10, subtotal: 325, discountAmount: 32.5, total: 292.5 },
        ],
      });
    });

    it('counts usable credits (same coach + length) and still offers them when the coach stops taking new students', async () => {
      const { parentAgent, parent, student, coach, contract, slot } = await seedPurchaseScene('quote-credits', { card: false });
      await seedActiveEnrollment({ parent, student, coach, contract, quantity: 10, sessionsUsed: 3 });
      await seedActiveEnrollment({ parent, student, coach, contract, quantity: 5, sessionsUsed: 0, sessionDurationMinutes: 60 });
      contract.isActive = false;
      await contract.save();

      const res = await parentAgent.get(
        `/api/v1/private-class-enrollments/quote?studentId=${student._id}&scheduleId=${slot._id}`
      );

      expect(res.body.availableCredits).toBe(7);
      expect(res.body.options).toEqual([]);
      expect(res.body.hourlyRate).toBeNull();
    });

    it("returns 403 for another parent's child", async () => {
      const { student, slot } = await seedPurchaseScene('quote-own', { card: false });
      const { parentAgent: stranger } = await seedParentWithStudent('quote-stranger');

      const res = await stranger.get(`/api/v1/private-class-enrollments/quote?studentId=${student._id}&scheduleId=${slot._id}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST / (buy sessions and book the first)', () => {
    it(
      'one session: charges the card, confirms the booking, writes the ledger row and a scheduled Visit, and emails parent + coach',
      async () => {
        const { parentAgent, parent, student, coach, contract, slot } = await seedPurchaseScene('one');

        const res = await purchase(parentAgent, { student, slot });

        expect(res.status).toBe(201);
        expect(res.body.remaining).toBe(0);

        const enrollment = await PrivateClassEnrollment.findById(res.body.enrollment._id);
        expect(enrollment).toMatchObject({
          status: 'active',
          quantity: 1,
          sessionsUsed: 1,
          discountPercent: 0,
          agreedHourlyRate: 65,
          sessionDurationMinutes: 30,
        });
        expect(String(enrollment.coachContractId)).toBe(String(contract._id));

        const session = await PrivateClassSession.findById(res.body.session._id);
        expect(session.status).toBe('confirmed');
        expect(session.startDate.toISOString()).toBe('2026-10-06T21:30:00.000Z');
        expect(session.endDate.toISOString()).toBe('2026-10-06T22:00:00.000Z');
        expect(String(session.coachId)).toBe(String(coach._id));

        const rows = await PerSessionRegistration.find({ parentId: parent._id });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: 'completed', quantity: 1, unitPrice: 32.5, discountPercent: 0, amount: 32.5 });
        expect(rows[0].stripePaymentIntentId).toMatch(/^pi_/);
        expect(String(rows[0].sessionId)).toBe(String(session._id));
        expect(String(rows[0].enrollmentId)).toBe(String(enrollment._id));

        const privateService = await Service.findOne({ code: 'private-lessons' });
        const visit = await Visit.findOne({ privateClassSessionId: session._id });
        expect(visit).toMatchObject({ status: 'scheduled', classType: 'private' });
        expect(String(visit.serviceId)).toBe(String(privateService._id));

        expect(mailService.sendPrivateClassBookingConfirmationEmail).toHaveBeenCalledTimes(1);
        const confirmation = mailService.sendPrivateClassBookingConfirmationEmail.mock.calls[0][0];
        expect(confirmation.purchaseRow.amount).toBe(32.5);
        expect(confirmation.cancelCutoffHours).toBe(24);
        expect(confirmation.invoicePdf).toBeInstanceOf(Buffer);
        expect(mailService.sendPrivateClassCoachBookingEmail).toHaveBeenCalledTimes(1);
      },
      STRIPE_TIMEOUT
    );

    it(
      'a pack of 10 at 10% off charges exactly the quoted total and leaves 9 sessions',
      async () => {
        const { parentAgent, student, slot } = await seedPurchaseScene('pack');
        const quote = await parentAgent.get(
          `/api/v1/private-class-enrollments/quote?studentId=${student._id}&scheduleId=${slot._id}`
        );
        const quotedTotal = quote.body.options.find((option) => option.quantity === 10).total;

        const res = await purchase(parentAgent, { student, slot, quantity: 10 });

        expect(res.status).toBe(201);
        expect(res.body.remaining).toBe(9);
        expect(res.body.registration).toMatchObject({ amount: quotedTotal, quantity: 10, unitPrice: 32.5, discountPercent: 10 });
        expect(quotedTotal).toBe(292.5);
      },
      STRIPE_TIMEOUT
    );

    it(
      'a declined card returns 402, records the failed charge, and gives the slot straight back',
      async () => {
        const { parentAgent, parent, student, slot } = await seedPurchaseScene('decline');
        await makeCardDecline(parent._id);

        const res = await purchase(parentAgent, { student, slot });

        expect(res.status).toBe(402);
        expect(typeof res.body.message).toBe('string');

        const [row] = await PerSessionRegistration.find({ parentId: parent._id });
        expect(row.status).toBe('failed');
        expect(row.failureMessage).toBeTruthy();
        expect((await PrivateClassEnrollment.findById(row.enrollmentId)).status).toBe('failed');
        const session = await PrivateClassSession.findById(row.sessionId);
        expect(session).toMatchObject({ status: 'released', releaseReason: 'payment_failed' });
        expect(await Visit.countDocuments({})).toBe(0);
        expect(mailService.sendPrivateClassBookingConfirmationEmail).not.toHaveBeenCalled();

        const dates = await request(app).get(`/api/v1/private-class-schedules/${slot._id}/available-dates?days=2`);
        expect(dates.body.dates.map((date) => date.day)).toEqual(['2026-10-06']);
      },
      STRIPE_TIMEOUT
    );

    it(
      'two parents racing for the same slot: exactly one wins, one card is charged, the loser gets 409 and nothing lingers',
      async () => {
        const first = await seedPurchaseScene('race-a');
        const second = await seedParentWithStudent('race-b');
        await saveCard(second.parentAgent, stripe);

        const results = await Promise.all([
          purchase(first.parentAgent, { student: first.student, slot: first.slot }),
          purchase(second.parentAgent, { student: second.student, slot: first.slot }),
        ]);

        expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
        expect(await PerSessionRegistration.countDocuments({})).toBe(1);
        expect(await PrivateClassEnrollment.countDocuments({})).toBe(1);
        expect(await PrivateClassSession.countDocuments({ status: { $in: ['pending', 'confirmed'] } })).toBe(1);
      },
      STRIPE_TIMEOUT
    );

    it(
      "takes over an abandoned hold (pending, older than the TTL, no charge) and marks the abandoned purchase failed",
      async () => {
        const scene = await seedPurchaseScene('stale');
        const other = await seedParentWithStudent('stale-owner');
        const abandonedEnrollment = await PrivateClassEnrollment.create({
          studentId: other.student._id,
          parentId: other.parent._id,
          coachId: scene.coach._id,
          coachContractId: scene.contract._id,
          agreedHourlyRate: 65,
          sessionDurationMinutes: 30,
          quantity: 1,
          status: 'pending',
        });
        const hold = await seedBooking({
          schedule: scene.slot,
          day: '2026-10-06',
          enrollment: abandonedEnrollment,
          status: 'pending',
          createdAt: new Date('2026-10-05T13:40:00.000Z'), // 20 minutes before FROZEN_NOW
        });

        const res = await purchase(scene.parentAgent, { student: scene.student, slot: scene.slot });

        expect(res.status).toBe(201);
        expect(await PrivateClassSession.findById(hold._id)).toMatchObject({ status: 'released', releaseReason: 'abandoned' });
        expect((await PrivateClassEnrollment.findById(abandonedEnrollment._id)).status).toBe('failed');
      },
      STRIPE_TIMEOUT
    );

    it('never takes over a recent hold, or one whose charge is in flight', async () => {
      const scene = await seedPurchaseScene('fresh-hold');
      const other = await seedParentWithStudent('fresh-owner');
      const holdEnrollment = await seedActiveEnrollment({ ...other, coach: scene.coach, contract: scene.contract });
      const recent = await seedBooking({
        schedule: scene.slot,
        day: '2026-10-06',
        enrollment: holdEnrollment,
        status: 'pending',
        createdAt: new Date('2026-10-05T13:55:00.000Z'), // 5 minutes old
      });

      expect((await purchase(scene.parentAgent, { student: scene.student, slot: scene.slot })).status).toBe(409);

      const privateService = await Service.findOne({ code: 'private-lessons' });
      await PrivateClassSession.collection.updateOne({ _id: recent._id }, { $set: { createdAt: new Date('2026-10-05T13:00:00.000Z') } });
      await PerSessionRegistration.create({
        serviceId: privateService._id,
        sessionId: recent._id,
        enrollmentId: holdEnrollment._id,
        parentId: other.parent._id,
        studentId: other.student._id,
        quantity: 1,
        unitPrice: 32.5,
        amount: 32.5,
        status: 'pending',
      });

      const res = await purchase(scene.parentAgent, { student: scene.student, slot: scene.slot });

      expect(res.status).toBe(409);
      expect((await PrivateClassSession.findById(recent._id)).status).toBe('pending');
      // Only the in-flight row exists — the losing attempts wrote nothing.
      expect(await PerSessionRegistration.countDocuments({})).toBe(1);
      expect(await PrivateClassEnrollment.countDocuments({ parentId: scene.parent._id })).toBe(0);
    });

    it.each([
      ['a quantity that is not offered', { quantity: 5 }, /quantity must be one of: 1, 10/],
      ['a holiday', { day: '2026-10-13' }, /academy holiday \(Fall break\)/],
      ['the wrong weekday', { day: '2026-10-07' }, /only offered on Tuesdays/],
      ['a date outside the range', { day: '2027-01-05' }, /outside the dates/],
      ['a malformed day', { day: 'next tuesday' }, /YYYY-MM-DD/],
    ])('returns 400 for %s, writing nothing', async (_label, override, message) => {
      await Holiday.create({ name: 'Fall break', startDate: new Date('2026-10-13'), endDate: new Date('2026-10-13') });
      const { parentAgent, student, slot } = await seedPurchaseScene(`bad-${Math.random()}`, { card: false });

      const res = await purchase(parentAgent, { student, slot, ...override });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
      expect(await PrivateClassEnrollment.countDocuments({})).toBe(0);
      expect(await PrivateClassSession.countDocuments({})).toBe(0);
      expect(await PerSessionRegistration.countDocuments({})).toBe(0);
    });

    it("returns 400 for today's lesson once it has started, writing nothing", async () => {
      const { parentAgent, student, slot } = await seedPurchaseScene('started', { card: false });
      freezeDate(new Date('2026-10-06T21:31:00.000Z')); // Tue 4:31 PM CDT — the 4:30 lesson began

      const res = await purchase(parentAgent, { student, slot, day: '2026-10-06' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already passed/);
      expect(await PrivateClassSession.countDocuments({})).toBe(0);
    });

    it('returns 400 with no card on file, writing nothing', async () => {
      const { parentAgent, student, slot } = await seedPurchaseScene('nocard', { card: false });

      const res = await purchase(parentAgent, { student, slot });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/payment method/);
      expect(await PrivateClassSession.countDocuments({})).toBe(0);
    });

    it('returns 409 when the coach is no longer taking new students', async () => {
      const { parentAgent, student, slot, contract } = await seedPurchaseScene('no-contract', { card: false });
      contract.isActive = false;
      await contract.save();

      expect((await purchase(parentAgent, { student, slot })).status).toBe(409);
    });

    it("returns 403 for another parent's child", async () => {
      const { student, slot } = await seedPurchaseScene('own', { card: false });
      const { parentAgent: stranger } = await seedParentWithStudent('stranger');

      expect((await purchase(stranger, { student, slot })).status).toBe(403);
    });
  });

  describe('GET /mine, GET / (admin), and payment history', () => {
    it(
      "lists the parent's paid purchases with remaining credits, the payment, and each booking's attendance — and history describes the purchase",
      async () => {
        const { parentAgent, adminAgent, student, slot } = await seedPurchaseScene('mine');
        await purchase(parentAgent, { student, slot, quantity: 10 });

        const res = await parentAgent.get('/api/v1/private-class-enrollments/mine');

        expect(res.status).toBe(200);
        expect(res.body.enrollments).toHaveLength(1);
        const [entry] = res.body.enrollments;
        expect(entry.remaining).toBe(9);
        expect(entry.enrollment.coachId.firstName).toBe('Dana');
        expect(entry.payment).toMatchObject({ amount: 292.5, quantity: 10, unitPrice: 32.5, discountPercent: 10 });
        expect(entry.sessions).toHaveLength(1);
        // Oct 6 4:30 PM is 31.5h after the frozen Monday 9 AM — still inside
        // the parent's online-cancel window.
        expect(entry.sessions[0]).toMatchObject({ status: 'confirmed', attendance: 'scheduled', canCancel: true });

        const history = await parentAgent.get('/api/v1/registrations/history');
        expect(history.status).toBe(200);
        expect(history.body.history).toHaveLength(1);
        expect(history.body.history[0]).toMatchObject({
          description: 'Private lessons with Dana Coachmine — 30 min × 10',
          amount: 292.5,
          status: 'completed',
          sessionDate: '2026-10-06T21:30:00.000Z',
        });

        const admin = await adminAgent.get('/api/v1/private-class-enrollments');
        expect(admin.status).toBe(200);
        expect(admin.body.enrollments).toHaveLength(1);
        expect((await adminAgent.get('/api/v1/private-class-enrollments?status=bogus')).status).toBe(400);
      },
      STRIPE_TIMEOUT
    );

    it('does not list a failed purchase as a credit balance', async () => {
      const { parentAgent, parent, student, slot } = await seedPurchaseScene('mine-failed');
      await makeCardDecline(parent._id);
      await purchase(parentAgent, { student, slot });

      const res = await parentAgent.get('/api/v1/private-class-enrollments/mine');

      expect(res.body.enrollments).toEqual([]);
    }, STRIPE_TIMEOUT);
  });
});
