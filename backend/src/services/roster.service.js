const GroupClassSession = require('../models/groupClassSession.model');

// Shared roster-mutation helpers — the same "add/remove a student from a
// schedule's ongoing roster + every already-generated future session" logic
// that registration.service.js (add, on first registration) and
// renewal.service.js (remove, on cancellation finalize) each need, now also
// reused by subscription.service.js's changeSchedule (both directions on
// one call). Extracted here on its third use rather than duplicated a third
// time (docs/plans/ckq-parity-plan.md §4.1).

async function addStudentToRoster(schedule, studentId, today) {
  const alreadyOnRoster = schedule.students.some((id) => String(id) === String(studentId));

  if (!alreadyOnRoster) {
    schedule.students.push(studentId);
    await schedule.save();
  }

  const futureSessions = await GroupClassSession.find({
    scheduleId: schedule._id,
    date: { $gte: today },
  });

  await Promise.all(
    futureSessions.map((session) => {
      const onSessionRoster = session.students.some(
        (entry) => String(entry.studentId) === String(studentId)
      );

      if (onSessionRoster) {
        return null;
      }

      session.students.push({ studentId, isPresent: false });
      return session.save();
    })
  );
}

async function removeStudentFromRoster(schedule, studentId, today) {
  const onSchedule = schedule.students.some((id) => String(id) === String(studentId));

  if (onSchedule) {
    schedule.students = schedule.students.filter((id) => String(id) !== String(studentId));
    await schedule.save();
  }

  const futureSessions = await GroupClassSession.find({
    scheduleId: schedule._id,
    date: { $gte: today },
  });

  await Promise.all(
    futureSessions.map((session) => {
      const onRoster = session.students.some(
        (entry) => String(entry.studentId) === String(studentId)
      );

      if (!onRoster) {
        return null;
      }

      session.students = session.students.filter(
        (entry) => String(entry.studentId) !== String(studentId)
      );
      return session.save();
    })
  );
}

module.exports = { addStudentToRoster, removeStudentFromRoster };
