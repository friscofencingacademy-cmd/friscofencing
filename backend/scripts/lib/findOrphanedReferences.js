const User = require('../../src/models/user.model');
const PrivateClassSchedule = require('../../src/models/privateClassSchedule.model');
const CoachContract = require('../../src/models/coachContract.model');
const PrivateClassEnrollment = require('../../src/models/privateClassEnrollment.model');
const PrivateClassSession = require('../../src/models/privateClassSession.model');

// Read-only diagnostic (orphaned-coach-reference-fix-plan §8d) — scans
// every private-class collection for a User ref that no longer resolves,
// the same bug class that caused the live /private-classes 500 (a coach
// hard-deleted without the delete-guard that D5/§8b now add). Never
// writes; report only, for the owner to decide manual cleanup. Reused as
// a manual-only fallback: the delete-guards this plan adds should make new
// orphans impossible going forward, so a clean report here is the expected
// steady state, not evidence the guards aren't needed.
async function findOrphanedReferences() {
  const scheduleDocs = await PrivateClassSchedule.find({}, 'coachId studentId').lean();
  const contractDocs = await CoachContract.find({}, 'coachId').lean();
  const enrollmentDocs = await PrivateClassEnrollment.find({}, 'coachId studentId parentId').lean();
  const sessionDocs = await PrivateClassSession.find({}, 'coachId studentId parentId').lean();

  const referencedIds = new Set();
  const collect = (doc, fields) => {
    fields.forEach((field) => {
      if (doc[field]) {
        referencedIds.add(String(doc[field]));
      }
    });
  };

  scheduleDocs.forEach((doc) => collect(doc, ['coachId', 'studentId']));
  contractDocs.forEach((doc) => collect(doc, ['coachId']));
  enrollmentDocs.forEach((doc) => collect(doc, ['coachId', 'studentId', 'parentId']));
  sessionDocs.forEach((doc) => collect(doc, ['coachId', 'studentId', 'parentId']));

  const existingUsers = await User.find(
    { _id: { $in: [...referencedIds] } },
    '_id'
  ).lean();
  const existingIds = new Set(existingUsers.map((user) => String(user._id)));

  const isOrphaned = (id) => id && !existingIds.has(String(id));

  const orphans = [];

  const checkDocs = (docs, collectionName, fields) => {
    docs.forEach((doc) => {
      fields.forEach((field) => {
        if (isOrphaned(doc[field])) {
          orphans.push({
            collection: collectionName,
            documentId: String(doc._id),
            field,
            missingUserId: String(doc[field]),
          });
        }
      });
    });
  };

  checkDocs(scheduleDocs, 'PrivateClassSchedule', ['coachId', 'studentId']);
  checkDocs(contractDocs, 'CoachContract', ['coachId']);
  checkDocs(enrollmentDocs, 'PrivateClassEnrollment', ['coachId', 'studentId', 'parentId']);
  checkDocs(sessionDocs, 'PrivateClassSession', ['coachId', 'studentId', 'parentId']);

  return { orphans, scannedCounts: {
    PrivateClassSchedule: scheduleDocs.length,
    CoachContract: contractDocs.length,
    PrivateClassEnrollment: enrollmentDocs.length,
    PrivateClassSession: sessionDocs.length,
  } };
}

module.exports = { findOrphanedReferences };
