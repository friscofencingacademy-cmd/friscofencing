const holidayService = require('../services/holiday.service');

async function create(req, res) {
  try {
    const holiday = await holidayService.create(req.body);
    return res.status(201).json({ holiday });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create holiday' });
  }
}

async function list(req, res) {
  try {
    const holidays = await holidayService.list();
    return res.status(200).json({ holidays });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list holidays' });
  }
}

async function getById(req, res) {
  try {
    const holiday = await holidayService.getById(req.params.id);
    return res.status(200).json({ holiday });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch holiday' });
  }
}

async function update(req, res) {
  try {
    const holiday = await holidayService.update(req.params.id, req.body);
    return res.status(200).json({ holiday });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to update holiday' });
  }
}

async function remove(req, res) {
  try {
    await holidayService.remove(req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to delete holiday' });
  }
}

module.exports = { create, list, getById, update, remove };
