const groupClassSessionService = require('../services/groupClassSession.service');

async function byScheduleId(req, res) {
  try {
    const sessions = await groupClassSessionService.listBySchedule(req.params.scheduleId);
    return res.status(200).json({ sessions });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list sessions' });
  }
}

async function byClassId(req, res) {
  try {
    const sessions = await groupClassSessionService.listUpcomingByClass(req.params.classId);
    return res.status(200).json({ sessions });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list sessions' });
  }
}

async function getById(req, res) {
  try {
    const session = await groupClassSessionService.getById(req.params.id);
    return res.status(200).json({ session });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch session' });
  }
}

async function markAttendance(req, res) {
  try {
    const session = await groupClassSessionService.markAttendance(
      req.params.id,
      req.body.students,
      req.user
    );
    return res.status(200).json({ session });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to mark attendance' });
  }
}

async function getEligibleStudents(req, res) {
  try {
    const students = await groupClassSessionService.getEligibleStudentsForSession(req.params.id, req.user);
    return res.status(200).json({ students });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list eligible students' });
  }
}

async function addStudent(req, res) {
  try {
    const session = await groupClassSessionService.addStudentToSession(
      req.params.id,
      req.body.studentId,
      req.user
    );
    return res.status(200).json({ session });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to add student' });
  }
}

async function removeStudent(req, res) {
  try {
    const session = await groupClassSessionService.removeStudentFromSession(
      req.params.id,
      req.params.studentId,
      req.user
    );
    return res.status(200).json({ session });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to remove student' });
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
