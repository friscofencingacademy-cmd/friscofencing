const coachContractService = require('../services/coachContract.service');

async function create(req, res, next) {
  try {
    const contract = await coachContractService.create(req.body);
    return res.status(201).json({ contract });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const contracts = await coachContractService.list({ coachId: req.query.coachId });
    return res.status(200).json({ contracts });
  } catch (error) {
    return next(error);
  }
}

async function deactivate(req, res, next) {
  try {
    const contract = await coachContractService.deactivate(req.params.id);
    return res.status(200).json({ contract });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, deactivate };
