const privateClassEnrollmentService = require('../services/privateClassEnrollment.service');

async function create(req, res) {
  try {
    const result = await privateClassEnrollmentService.create(
      { studentId: req.body.studentId, scheduleId: req.body.scheduleId },
      req.user
    );
    return res.status(201).json(result);
  } catch (error) {
    const status = error.status || 500;
    return res
      .status(status)
      .json({ message: error.message || 'Failed to create private class enrollment' });
  }
}

async function listMine(req, res) {
  try {
    const enrollments = await privateClassEnrollmentService.listMine(req.user._id);
    return res.status(200).json({ enrollments });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list your enrollments' });
  }
}

async function listAll(req, res) {
  try {
    const enrollments = await privateClassEnrollmentService.listAll({
      status: req.query.status,
      coachId: req.query.coachId,
    });
    return res.status(200).json({ enrollments });
  } catch (error) {
    const status = error.status || 500;
    return res
      .status(status)
      .json({ message: error.message || 'Failed to list private class enrollments' });
  }
}

async function cancel(req, res) {
  try {
    const enrollment = await privateClassEnrollmentService.cancel(req.params.id, req.user);
    return res.status(200).json({ enrollment });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to cancel enrollment' });
  }
}

module.exports = { create, listMine, listAll, cancel };
