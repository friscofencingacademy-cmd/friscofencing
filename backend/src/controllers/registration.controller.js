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

// Parent payment history (docs/plans/payment-airtight-plan.md D10) — an
// admin/superadmin may pass ?parentId= to view a specific family's history
// on the admin subscriptions page (docs/plans/manual-charge-and-pdf-invoice
// -plan.md's 2026-08-31 addendum), reusing listHistory() verbatim rather
// than duplicating it. A parent role ALWAYS gets their own req.user._id,
// regardless of any parentId it sends — that query param is only ever
// honored for an admin/superadmin caller, never trusted from a parent.
async function history(req, res) {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    const parentId = isAdmin && req.query.parentId ? req.query.parentId : req.user._id;
    const rows = await registrationService.listHistory(parentId);
    return res.status(200).json({ history: rows });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to list payment history' });
  }
}

// PDF invoice download (docs/plans/manual-charge-and-pdf-invoice-plan.md
// PR 2) — streams the buffer directly rather than JSON.
async function invoice(req, res) {
  try {
    const { pdf, invoiceNumber } = await registrationService.getInvoice(req.params.id, req.user);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoiceNumber}.pdf"`);
    return res.status(200).send(pdf);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to generate invoice' });
  }
}

module.exports = { create, preview, listMine, history, invoice };
