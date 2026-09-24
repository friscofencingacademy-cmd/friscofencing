const groupClassSessionService = require('../services/groupClassSession.service');

async function byScheduleId(req, res, next) {
  try {
    const sessions = await groupClassSessionService.listBySchedule(req.params.scheduleId);
    return res.status(200).json({ sessions });
  } catch (error) {
    return next(error);
  }
}

async function byClassId(req, res, next) {
  try {
    const sessions = await groupClassSessionService.listUpcomingByClass(req.params.classId);
    return res.status(200).json({ sessions });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const session = await groupClassSessionService.getById(req.params.id);
    return res.status(200).json({ session });
  } catch (error) {
    return next(error);
  }
}

async function markAttendance(req, res, next) {
  try {
    const session = await groupClassSessionService.markAttendance(
      req.params.id,
      req.body.students,
      req.user
    );
    return res.status(200).json({ session });
  } catch (error) {
    return next(error);
  }
}

async function getEligibleStudents(req, res, next) {
  try {
    const students = await groupClassSessionService.getEligibleStudentsForSession(req.params.id, req.user);
    return res.status(200).json({ students });
  } catch (error) {
    return next(error);
  }
}

async function addStudent(req, res, next) {
  try {
    const session = await groupClassSessionService.addStudentToSession(
      req.params.id,
      req.body.studentId,
      req.user
    );
    return res.status(200).json({ session });
  } catch (error) {
    return next(error);
  }
}

async function removeStudent(req, res, next) {
  try {
    const session = await groupClassSessionService.removeStudentFromSession(
      req.params.id,
      req.params.studentId,
      req.user
    );
    return res.status(200).json({ session });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  byScheduleId,
  byClassId,
  getById,
  markAttendance,
  getEligibleStudents,
  addStudent,
  removeStudent,
};
