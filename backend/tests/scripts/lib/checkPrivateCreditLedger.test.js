const mongoose = require('mongoose');

const Service = require('../../../src/models/service.model');
const PrivateClassEnrollment = require('../../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../../src/models/privateClassSession.model');
const { PerSessionRegistration } = require('../../../src/models/registration.model');
const { combineDayAndTimeInTZ } = require('../../../src/utils/dateShapes');
const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const { seedServices } = require('../../../scripts/lib/seedServices');

const { checkPrivateCreditLedger } = require('../../../scripts/lib/checkPrivateCreditLedger');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
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

// One paid purchase of `quantity` with `booked` confirmed bookings.
async function seedPaidPurchase({ quantity = 10, booked = 1, sessionsUsed = booked, paidQuantity = quantity } = {}) {
  const privateService = await Service.findOne({ code: 'private-lessons' });
  const enrollment = await PrivateClassEnrollment.create({
    studentId: id(),
    parentId: id(),
    coachId: id(),
    coachContractId: id(),
    agreedHourlyRate: 65,
    sessionDurationMinutes: 30,
    quantity,
    sessionsUsed,
    status: 'active',
  });

  const sessions = [];
  for (let week = 0; week < booked; week += 1) {
    const startDate = combineDayAndTimeInTZ(`2026-10-${String(6 + week * 7).padStart(2, '0')}`, '16:30');
    // eslint-disable-next-line no-await-in-loop
    sessions.push(
      await PrivateClassSession.create({
        scheduleId: id(),
        enrollmentId: enrollment._id,
        coachId: enrollment.coachId,
        studentId: enrollment.studentId,
        parentId: enrollment.parentId,
        startDate,
        endDate: new Date(startDate.getTime() + 30 * 60000),
        status: 'confirmed',
      })
    );
  }

  await PerSessionRegistration.create({
    serviceId: privateService._id,
    sessionId: sessions[0] ? sessions[0]._id : id(),
    enrollmentId: enrollment._id,
    parentId: enrollment.parentId,
    studentId: enrollment.studentId,
    quantity: paidQuantity,
    unitPrice: 32.5,
    amount: 32.5 * paidQuantity,
    status: 'completed',
  });

  return { enrollment, sessions };
}

describe('scripts/lib/checkPrivateCreditLedger (read-only)', () => {
  it('reports nothing when every purchase matches the ledger and its bookings', async () => {
    await seedPaidPurchase({ booked: 2 });

    const { findings, scannedActiveEnrollments } = await checkPrivateCreditLedger();

    expect(findings).toEqual([]);
    expect(scannedActiveEnrollments).toBe(1);
  });

  it('reports a purchase with no completed payment', async () => {
    const { enrollment } = await seedPaidPurchase();
    await PerSessionRegistration.updateMany({}, { $set: { status: 'failed' } });

    const { findings } = await checkPrivateCreditLedger();

    expect(findings).toContainEqual({ kind: 'missing_payment', enrollmentId: String(enrollment._id), completedRows: 0 });
  });

  it('reports a quantity that disagrees with what was paid', async () => {
    const { enrollment } = await seedPaidPurchase({ quantity: 10, paidQuantity: 5 });

    const { findings } = await checkPrivateCreditLedger();

    expect(findings).toContainEqual({
      kind: 'quantity_mismatch',
      enrollmentId: String(enrollment._id),
      enrollmentQuantity: 10,
      paidQuantity: 5,
    });
  });

  it('reports sessionsUsed drifting from the bookings that hold slots', async () => {
    const { enrollment } = await seedPaidPurchase({ booked: 1, sessionsUsed: 3 });

    const { findings } = await checkPrivateCreditLedger();

    expect(findings).toContainEqual({
      kind: 'credit_count_drift',
      enrollmentId: String(enrollment._id),
      sessionsUsed: 3,
      slotHoldingBookings: 1,
    });
  });

  it('reports stale pending bookings (with the ledger status) and stale pending purchases', async () => {
    const { sessions } = await seedPaidPurchase({ booked: 1 });
    await PrivateClassSession.collection.updateOne(
      { _id: sessions[0]._id },
      { $set: { status: 'pending', createdAt: new Date('2026-01-01T00:00:00.000Z') } }
    );
    const pendingPurchase = await PrivateClassEnrollment.create({
      studentId: id(),
      parentId: id(),
      coachId: id(),
      coachContractId: id(),
      agreedHourlyRate: 65,
      sessionDurationMinutes: 30,
      quantity: 1,
      status: 'pending',
    });
    await PrivateClassEnrollment.collection.updateOne(
      { _id: pendingPurchase._id },
      { $set: { createdAt: new Date('2026-01-01T00:00:00.000Z') } }
    );

    const { findings } = await checkPrivateCreditLedger();

    expect(findings).toContainEqual(
      expect.objectContaining({ kind: 'stale_pending_booking', sessionId: String(sessions[0]._id), ledgerStatus: 'completed' })
    );
    expect(findings).toContainEqual({ kind: 'stale_pending_purchase', enrollmentId: String(pendingPurchase._id) });
  });

  it("reports the recurring model's non-partial slot index still in place", async () => {
    await PrivateClassSession.init();
    await PrivateClassSession.collection.dropIndex('scheduleId_1_startDate_1');
    await PrivateClassSession.collection.createIndex(
      { scheduleId: 1, startDate: 1 },
      { name: 'scheduleId_1_startDate_1', unique: true }
    );

    const { findings } = await checkPrivateCreditLedger();

    expect(findings).toContainEqual({ kind: 'slot_index_not_partial', index: 'scheduleId_1_startDate_1' });

    // Restore the schema's partial index for the rest of the suite.
    await PrivateClassSession.collection.dropIndex('scheduleId_1_startDate_1');
    await PrivateClassSession.syncIndexes();
  });

  it('never writes anything', async () => {
    const { enrollment } = await seedPaidPurchase({ booked: 1, sessionsUsed: 3 });

    await checkPrivateCreditLedger();

    expect((await PrivateClassEnrollment.findById(enrollment._id)).sessionsUsed).toBe(3);
  });
});
