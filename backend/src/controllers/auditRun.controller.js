const auditRunService = require('../services/auditRun.service');

async function create(req, res) {
  try {
    const run = await auditRunService.create(req.body);
    return res.status(201).json({ data: run });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create audit run' });
  }
}

async function list(req, res) {
  try {
    if (req.query.latest === 'true') {
      const data = await auditRunService.listLatest();
      return res.status(200).json({ data });
    }

    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 25;
    const data = await auditRunService.list({ auditName: req.query.auditName, page, limit });
    return res.status(200).json({ data });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list audit runs' });
  }
}

async function getById(req, res) {
  try {
    const run = await auditRunService.getById(req.params.id);
    return res.status(200).json({ data: run });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to fetch audit run' });
  }
}

module.exports = { create, list, getById };
