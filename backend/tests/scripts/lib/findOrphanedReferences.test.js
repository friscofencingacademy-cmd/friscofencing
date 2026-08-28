const mongoose = require('mongoose');

const { connectTestDB, disconnectTestDB, clearTestDB } = require('../../testUtils/db');
const User = require('../../../src/models/user.model');
const PrivateClassSchedule = require('../../../src/models/privateClassSchedule.model');
const CoachContract = require('../../../src/models/coachContract.model');
const PrivateClassEnrollment = require('../../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../../src/models/privateClassSession.model');
const Service = require('../../../src/models/service.model');
const { seedServices } = require('../../../scripts/lib/seedServices');

const { findOrphanedReferences } = require('../../../scripts/lib/findOrphanedReferences');

let mongod;

beforeAll(async () => {
  mongod = await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB(mongod);
});

afterEach(async () => {
  await clearTestDB();
});

async function makeUser(overrides = {}) {
  return User.create({ firstName: 'Test', lastName: 'User', ...overrides });
}

describe('scripts/lib/findOrphanedReferences', () => {
  it('reports nothing on a database with no orphaned refs', async () => {
    const coach = await makeUser({ role: 'coach' });
    await PrivateClassSchedule.create({ coachId: coach._id, dayOfWeek: 1, startTime: '16:00' });

    const { orphans, scannedCounts } = await findOrphanedReferences();

    expect(orphans).toHaveLength(0);
    expect(scannedCounts.PrivateClassSchedule).toBe(1);
  });

  it('finds an orphaned coachId on a PrivateClassSchedule', async () => {
    const coach = await makeUser({ role: 'coach' });
    const schedule = await PrivateClassSchedule.create({
      coachId: coach._id,
      dayOfWeek: 1,
      startTime: '16:00',
    });
    await User.deleteOne({ _id: coach._id });

    const { orphans } = await findOrphanedReferences();

    expect(orphans).toContainEqual({
      collection: 'PrivateClassSchedule',
      documentId: String(schedule._id),
      field: 'coachId',
      missingUserId: String(coach._id),
    });
  });

  it('finds an orphaned coachId on a CoachContract', async () => {
    await seedServices();
    const service = await Service.findOne({ code: 'private-lessons' });
    const coach = await makeUser({ role: 'coach' });
    const contract = await CoachContract.create({
      serviceId: service._id,
      coachId: coach._id,
      studentBillingRate: 60,
      coachCompensationRate: 40,
    });
    await User.deleteOne({ _id: coach._id });

    const { orphans } = await findOrphanedReferences();

    expect(orphans).toContainEqual({
      collection: 'CoachContract',
      documentId: String(contract._id),
      field: 'coachId',
      missingUserId: String(coach._id),
    });
  });

  it('finds orphaned studentId/parentId/coachId across a PrivateClassEnrollment', async () => {
    const coach = await makeUser({ role: 'coach' });
    const parent = await makeUser({ role: 'parent' });
    const student = await makeUser({ role: 'student', parentId: parent._id });
    const enrollment = await PrivateClassEnrollment.create({
      studentId: student._id,
      parentId: parent._id,
      coachId: coach._id,
      coachContractId: new mongoose.Types.ObjectId(),
      agreedHourlyRate: 60,
    });

    await User.deleteMany({ _id: { $in: [coach._id, parent._id, student._id] } });

    const { orphans } = await findOrphanedReferences();

    const enrollmentOrphans = orphans.filter((o) => o.collection === 'PrivateClassEnrollment');
    expect(enrollmentOrphans).toHaveLength(3);
    expect(enrollmentOrphans.map((o) => o.field).sort()).toEqual(['coachId', 'parentId', 'studentId']);
    enrollmentOrphans.forEach((orphan) => expect(orphan.documentId).toBe(String(enrollment._id)));
  });

  it('finds orphaned refs on a PrivateClassSession', async () => {
    const coach = await makeUser({ role: 'coach' });
    const parent = await makeUser({ role: 'parent' });
    const student = await makeUser({ role: 'student', parentId: parent._id });
    const session = await PrivateClassSession.create({
      scheduleId: new mongoose.Types.ObjectId(),
      enrollmentId: new mongoose.Types.ObjectId(),
      coachId: coach._id,
      studentId: student._id,
      parentId: parent._id,
      startDate: new Date('2026-01-01T16:00:00.000Z'),
      endDate: new Date('2026-01-01T17:00:00.000Z'),
    });

    await User.deleteOne({ _id: coach._id });

    const { orphans } = await findOrphanedReferences();

    expect(orphans).toContainEqual({
      collection: 'PrivateClassSession',
      documentId: String(session._id),
      field: 'coachId',
      missingUserId: String(coach._id),
    });
  });

  it('never writes anything — read-only', async () => {
    const coach = await makeUser({ role: 'coach' });
    await PrivateClassSchedule.create({ coachId: coach._id, dayOfWeek: 1, startTime: '16:00' });
    await User.deleteOne({ _id: coach._id });

    await findOrphanedReferences();

    // The orphaned schedule doc is untouched — still exists, still points
    // at the same (now-missing) coachId.
    const schedules = await PrivateClassSchedule.find({}).lean();
    expect(schedules).toHaveLength(1);
    expect(String(schedules[0].coachId)).toBe(String(coach._id));
  });
});
