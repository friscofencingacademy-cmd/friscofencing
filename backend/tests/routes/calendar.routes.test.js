process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';

const request = require('supertest');

const app = require('../../src/app');
const User = require('../../src/models/user.model');
const Level = require('../../src/models/level.model');
const Location = require('../../src/models/location.model');
const GroupClass = require('../../src/models/groupClass.model');
const GroupClassSchedule = require('../../src/models/groupClassSchedule.model');
const Holiday = require('../../src/models/holiday.model');
const Subscription = require('../../src/models/subscription.model');
const TrialClass = require('../../src/models/trialClass.model');
const CoachContract = require('../../src/models/coachContract.model');
const { dateOnlyUTC } = require('../../src/utils/dateShapes');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');
const { createSession } = require('../testUtils/sessions');
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

// Every test runs at the same frozen instant — Monday Oct 5 2026, 9:00 AM
// Central — so no result depends on the time of day it runs.
beforeEach(async () => {
  freezeDate();
  await seedServices();
});

afterEach(async () => {
  jest.useRealTimers();
  await clearTestDB();
});

const OCTOBER = '?from=2026-10-01&to=2026-10-31';

// The one event shape (docs/plans/calendar-view-plan.md C5).
const EVENT_KEYS = [
  'id',
  'kind',
  'day',
  'startsAt',
  'endsAt',
  'title',
  'coach',
  'locationName',
  'levelName',
  'durationMinutes',
  'scheduleId',
  'sessionId',
  'price',
  'mine',
  'students',
  'isHoliday',
  'holidayName',
].sort();

// A group class on Wednesdays 16:00–17:00 with sessions on the given days,
// written through the production instant builder (tests/testUtils/sessions.js).
// Level.order is unique, so each seeded level takes the next one.
let levelOrder = 0;

async function seedGroupClass({ suffix, dayOfWeek = 3, startTime = '16:00', endTime = '17:00', days }) {
  levelOrder += 1;
  const level = await Level.create({ name: `Beginner ${suffix}`, order: levelOrder });
  const location = await Location.create({ name: `Frisco HQ ${suffix}`, address: '123 Main St' });
  const groupClass = await GroupClass.create({
    name: `Foil ${suffix}`,
    levelId: level._id,
    locationId: location._id,
    capacity: 10,
  });
  const coach = await seedUser({ role: 'coach', firstName: 'Gia', lastName: `Group${suffix}`, email: `gcoach-${suffix}@example.com` });
  const schedule = await GroupClassSchedule.create({
    classId: groupClass._id,
    coachId: coach._id,
    dayOfWeek,
    startTime,
    endTime,
  });

  const sessions = {};
  for (const day of days) {
    sessions[day] = await createSession(schedule, dateOnlyUTC(day));
  }

  return { level, location, groupClass, coach, schedule, sessions };
}

async function seedAdminAgent(suffix = 'cal') {
  const email = `cal-admin-${suffix}@example.com`;
  await seedUser({ role: 'admin', email });
  return loginAgent(email);
}

function publicCalendar(query = OCTOBER) {
  return request(app).get(`/api/v1/calendar/public${query}`);
}

function kinds(events) {
  return [...new Set(events.map((event) => event.kind))].sort();
}

describe('Calendar routes', () => {
  describe('range validation (C6)', () => {
    it.each([
      ['a missing from', '?to=2026-10-31', 'from and to are required (YYYY-MM-DD)'],
      ['a missing to', '?from=2026-10-01', 'from and to are required (YYYY-MM-DD)'],
      ['a malformed day', '?from=10/01/2026&to=2026-10-31', 'from and to are required (YYYY-MM-DD)'],
      ['an impossible day', '?from=2026-02-30&to=2026-03-01', 'from and to are required (YYYY-MM-DD)'],
      ['from after to', '?from=2026-10-31&to=2026-10-01', 'from must be on or before to'],
      ['a 43-day range', '?from=2026-10-01&to=2026-11-12', 'A calendar range can be at most 42 days'],
      ['an unknown type', `${OCTOBER}&type=camps`, 'type must be one of: all, group, private'],
      ['a malformed coachId', `${OCTOBER}&coachId=nope`, 'coachId is not a valid id'],
    ])('returns 400 for %s', async (_label, query, message) => {
      const res = await publicCalendar(query);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
    });

    it('accepts exactly 42 days', async () => {
      expect((await publicCalendar('?from=2026-10-01&to=2026-11-11')).status).toBe(200);
    });

    it('clips the public range to today … today + 92 days and says where the horizon is', async () => {
      await seedGroupClass({ suffix: 'clip', days: ['2026-09-30', '2026-10-07'] });

      const res = await publicCalendar();

      expect(res.status).toBe(200);
      expect(res.body.from).toBe('2026-10-01');
      expect(res.body.to).toBe('2026-10-31');
      expect(res.body.horizonTo).toBe('2027-01-05');
      // Sep 30 is before today — outside even the requested range; Oct 7 is in.
      expect(res.body.events.map((event) => event.day)).toEqual(['2026-10-07']);
    });

    it('serves an empty month, not an error, for a range wholly past the horizon', async () => {
      await seedCoachWithRules({ suffix: 'far', rules: { ...DEFAULT_RULES, endDate: '2027-03-31' } });

      const res = await publicCalendar('?from=2027-02-01&to=2027-02-28');

      expect(res.status).toBe(200);
      expect(res.body.events).toEqual([]);
      expect(res.body.horizonTo).toBe('2027-01-05');
    });

    it('never serves a public day past the horizon, even inside a requested range', async () => {
      await seedCoachWithRules({ suffix: 'edge', rules: { ...DEFAULT_RULES, windowEnd: '17:00', endDate: '2027-03-31' } });

      const res = await publicCalendar('?from=2026-12-27&to=2027-01-30');

      expect(res.body.events.map((event) => event.day)).toEqual(['2026-12-29', '2027-01-05']);
    });

    it('lets an admin look back into past months, with no horizon', async () => {
      await seedGroupClass({ suffix: 'past', days: ['2026-09-02', '2026-09-30'] });
      const adminAgent = await seedAdminAgent();

      const res = await adminAgent.get('/api/v1/calendar?from=2026-09-01&to=2026-09-30');

      expect(res.status).toBe(200);
      expect(res.body.horizonTo).toBeNull();
      expect(res.body.events.map((event) => event.day)).toEqual(['2026-09-02', '2026-09-30']);
    });
  });

  describe('group sessions', () => {
    it('places each session on its own calendar day with class, level, location and coach', async () => {
      const { schedule, sessions, coach } = await seedGroupClass({ suffix: 'g', days: ['2026-10-07', '2026-10-14'] });

      const res = await publicCalendar();

      expect(res.body.events).toHaveLength(2);
      expect(res.body.events[0]).toEqual({
        id: `group:${sessions['2026-10-07']._id}`,
        kind: 'group',
        day: '2026-10-07',
        startsAt: '2026-10-07T21:00:00.000Z',
        endsAt: '2026-10-07T22:00:00.000Z',
        title: 'Foil g',
        coach: { id: String(coach._id), name: 'Gia Groupg' },
        locationName: 'Frisco HQ g',
        levelName: 'Beginner g',
        durationMinutes: 60,
        scheduleId: String(schedule._id),
        sessionId: String(sessions['2026-10-07']._id),
        price: null,
        mine: false,
        students: [],
        isHoliday: false,
        holidayName: null,
      });
    });

    it('drops a session that has already started today from the public calendar, but shows it to admin', async () => {
      // Monday 08:00 — started an hour before the frozen 9:00 AM.
      await seedGroupClass({ suffix: 'started', dayOfWeek: 1, startTime: '08:00', endTime: '09:00', days: ['2026-10-05', '2026-10-12'] });
      const adminAgent = await seedAdminAgent();

      const publicDays = (await publicCalendar()).body.events.map((event) => event.day);
      const adminDays = (await adminAgent.get(`/api/v1/calendar${OCTOBER}`)).body.events.map((event) => event.day);

      expect(publicDays).toEqual(['2026-10-12']);
      expect(adminDays).toEqual(['2026-10-05', '2026-10-12']);
    });

    it('omits a holiday-date session publicly and flags it for admin, next to an all-day holiday event', async () => {
      const { sessions } = await seedGroupClass({ suffix: 'hol', days: ['2026-10-07', '2026-10-14'] });
      const holiday = await Holiday.create({ name: 'Fall break', startDate: new Date('2026-10-14'), endDate: new Date('2026-10-15') });
      const adminAgent = await seedAdminAgent();

      const publicRes = await publicCalendar();
      const adminRes = await adminAgent.get(`/api/v1/calendar${OCTOBER}`);

      expect(publicRes.body.events.map((event) => event.day)).toEqual(['2026-10-07']);

      const flagged = adminRes.body.events.find((event) => event.sessionId === String(sessions['2026-10-14']._id));
      expect(flagged).toMatchObject({ kind: 'group', isHoliday: true, holidayName: 'Fall break' });

      const holidayEvents = adminRes.body.events.filter((event) => event.kind === 'holiday');
      expect(holidayEvents.map((event) => [event.id, event.day, event.title, event.startsAt])).toEqual([
        [`holiday:${holiday._id}:2026-10-14`, '2026-10-14', 'Fall break', null],
        [`holiday:${holiday._id}:2026-10-15`, '2026-10-15', 'Fall break', null],
      ]);
    });

    it('skips a session whose class or coach no longer exists', async () => {
      const kept = await seedGroupClass({ suffix: 'kept', days: ['2026-10-07'] });
      const noCoach = await seedGroupClass({ suffix: 'nocoach', days: ['2026-10-08'] });
      const noClass = await seedGroupClass({ suffix: 'noclass', days: ['2026-10-09'] });
      await User.deleteOne({ _id: noCoach.coach._id });
      await GroupClass.deleteOne({ _id: noClass.groupClass._id });

      const res = await publicCalendar();

      expect(res.status).toBe(200);
      expect(res.body.events.map((event) => event.sessionId)).toEqual([String(kept.sessions['2026-10-07']._id)]);
    });
  });

  describe('open private slots', () => {
    it("lists each open slot with the coach's single-session price, straight from the purchase quote", async () => {
      const { coach, schedules } = await seedCoachWithRules({ suffix: 'open', studentBillingRate: 65 });
      const { parentAgent, student } = await seedParentWithStudent('open');

      const res = await publicCalendar();
      const quote = await parentAgent.get(
        `/api/v1/private-class-enrollments/quote?studentId=${student._id}&scheduleId=${schedules[0]._id}`
      );

      // Tuesdays Oct 6–27, two slots each.
      expect(res.body.events).toHaveLength(8);
      expect(res.body.events[0]).toEqual({
        id: `private-open:${schedules[0]._id}:2026-10-06`,
        kind: 'private-open',
        day: '2026-10-06',
        startsAt: '2026-10-06T21:30:00.000Z',
        endsAt: '2026-10-06T22:00:00.000Z',
        title: 'Private lesson — 30 min',
        coach: { id: String(coach._id), name: 'Dana Coachopen' },
        locationName: null,
        levelName: null,
        durationMinutes: 30,
        scheduleId: String(schedules[0]._id),
        sessionId: null,
        price: 32.5,
        mine: false,
        students: [],
        isHoliday: false,
        holidayName: null,
      });
      expect(res.body.events[0].price).toBe(quote.body.options[0].unitPrice);
    });

    it('hides a taken slot (O2) — the calendar agrees with the wizard picker', async () => {
      const { coach, contract, schedules } = await seedCoachWithRules({ suffix: 'taken', rules: { ...DEFAULT_RULES, windowEnd: '17:00' } });
      const { parent, student } = await seedParentWithStudent('taken');
      const enrollment = await seedActiveEnrollment({ parent, student, coach, contract });
      await seedBooking({ schedule: schedules[0], day: '2026-10-13', enrollment });

      const calendarDays = (await publicCalendar()).body.events.map((event) => event.day);
      const picker = await request(app).get(`/api/v1/private-class-schedules/${schedules[0]._id}/available-dates`);
      const pickerOctober = picker.body.dates.map((date) => date.day).filter((day) => day <= '2026-10-31');

      expect(calendarDays).toEqual(['2026-10-06', '2026-10-20', '2026-10-27']);
      expect(calendarDays).toEqual(pickerOctober);
    });

    it("omits a coach without an active contract and a rule whose range misses the month", async () => {
      const inactive = await seedCoachWithRules({ suffix: 'inactive' });
      await CoachContract.updateOne({ _id: inactive.contract._id }, { isActive: false });
      await seedCoachWithRules({ suffix: 'later', rules: { ...DEFAULT_RULES, startDate: '2026-11-01', endDate: '2026-11-30' } });

      const res = await publicCalendar();

      expect(res.body.events).toEqual([]);
    });

    it('places an 11:30 PM Central lesson on its own day, although it is the next day in UTC', async () => {
      const { coach, contract, schedules } = await seedCoachWithRules({
        suffix: 'late',
        rules: { ...DEFAULT_RULES, windowStart: '23:30', windowEnd: '23:59', slotDurationMinutes: 15 },
      });
      const { parent, student } = await seedParentWithStudent('late');
      const enrollment = await seedActiveEnrollment({ parent, student, coach, contract, sessionDurationMinutes: 15 });
      await seedBooking({ schedule: schedules[0], day: '2026-10-13', enrollment });
      const adminAgent = await seedAdminAgent();

      const open = (await publicCalendar()).body.events[0];
      const booked = (await adminAgent.get(`/api/v1/calendar${OCTOBER}`)).body.events.find(
        (event) => event.kind === 'private-booked'
      );

      expect(open.startsAt).toBe('2026-10-07T04:30:00.000Z');
      expect(open.day).toBe('2026-10-06');
      expect(booked.startsAt).toBe('2026-10-14T04:30:00.000Z');
      expect(booked.day).toBe('2026-10-13');
    });

    it('keeps slots on the right day through the Nov 1 daylight-saving change', async () => {
      await seedCoachWithRules({ suffix: 'dst', rules: { ...DEFAULT_RULES, windowEnd: '17:00' } });

      const res = await publicCalendar('?from=2026-10-25&to=2026-11-07');

      expect(res.body.events.map((event) => [event.day, event.startsAt])).toEqual([
        ['2026-10-27', '2026-10-27T21:30:00.000Z'], // CDT, UTC-5
        ['2026-11-03', '2026-11-03T22:30:00.000Z'], // CST, UTC-6
      ]);
    });
  });

  describe('filters', () => {
    it('narrows by coachId and by type', async () => {
      const group = await seedGroupClass({ suffix: 'f', days: ['2026-10-07'] });
      const priv = await seedCoachWithRules({ suffix: 'f', rules: { ...DEFAULT_RULES, windowEnd: '17:00' } });

      const all = (await publicCalendar()).body.events;
      const groupOnly = (await publicCalendar(`${OCTOBER}&type=group`)).body.events;
      const privateOnly = (await publicCalendar(`${OCTOBER}&type=private`)).body.events;
      const groupCoach = (await publicCalendar(`${OCTOBER}&coachId=${group.coach._id}`)).body.events;
      const privateCoach = (await publicCalendar(`${OCTOBER}&coachId=${priv.coach._id}`)).body.events;
      const both = (await publicCalendar(`${OCTOBER}&coachId=${priv.coach._id}&type=group`)).body.events;

      expect(kinds(all)).toEqual(['group', 'private-open']);
      expect(kinds(groupOnly)).toEqual(['group']);
      expect(kinds(privateOnly)).toEqual(['private-open']);
      expect(groupCoach.every((event) => event.coach.id === String(group.coach._id))).toBe(true);
      expect(kinds(groupCoach)).toEqual(['group']);
      expect(privateCoach).toHaveLength(4);
      expect(kinds(privateCoach)).toEqual(['private-open']);
      expect(both).toEqual([]);
    });

    it('lists every coach with something in range — even one whose only slot that month is taken', async () => {
      const group = await seedGroupClass({ suffix: 'list', days: ['2026-10-07'] });
      const busy = await seedCoachWithRules({
        suffix: 'busy',
        rules: { ...DEFAULT_RULES, windowEnd: '17:00', startDate: '2026-10-13', endDate: '2026-10-13' },
      });
      const { parent, student } = await seedParentWithStudent('busy');
      const enrollment = await seedActiveEnrollment({ parent, student, coach: busy.coach, contract: busy.contract });
      await seedBooking({ schedule: busy.schedules[0], day: '2026-10-13', enrollment });

      const res = await publicCalendar(`${OCTOBER}&coachId=${group.coach._id}`);

      expect(res.body.coaches).toEqual([
        { id: String(busy.coach._id), name: 'Dana Coachbusy' },
        { id: String(group.coach._id), name: 'Gia Grouplist' },
      ]);
    });
  });

  describe('privacy (C5)', () => {
    it('never puts a student, a booking or a holiday on the public calendar', async () => {
      const group = await seedGroupClass({ suffix: 'priv', days: ['2026-10-07', '2026-10-14'] });
      const { coach, contract, schedules } = await seedCoachWithRules({ suffix: 'priv' });
      const { parent, student } = await seedParentWithStudent('priv');
      const enrollment = await seedActiveEnrollment({ parent, student, coach, contract });
      await seedBooking({ schedule: schedules[0], day: '2026-10-06', enrollment });
      await Subscription.create({
        studentId: student._id,
        scheduleId: group.schedule._id,
        parentId: parent._id,
        currentPeriodStart: dateOnlyUTC('2026-10-01'),
        currentPeriodEnd: dateOnlyUTC('2026-11-01'),
        nextBillingDate: dateOnlyUTC('2026-11-01'),
      });
      await Holiday.create({ name: 'Fall break', startDate: new Date('2026-10-21'), endDate: new Date('2026-10-21') });

      const res = await publicCalendar();

      expect(res.body.events.length).toBeGreaterThan(0);
      res.body.events.forEach((event) => {
        expect(Object.keys(event).sort()).toEqual(EVENT_KEYS);
        expect(event.students).toEqual([]);
        expect(event.mine).toBe(false);
      });
      expect(kinds(res.body.events)).toEqual(['group', 'private-open']);
      expect(JSON.stringify(res.body)).not.toContain('Sam');
    });
  });

  describe('parent calendar (/calendar/mine, O1)', () => {
    async function seedFamily() {
      const group = await seedGroupClass({ suffix: 'fam', days: ['2026-10-07', '2026-10-14', '2026-11-04'] });
      const { parent, student, parentAgent } = await seedParentWithStudent('fam');
      const sibling = await User.create({ role: 'student', firstName: 'Kit', lastName: 'fam', parentId: parent._id });
      return { group, parent, student, sibling, parentAgent };
    }

    it("marks the family's own class sessions with the child — but a next-month enrollment claims nothing before its period starts", async () => {
      const { group, parent, student, sibling, parentAgent } = await seedFamily();
      await Subscription.create({
        studentId: student._id,
        scheduleId: group.schedule._id,
        parentId: parent._id,
        currentPeriodStart: dateOnlyUTC('2026-10-01'),
        currentPeriodEnd: dateOnlyUTC('2026-11-01'),
        nextBillingDate: dateOnlyUTC('2026-11-01'),
      });
      // "Enroll for next month": active now, period starts Nov 1.
      await Subscription.create({
        studentId: sibling._id,
        scheduleId: group.schedule._id,
        parentId: parent._id,
        currentPeriodStart: dateOnlyUTC('2026-11-01'),
        currentPeriodEnd: dateOnlyUTC('2026-12-01'),
        nextBillingDate: dateOnlyUTC('2026-12-01'),
      });

      const res = await parentAgent.get('/api/v1/calendar/mine?from=2026-10-01&to=2026-11-10');

      expect(res.status).toBe(200);
      const byDay = Object.fromEntries(
        res.body.events.filter((event) => event.kind === 'group').map((event) => [event.day, event])
      );
      expect(byDay['2026-10-07'].mine).toBe(true);
      expect(byDay['2026-10-07'].students).toEqual([{ id: String(student._id), name: 'Sam fam' }]);
      expect(byDay['2026-11-04'].students.map((ref) => ref.name).sort()).toEqual(['Kit fam', 'Sam fam']);
      expect(res.body.horizonTo).toBe('2027-01-05');
    });

    it("marks a child's trial session", async () => {
      const { group, sibling, parentAgent } = await seedFamily();
      await TrialClass.create({ studentId: sibling._id, sessionId: group.sessions['2026-10-14']._id });

      const res = await parentAgent.get(`/api/v1/calendar/mine${OCTOBER}`);

      const trial = res.body.events.find((event) => event.day === '2026-10-14');
      expect(trial).toMatchObject({ mine: true, students: [{ id: String(sibling._id), name: 'Kit fam' }] });
      expect(res.body.events.find((event) => event.day === '2026-10-07').mine).toBe(false);
    });

    it("shows the family's own private booking, never another family's, and never a taken slot as open", async () => {
      const { coach, contract, schedules } = await seedCoachWithRules({ suffix: 'mine', rules: { ...DEFAULT_RULES, windowEnd: '17:00' } });
      const own = await seedParentWithStudent('own');
      const other = await seedParentWithStudent('other');
      const ownEnrollment = await seedActiveEnrollment({ parent: own.parent, student: own.student, coach, contract });
      const otherEnrollment = await seedActiveEnrollment({ parent: other.parent, student: other.student, coach, contract });
      const booking = await seedBooking({ schedule: schedules[0], day: '2026-10-06', enrollment: ownEnrollment });
      await seedBooking({ schedule: schedules[0], day: '2026-10-13', enrollment: otherEnrollment });

      const res = await own.parentAgent.get(`/api/v1/calendar/mine${OCTOBER}`);

      expect(res.body.events.map((event) => [event.day, event.kind])).toEqual([
        ['2026-10-06', 'private-booked'],
        ['2026-10-20', 'private-open'],
        ['2026-10-27', 'private-open'],
      ]);
      expect(res.body.events[0]).toMatchObject({
        id: `private-booked:${booking._id}`,
        mine: true,
        sessionId: String(booking._id),
        students: [{ id: String(own.student._id), name: 'Sam own' }],
      });
      expect(JSON.stringify(res.body)).not.toContain('Sam other');
    });
  });

  describe('admin calendar', () => {
    it('shows every confirmed booking with its student, and no cancelled one', async () => {
      const { coach, contract, schedules } = await seedCoachWithRules({ suffix: 'adm', rules: { ...DEFAULT_RULES, windowEnd: '17:00' } });
      const { parent, student } = await seedParentWithStudent('adm');
      const enrollment = await seedActiveEnrollment({ parent, student, coach, contract });
      await seedBooking({ schedule: schedules[0], day: '2026-10-06', enrollment });
      await seedBooking({ schedule: schedules[0], day: '2026-10-13', enrollment, status: 'cancelled' });
      const adminAgent = await seedAdminAgent();

      const res = await adminAgent.get(`/api/v1/calendar${OCTOBER}`);

      const booked = res.body.events.filter((event) => event.kind === 'private-booked');
      expect(booked).toHaveLength(1);
      expect(booked[0]).toMatchObject({
        day: '2026-10-06',
        mine: false,
        students: [{ id: String(student._id), name: 'Sam adm' }],
      });
      // The cancelled Oct 13 slot is open again.
      expect(res.body.events.filter((event) => event.kind === 'private-open').map((event) => event.day)).toEqual([
        '2026-10-13',
        '2026-10-20',
        '2026-10-27',
      ]);
    });
  });

  describe('guards', () => {
    it('serves /calendar/public logged out', async () => {
      expect((await publicCalendar()).status).toBe(200);
    });

    it('requires a login for /calendar/mine and /calendar', async () => {
      expect((await request(app).get(`/api/v1/calendar/mine${OCTOBER}`)).status).toBe(401);
      expect((await request(app).get(`/api/v1/calendar${OCTOBER}`)).status).toBe(401);
    });

    it('allows /calendar/mine for a parent only', async () => {
      const adminAgent = await seedAdminAgent();
      const { coachAgent } = await seedCoachWithRules({ suffix: 'guard-mine', rules: null });

      expect((await adminAgent.get(`/api/v1/calendar/mine${OCTOBER}`)).status).toBe(403);
      expect((await coachAgent.get(`/api/v1/calendar/mine${OCTOBER}`)).status).toBe(403);
    });

    it('allows /calendar for admin and superadmin only', async () => {
      const { parentAgent } = await seedParentWithStudent('guard');
      const { coachAgent } = await seedCoachWithRules({ suffix: 'guard', rules: null });
      await seedUser({ role: 'superadmin', email: 'cal-super@example.com' });
      const superAgent = await loginAgent('cal-super@example.com');

      expect((await parentAgent.get(`/api/v1/calendar${OCTOBER}`)).status).toBe(403);
      expect((await coachAgent.get(`/api/v1/calendar${OCTOBER}`)).status).toBe(403);
      expect((await superAgent.get(`/api/v1/calendar${OCTOBER}`)).status).toBe(200);
    });
  });
});
