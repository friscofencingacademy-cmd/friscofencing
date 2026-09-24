const registrationService = require('../services/registration.service');
const { hasAdminRole } = require('../utils/roles');

async function create(req, res, next) {
  try {
    const result = await registrationService.create(req.body, req.user);
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
}

async function preview(req, res, next) {
  try {
    const { studentId, scheduleId, startDate } = req.query;
    const result = await registrationService.previewChargeAmount({ studentId, scheduleId, startDate }, req.user);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function listMine(req, res, next) {
  try {
    const subscriptions = await registrationService.listMine(req.user._id);
    return res.status(200).json({ subscriptions });
  } catch (error) {
    return next(error);
  }
}

// Parent payment history (docs/plans/payment-airtight-plan.md D10) — an
// admin/superadmin may pass ?parentId= to view a specific family's history
// on the admin subscriptions page (docs/plans/manual-charge-and-pdf-invoice
// -plan.md's 2026-08-31 addendum), reusing listHistory() verbatim rather
// than duplicating it. A parent role ALWAYS gets their own req.user._id,
// regardless of any parentId it sends — that query param is only ever
// honored for an admin/superadmin caller, never trusted from a parent.
async function history(req, res, next) {
  try {
    const isAdmin = hasAdminRole(req.user);
    const parentId = isAdmin && req.query.parentId ? req.query.parentId : req.user._id;
    const rows = await registrationService.listHistory(parentId);
    return res.status(200).json({ history: rows });
  } catch (error) {
    return next(error);
  }
}

// PDF invoice download (docs/plans/manual-charge-and-pdf-invoice-plan.md
// PR 2) — streams the buffer directly rather than JSON.
async function invoice(req, res, next) {
  try {
    const { pdf, invoiceNumber } = await registrationService.getInvoice(req.params.id, req.user);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoiceNumber}.pdf"`);
    return res.status(200).send(pdf);
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, preview, listMine, history, invoice };
