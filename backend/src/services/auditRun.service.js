const AuditRun = require('../models/auditRun.model');

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function badRequestError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

const REQUIRED_FIELDS = ['auditName', 'overall', 'startedAt', 'finishedAt'];

// Reported verbatim by an audit/ script — see docs/plans/audit-system-plan.md.
// No write path exists anywhere else; this is a reporting sink, never edited
// or deleted through the API.
async function create(data) {
  const missing = REQUIRED_FIELDS.filter((field) => !data[field]);

  if (missing.length > 0) {
    throw badRequestError(`Missing required field(s): ${missing.join(', ')}`);
  }

  return AuditRun.create({
    auditName: data.auditName,
    group: data.group ?? null,
    overall: data.overall,
    scenarios: data.scenarios ?? [],
    summary: data.summary ?? '',
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
    runner: data.runner ?? 'playwright-script',
  });
}

// One row per distinct auditName — the most recent run only. This is the
// admin dashboard's primary read: it wants "what's the latest state of each
// known audit," not a full history.
async function listLatest() {
  const runs = await AuditRun.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$auditName', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $sort: { auditName: 1 } },
  ]);

  return { runs, total: runs.length };
}

async function list({ auditName, page = 1, limit = 25 } = {}) {
  const filter = auditName ? { auditName } : {};
  const skip = (page - 1) * limit;

  const [runs, total] = await Promise.all([
    AuditRun.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    AuditRun.countDocuments(filter),
  ]);

  return {
    runs,
    total,
    currentPage: page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

async function getById(id) {
  const run = await AuditRun.findById(id);

  if (!run) {
    throw notFoundError('Audit run not found');
  }

  return run;
}

module.exports = { create, listLatest, list, getById };
