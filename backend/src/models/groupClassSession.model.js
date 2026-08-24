const mongoose = require('mongoose');

const { Schema } = mongoose;

// A session is just its schedule + date. Attendance no longer lives here as
// an embedded snapshot — the Visit model (visit.model.js) is the source of
// truth, replacing the roster-array design this field used to be (removed
// docs/plans/premium-registration-and-attendance-plan.md §1/§3.2: no
// migration needed, nothing had been marked yet in production/staging).
const groupClassSessionSchema = new Schema(
  {
    scheduleId: {
      type: Schema.Types.ObjectId,
      ref: 'GroupClassSchedule',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// One session per schedule per date.
groupClassSessionSchema.index({ scheduleId: 1, date: 1 }, { unique: true });

const GroupClassSession = mongoose.model('GroupClassSession', groupClassSessionSchema);

module.exports = GroupClassSession;
