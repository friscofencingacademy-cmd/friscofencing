const mongoose = require('mongoose');

const Service = require('../../src/models/service.model');
const PrivateClassEnrollment = require('../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');
const { PerSessionRegistration } = require('../../src/models/registration.model');
const { reserveSlot, PENDING_HOLD_TTL_MINUTES } = require('../../src/services/privateClassSession.service');
const { combineDayAndTimeInTZ } = require('../../src/utils/dateShapes');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../testUtils/db');
const { seedServices } = require('../../scripts/lib/seedServices');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
  // The partial unique index is the thing under test — make sure it exists
  // before the first insert races it.
  await PrivateClassSession.init();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

beforeEach(async () => {
  await seedServices();
});

afterEach(async () => {
  await clearTestDB();
});

const id = () => new mongoose.Types.ObjectId();
const SCHEDULE_ID = id();
const START = combineDayAndTimeInTZ('2026-10-06', '16:30');
const END = new Date(START.getTime() + 30 * 60000);

function bookingDoc(overrides = {}) {
  return {
    scheduleId: SCHEDULE_ID,
    enrollmentId: id(),
    coachId: id(),
    studentId: id(),
    parentId: id(),
    startDate: START,
    endDate: END,
    status: 'confirmed',
    ...overrides,
  };
}

async function backdate(session, minutesAgo) {
  await PrivateClassSession.collection.updateOne(
    { _id: session._id },
    { $set: { createdAt: new Date(Date.now() - minutesAgo * 60000) } }
  );
}

// docs/decisions/011-private-per-session-booking.md — the insert IS the slot
// claim; the partial unique index on (scheduleId, startDate) decides it.
describe('privateClassSession.service — reserveSlot (the atomic slot claim)', () => {
  it('lets exactly one of two concurrent claims for the same slot win', async () => {
    const results = await Promise.allSettled([reserveSlot(bookingDoc()), reserveSlot(bookingDoc())]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(await PrivateClassSession.countDocuments({})).toBe(1);
  });

  it.each(['cancelled', 'released'])('a %s booking frees the slot without deleting its history', async (status) => {
    await PrivateClassSession.create(bookingDoc({ status }));

    await expect(reserveSlot(bookingDoc())).resolves.toBeTruthy();
    expect(await PrivateClassSession.countDocuments({})).toBe(2);
  });

  it('the same time on another schedule, or another time on this schedule, never conflicts', async () => {
    await reserveSlot(bookingDoc());

    await expect(reserveSlot(bookingDoc({ scheduleId: id() }))).resolves.toBeTruthy();
    await expect(
      reserveSlot(bookingDoc({ startDate: new Date(START.getTime() + 7 * 86400000), endDate: new Date(END.getTime() + 7 * 86400000) }))
    ).resolves.toBeTruthy();
  });

  describe('abandoned purchase holds', () => {
    async function seedHold({ minutesAgo, ledgerStatus = null }) {
      const privateService = await Service.findOne({ code: 'private-lessons' });
      const enrollment = await PrivateClassEnrollment.create({
        studentId: id(),
        parentId: id(),
        coachId: id(),
        coachContractId: id(),
        agreedHourlyRate: 65,
        sessionDurationMinutes: 30,
        quantity: 1,
        status: 'pending',
      });
      const hold = await PrivateClassSession.create(bookingDoc({ status: 'pending', enrollmentId: enrollment._id }));
      await backdate(hold, minutesAgo);

      if (ledgerStatus) {
        await PerSessionRegistration.create({
          serviceId: privateService._id,
          sessionId: hold._id,
          enrollmentId: enrollment._id,
          parentId: enrollment.parentId,
          studentId: enrollment.studentId,
          quantity: 1,
          unitPrice: 32.5,
          amount: 32.5,
          status: ledgerStatus,
        });
      }

      return { hold, enrollment };
    }

    it(`releases a pending hold older than ${PENDING_HOLD_TTL_MINUTES} minutes with no charge, then claims the slot`, async () => {
      const { hold, enrollment } = await seedHold({ minutesAgo: PENDING_HOLD_TTL_MINUTES + 5 });

      await expect(reserveSlot(bookingDoc())).resolves.toBeTruthy();
      expect(await PrivateClassSession.findById(hold._id)).toMatchObject({ status: 'released', releaseReason: 'abandoned' });
      expect((await PrivateClassEnrollment.findById(enrollment._id)).status).toBe('failed');
    });

    it('also releases one whose charge already failed', async () => {
      await seedHold({ minutesAgo: PENDING_HOLD_TTL_MINUTES + 5, ledgerStatus: 'failed' });

      await expect(reserveSlot(bookingDoc())).resolves.toBeTruthy();
    });

    it('never releases a hold younger than the TTL', async () => {
      const { hold } = await seedHold({ minutesAgo: PENDING_HOLD_TTL_MINUTES - 5 });

      await expect(reserveSlot(bookingDoc())).rejects.toMatchObject({ status: 409 });
      expect((await PrivateClassSession.findById(hold._id)).status).toBe('pending');
    });

    it.each(['pending', 'completed'])('never releases a hold whose charge is %s — money may have moved', async (ledgerStatus) => {
      const { hold, enrollment } = await seedHold({ minutesAgo: PENDING_HOLD_TTL_MINUTES + 60, ledgerStatus });

      await expect(reserveSlot(bookingDoc())).rejects.toMatchObject({ status: 409 });
      expect((await PrivateClassSession.findById(hold._id)).status).toBe('pending');
      expect((await PrivateClassEnrollment.findById(enrollment._id)).status).toBe('pending');
    });

    it('never releases a confirmed booking, however old', async () => {
      const confirmed = await PrivateClassSession.create(bookingDoc());
      await backdate(confirmed, 24 * 60);

      await expect(reserveSlot(bookingDoc())).rejects.toMatchObject({ status: 409 });
      expect((await PrivateClassSession.findById(confirmed._id)).status).toBe('confirmed');
    });
  });
});
