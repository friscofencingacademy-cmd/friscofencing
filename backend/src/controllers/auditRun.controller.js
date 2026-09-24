const auditRunService = require('../services/auditRun.service');

async function create(req, res, next) {
  try {
    const run = await auditRunService.create(req.body);
    return res.status(201).json({ data: run });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
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
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const run = await auditRunService.getById(req.params.id);
    return res.status(200).json({ data: run });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, getById };
