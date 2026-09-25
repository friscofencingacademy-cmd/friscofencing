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

// POST /coach-contracts/:id/revisions — Edit: ends this version and starts a
// new one (docs/plans/coach-pack-pricing-plan.md §8).
async function revise(req, res, next) {
  try {
    const { contract, previous } = await coachContractService.revise(req.params.id, {
      studentBillingRate: req.body.studentBillingRate,
      coachCompensationRate: req.body.coachCompensationRate,
      sessionDurationMinutes: req.body.sessionDurationMinutes,
      notes: req.body.notes,
      privateLessonPacks: req.body.privateLessonPacks,
    });
    return res.status(201).json({ contract, previous });
  } catch (error) {
    return next(error);
  }
}

// POST /coach-contracts/preview — the editor's lesson prices and pack checks; writes nothing.
async function preview(req, res, next) {
  try {
    const result = await coachContractService.preview({
      studentBillingRate: req.body.studentBillingRate,
      sessionDurationMinutes: req.body.sessionDurationMinutes,
      packs: req.body.packs,
      coachId: req.body.coachId,
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, list, deactivate, revise, preview };
