const mongoose = require('mongoose');

const { Schema } = mongoose;

// One document per audit run, reported by an audit/ script after it
// finishes (see docs/plans/audit-system-plan.md). Never written by any
// interactive admin flow — this is a reporting sink, not a CRUD resource.
const auditRunScenarioSchema = new Schema(
  {
    id: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    result: {
      type: String,
      enum: ['pass', 'fail', 'skip'],
      required: true,
    },
    note: {
      type: String,
      default: '',
    },
  },
  { _id: false }
);

const auditRunSchema = new Schema(
  {
    auditName: {
      type: String,
      required: true,
    },
    // Sub-group arg the run was invoked with (e.g. "group"), or null for a
    // full run — mirrors the CLI arg the reporting script was run with.
    group: {
      type: String,
      default: null,
    },
    overall: {
      type: String,
      enum: ['pass', 'fail', 'partial'],
      required: true,
    },
    scenarios: {
      type: [auditRunScenarioSchema],
      default: [],
    },
    summary: {
      type: String,
      default: '',
    },
    startedAt: {
      type: Date,
      required: true,
    },
    finishedAt: {
      type: Date,
      required: true,
    },
    runner: {
      type: String,
      default: 'playwright-script',
    },
  },
  {
    timestamps: true,
  }
);

// Every dashboard read is "most recent run per auditName" — index the sort
// key this actually queries by.
auditRunSchema.index({ auditName: 1, createdAt: -1 });

const AuditRun = mongoose.model('AuditRun', auditRunSchema);

module.exports = AuditRun;
