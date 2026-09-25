process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const Holiday = require('../../src/models/holiday.model');
const PrivateClassSchedule = require('../../src/models/privateClassSchedule.model');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');
const {
  DEFAULT_RULES,
  freezeDate,
  seedUser,
  loginAgent,
  seedCoachWithRules,
  seedParentWithStudent,
  seedActiveEnrollment,
  seedBooking,
} = require('../testUtils/privateLessons');

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
});

afterEach(async () => {
  jest.useRealTimers();
  await clearTestDB();
});

// docs/decisions/011-private-per-session-booking.md — a schedule is an
// availability rule; bookable dates are computed, never generated.
describe('Private class schedule routes', () => {
  describe('POST /api/v1/private-class-schedules (bulk publish)', () => {
    it('publishes one rule per weekday x slot, with the range as calendar-day sentinels and no sessions', async () => {
      const { coach, coachAgent } = await seedCoachWithRules({ suffix: 'bulk', rules: null });

      const res = await coachAgent.post('/api/v1/private-class-schedules').send({
        daysOfWeek: [4, 2],
        windowStart: '17:00',
        windowEnd: '20:00',
        slotDurationMinutes: 30,
        startDate: '2026-10-01',
        endDate: '2026-12-31',
      });

      expect(res.status).toBe(201);
      expect(res.body.schedules).toHaveLength(12);

      const rules = await PrivateClassSchedule.find({ coachId: coach._id }).sort({ dayOfWeek: 1, startTime: 1 });
      expect(rules.map((rule) => `${rule.dayOfWeek} ${rule.startTime}`)).toEqual([
        '2 17:00', '2 17:30', '2 18:00', '2 18:30', '2 19:00', '2 19:30',
        '4 17:00', '4 17:30', '4 18:00', '4 18:30', '4 19:00', '4 19:30',
      ]);
      rules.forEach((rule) => {
        expect(rule.durationMinutes).toBe(30);
        expect(rule.startDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
        expect(rule.endDate.toISOString()).toBe('2026-12-31T00:00:00.000Z');
      });
    });

    it("defaults the slot length to the coach's contract and drops a partial slot at the end of the window", async () => {
      const { coachAgent } = await seedCoachWithRules({ suffix: 'default-len', sessionDurationMinutes: 60, rules: null });

      const res = await coachAgent.post('/api/v1/private-class-schedules').send({
        daysOfWeek: [1],
        windowStart: '17:00',
        windowEnd: '19:30',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      });

      expect(res.status).toBe(201);
      expect(res.body.schedules.map((rule) => rule.startTime)).toEqual(['17:00', '18:00']);
      expect(res.body.schedules[0].durationMinutes).toBe(60);
    });

    it('lets an admin publish on behalf of a coach, and requires coachId to do so', async () => {
      const { coach, adminAgent } = await seedCoachWithRules({ suffix: 'admin-pub', rules: null });

      const missing = await adminAgent.post('/api/v1/private-class-schedules').send(DEFAULT_RULES);
      expect(missing.status).toBe(400);

      const res = await adminAgent
        .post('/api/v1/private-class-schedules')
        .send({ ...DEFAULT_RULES, coachId: coach._id.toString() });
      expect(res.status).toBe(201);
      expect(res.body.schedules.every((rule) => rule.coachId === coach._id.toString())).toBe(true);
    });

    it('returns 400 for a coach with no active contract, creating nothing', async () => {
      const coach = await seedUser({ role: 'coach', email: 'coach-nocontract@example.com' });
      const coachAgent = await loginAgent(coach.email);

      const res = await coachAgent.post('/api/v1/private-class-schedules').send(DEFAULT_RULES);

      expect(res.status).toBe(400);
      expect(await PrivateClassSchedule.countDocuments({})).toBe(0);
    });

    it('rejects any slot overlapping published availability (time AND date range), creating nothing, and names every conflict', async () => {
      const { coachAgent } = await seedCoachWithRules({ suffix: 'overlap' }); // Tue 16:30, 17:00 (30 min)

      const res = await coachAgent.post('/api/v1/private-class-schedules').send({
        daysOfWeek: [2],
        windowStart: '16:45',
        windowEnd: '17:45',
        slotDurationMinutes: 60,
        startDate: '2026-12-01',
        endDate: '2027-01-31',
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Tuesday 16:45');
      expect(await PrivateClassSchedule.countDocuments({})).toBe(2);
    });

    it('allows back-to-back slots, another weekday, and a non-intersecting date range', async () => {
      const { coachAgent } = await seedCoachWithRules({ suffix: 'no-overlap' }); // Tue 16:30–17:30

      const adjacent = await coachAgent.post('/api/v1/private-class-schedules').send({ ...DEFAULT_RULES, windowStart: '17:30', windowEnd: '18:00' });
      const otherDay = await coachAgent.post('/api/v1/private-class-schedules').send({ ...DEFAULT_RULES, daysOfWeek: [3] });
      const laterRange = await coachAgent
        .post('/api/v1/private-class-schedules')
        .send({ ...DEFAULT_RULES, startDate: '2027-01-01', endDate: '2027-03-31' });

      expect([adjacent.status, otherDay.status, laterRange.status]).toEqual([201, 201, 201]);
    });

    it.each([
      ['a malformed date', { startDate: '10/01/2026' }, /YYYY-MM-DD/],
      ['an impossible date', { startDate: '2026-02-30' }, /not a real calendar date/],
      ['an end before the start', { startDate: '2026-12-31', endDate: '2026-10-01' }, /on or after startDate/],
      ['a range over a year', { startDate: '2026-10-01', endDate: '2027-10-05' }, /at most 366 days/],
      ['a range already over', { startDate: '2026-01-01', endDate: '2026-09-30' }, /in the past/],
      ['an empty weekday list', { daysOfWeek: [] }, /daysOfWeek/],
      ['an invalid weekday', { daysOfWeek: [7] }, /daysOfWeek/],
      ['a window that ends before it starts', { windowStart: '18:00', windowEnd: '17:00' }, /after windowStart/],
      ['a window shorter than one slot', { windowStart: '17:00', windowEnd: '17:15' }, /shorter than one/],
      ['a malformed time', { windowStart: '5pm' }, /HH:mm/],
      ['a too-short slot', { slotDurationMinutes: 10 }, /at least 15/],
    ])('returns 400 for %s, creating nothing', async (_label, override, message) => {
      const { coachAgent } = await seedCoachWithRules({ suffix: `bad-${Math.random()}`, rules: null });

      const res = await coachAgent.post('/api/v1/private-class-schedules').send({ ...DEFAULT_RULES, ...override });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
      expect(await PrivateClassSchedule.countDocuments({})).toBe(0);
    });

    it('returns 403 for a parent', async () => {
      const { parentAgent } = await seedParentWithStudent('pub-403');
      const res = await parentAgent.post('/api/v1/private-class-schedules').send(DEFAULT_RULES);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /mine and GET / (admin)', () => {
    it("lists a coach's current rules with bookedCount, hiding rules whose range is over", async () => {
      const { coach, contract, coachAgent, schedules } = await seedCoachWithRules({ suffix: 'mine' });
      await PrivateClassSchedule.create({
        coachId: coach._id,
        dayOfWeek: 3,
        startTime: '10:00',
        durationMinutes: 30,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-30'),
      });
      const { parent, student } = await seedParentWithStudent('mine');
      const enrollment = await seedActiveEnrollment({ parent, student, coach, contract });
      await seedBooking({ schedule: schedules[0], day: '2026-10-06', enrollment });
      await seedBooking({ schedule: schedules[0], day: '2026-10-13', enrollment, status: 'cancelled' });

      const res = await coachAgent.get('/api/v1/private-class-schedules/mine');

      expect(res.status).toBe(200);
      expect(res.body.schedules).toHaveLength(2);
      const first = res.body.schedules.find((rule) => rule._id === String(schedules[0]._id));
      expect(first.bookedCount).toBe(1);
    });

    it('lets an admin list every coach, filtered by coachId, with the coach populated', async () => {
      const { coach, adminAgent } = await seedCoachWithRules({ suffix: 'admin-list' });
      await seedCoachWithRules({ suffix: 'admin-list-2' });

      const res = await adminAgent.get(`/api/v1/private-class-schedules?coachId=${coach._id}`);

      expect(res.status).toBe(200);
      expect(res.body.schedules).toHaveLength(2);
      expect(res.body.schedules[0].coachId.lastName).toBe('Coachadmin-list');
    });
  });

  describe('GET /public', () => {
    it("lists coaches with an active contract, each rule priced with that coach's own packs for its length — no student data", async () => {
      // docs/plans/coach-pack-pricing-plan.md: packs are per coach, per length.
      const { contract: ownContract } = await seedCoachWithRules({
        suffix: 'public',
        studentBillingRate: 65,
        privateLessonPacks: [
          { sessionDurationMinutes: 30, quantity: 10, price: 300 },
          { sessionDurationMinutes: 60, quantity: 5, price: 300 },
        ],
      });
      const { contract } = await seedCoachWithRules({
        suffix: 'public-gone',
        privateLessonPacks: [{ sessionDurationMinutes: 30, quantity: 10, price: 280 }],
      });
      contract.isActive = false;
      await contract.save();
      const tenPackId = String(ownContract.privateLessonPacks.find((pack) => pack.sessionDurationMinutes === 30)._id);

      const res = await request(app).get('/api/v1/private-class-schedules/public');

      expect(res.status).toBe(200);
      expect(res.body.coaches).toHaveLength(1);
      expect(res.body.coaches[0].coachName).toBe('Dana Coachpublic');
      expect(res.body.coaches[0].slots[0]).toEqual({
        scheduleId: expect.any(String),
        dayOfWeek: 2,
        dayName: 'Tuesday',
        startTime: '16:30',
        durationMinutes: 30,
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
        sessionPrice: 32.5,
        hourlyRate: 65,
        // Only this coach's 30-minute pack — never the 60-minute one, never
        // another coach's.
        options: [
          { packId: null, quantity: 1, unitPrice: 32.5, subtotal: 32.5, savings: 0, total: 32.5 },
          { packId: tenPackId, quantity: 10, unitPrice: 32.5, subtotal: 325, savings: 25, total: 300 },
        ],
      });
      expect(res.body).not.toHaveProperty('packageOffers');
    });

    it("gives each slot's options the exact shape the purchase quote returns (one shape, plan D14 d)", async () => {
      const { schedules } = await seedCoachWithRules({
        suffix: 'public-shape',
        privateLessonPacks: [{ sessionDurationMinutes: 30, quantity: 10, price: 300 }],
      });
      const { parentAgent, student } = await seedParentWithStudent('public-shape');

      const listing = await request(app).get('/api/v1/private-class-schedules/public');
      const quote = await parentAgent.get(
        `/api/v1/private-class-enrollments/quote?studentId=${student._id}&scheduleId=${schedules[0]._id}`
      );

      const slot = listing.body.coaches[0].slots.find((candidate) => candidate.scheduleId === String(schedules[0]._id));
      expect(quote.status).toBe(200);
      expect(slot.options).toEqual(quote.body.options);
    });
  });

  describe('GET /:id/available-dates', () => {
    async function datesFor(scheduleId, query = '') {
      return request(app).get(`/api/v1/private-class-schedules/${scheduleId}/available-dates${query}`);
    }

    it("returns the rule's weekdays in the window as real instants, minus holidays and slots already held", async () => {
      const { coach, contract, schedules } = await seedCoachWithRules({ suffix: 'dates' });
      const [slot] = schedules; // Tuesday 16:30
      await Holiday.create({ name: 'Fall break', startDate: new Date('2026-10-13'), endDate: new Date('2026-10-13') });
      const { parent, student } = await seedParentWithStudent('dates');
      const enrollment = await seedActiveEnrollment({ parent, student, coach, contract });
      await seedBooking({ schedule: slot, day: '2026-10-20', enrollment });
      await seedBooking({ schedule: slot, day: '2026-10-27', enrollment, status: 'cancelled' });
      await seedBooking({ schedule: slot, day: '2026-11-03', enrollment, status: 'released' });

      const res = await datesFor(slot._id, '?days=35');

      expect(res.status).toBe(200);
      // Frozen now = Mon Oct 5; window to Nov 9. Oct 13 holiday and Oct 20
      // confirmed are gone; cancelled/released bookings free their slot.
      expect(res.body.dates.map((date) => date.day)).toEqual(['2026-10-06', '2026-10-27', '2026-11-03']);
      // 4:30 PM Central: CDT (UTC-5) before Nov 1, CST (UTC-6) after.
      expect(res.body.dates[0]).toEqual({
        day: '2026-10-06',
        startDate: '2026-10-06T21:30:00.000Z',
        endDate: '2026-10-06T22:00:00.000Z',
      });
      expect(res.body.dates[2].startDate).toBe('2026-11-03T22:30:00.000Z');
    });

    it("offers today's lesson until it starts, then never again", async () => {
      const { schedules } = await seedCoachWithRules({ suffix: 'today' });

      freezeDate(new Date('2026-10-06T21:29:00.000Z')); // Tue 4:29 PM CDT
      expect((await datesFor(schedules[0]._id, '?days=1')).body.dates.map((date) => date.day)).toEqual(['2026-10-06']);

      freezeDate(new Date('2026-10-06T21:30:00.000Z')); // 4:30 PM — started
      expect((await datesFor(schedules[0]._id, '?days=1')).body.dates).toEqual([]);
    });

    it("never offers a date outside the rule's range (both edges inclusive)", async () => {
      const { schedules } = await seedCoachWithRules({
        suffix: 'edges',
        rules: { ...DEFAULT_RULES, windowEnd: '17:00', startDate: '2026-10-13', endDate: '2026-10-20' },
      });

      const res = await datesFor(schedules[0]._id);

      expect(res.body.dates.map((date) => date.day)).toEqual(['2026-10-13', '2026-10-20']);
    });

    it('returns 400 for an invalid days value and 404 for an unknown or retired rule', async () => {
      const { schedules } = await seedCoachWithRules({ suffix: 'dates-bad' });

      expect((await datesFor(schedules[0]._id, '?days=0')).status).toBe(400);
      expect((await datesFor(schedules[0]._id, '?days=500')).status).toBe(400);
      expect((await datesFor('64b000000000000000000000')).status).toBe(404);

      await PrivateClassSchedule.updateOne({ _id: schedules[0]._id }, { isActive: false });
      expect((await datesFor(schedules[0]._id)).status).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('deletes a rule nobody ever booked', async () => {
      const { coachAgent, schedules } = await seedCoachWithRules({ suffix: 'del' });

      const res = await coachAgent.delete(`/api/v1/private-class-schedules/${schedules[0]._id}`);

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('deleted');
      expect(await PrivateClassSchedule.findById(schedules[0]._id)).toBeNull();
    });

    it('returns 409 while the rule has an upcoming booking', async () => {
      const { coach, contract, coachAgent, schedules } = await seedCoachWithRules({ suffix: 'del-409' });
      const { parent, student } = await seedParentWithStudent('del-409');
      const enrollment = await seedActiveEnrollment({ parent, student, coach, contract });
      await seedBooking({ schedule: schedules[0], day: '2026-10-06', enrollment });

      const res = await coachAgent.delete(`/api/v1/private-class-schedules/${schedules[0]._id}`);

      expect(res.status).toBe(409);
      expect(await PrivateClassSchedule.findById(schedules[0]._id)).not.toBeNull();
    });

    it('retires (never deletes) a rule with only past bookings, so their scheduleId stays valid', async () => {
      const { coach, contract, coachAgent, schedules } = await seedCoachWithRules({ suffix: 'retire' });
      const { parent, student } = await seedParentWithStudent('retire');
      const enrollment = await seedActiveEnrollment({ parent, student, coach, contract });
      await seedBooking({ schedule: schedules[0], day: '2026-10-06', enrollment });
      freezeDate(new Date('2026-10-07T14:00:00.000Z'));

      const res = await coachAgent.delete(`/api/v1/private-class-schedules/${schedules[0]._id}`);

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('retired');
      expect((await PrivateClassSchedule.findById(schedules[0]._id)).isActive).toBe(false);
      const mine = await coachAgent.get('/api/v1/private-class-schedules/mine');
      expect(mine.body.schedules.map((rule) => rule._id)).not.toContain(String(schedules[0]._id));
    });

    it("returns 403 for another coach's rule", async () => {
      const { schedules } = await seedCoachWithRules({ suffix: 'owner' });
      const { coachAgent: otherAgent } = await seedCoachWithRules({ suffix: 'other', rules: null });

      const res = await otherAgent.delete(`/api/v1/private-class-schedules/${schedules[0]._id}`);

      expect(res.status).toBe(403);
    });
  });
});
