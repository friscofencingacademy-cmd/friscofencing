const registrationService = require('../services/registration.service');

async function create(req, res) {
  try {
    const result = await registrationService.create(req.body, req.user);
    return res.status(201).json(result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to register' });
  }
}

async function preview(req, res) {
  try {
    const { studentId, scheduleId, startDate } = req.query;
    const result = await registrationService.previewChargeAmount({ studentId, scheduleId, startDate }, req.user);
    return res.status(200).json(result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to preview registration pricing' });
  }
}

async function listMine(req, res) {
  try {
    const subscriptions = await registrationService.listMine(req.user._id);
    return res.status(200).json({ subscriptions });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list registrations' });
  }
}

module.exports = { create, preview, listMine };
