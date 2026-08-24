const evaluationService = require('../services/evaluation.service');

async function create(req, res) {
  try {
    const evaluation = await evaluationService.create(req.body, req.user);
    return res.status(201).json({ evaluation });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create evaluation' });
  }
}

async function getById(req, res) {
  try {
    const evaluation = await evaluationService.getById(req.params.id);
    return res.status(200).json({ evaluation });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch evaluation' });
  }
}

async function getByStudent(req, res) {
  try {
    const evaluations = await evaluationService.getByStudent(req.params.studentId);
    return res.status(200).json({ evaluations });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list evaluations' });
  }
}

async function update(req, res) {
  try {
    const evaluation = await evaluationService.update(req.params.id, req.body, req.user);
    return res.status(200).json({ evaluation });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to update evaluation' });
  }
}

module.exports = { create, getById, getByStudent, update };
