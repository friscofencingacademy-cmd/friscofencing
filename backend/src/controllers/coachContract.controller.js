const coachContractService = require('../services/coachContract.service');

async function create(req, res) {
  try {
    const contract = await coachContractService.create(req.body);
    return res.status(201).json({ contract });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to create coach contract' });
  }
}

async function list(req, res) {
  try {
    const contracts = await coachContractService.list({ coachId: req.query.coachId });
    return res.status(200).json({ contracts });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list coach contracts' });
  }
}

async function deactivate(req, res) {
  try {
    const contract = await coachContractService.deactivate(req.params.id);
    return res.status(200).json({ contract });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to deactivate coach contract' });
  }
}

module.exports = { create, list, deactivate };
