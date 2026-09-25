const calendarService = require('../services/calendar.service');

// docs/plans/calendar-view-plan.md §1.5. Every handler takes the same query:
// from, to ('YYYY-MM-DD', both required), coachId, type (all|group|private).

function calendarQuery(req) {
  const { from, to, coachId, type } = req.query;
  return { from, to, coachId, type };
}

// GET /calendar/public — logged out; never names a student.
async function listPublic(req, res, next) {
  try {
    return res.status(200).json(await calendarService.listPublic(calendarQuery(req)));
  } catch (error) {
    return next(error);
  }
}

// GET /calendar/mine — parent: the public calendar plus the family's own items.
async function listMine(req, res, next) {
  try {
    return res.status(200).json(await calendarService.listForParent(req.user._id, calendarQuery(req)));
  } catch (error) {
    return next(error);
  }
}

// GET /calendar — admin/superadmin: everything, past months included.
async function listAll(req, res, next) {
  try {
    return res.status(200).json(await calendarService.listForAdmin(calendarQuery(req)));
  } catch (error) {
    return next(error);
  }
}

module.exports = { listPublic, listMine, listAll };
