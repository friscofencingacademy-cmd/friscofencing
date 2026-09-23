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
    // Calendar-day sentinel (UTC midnight) — the day key: holidays,
    // uniqueness, day-grouped display.
    date: {
      type: Date,
      required: true,
    },
    // Real UTC instants (docs/plans/session-start-time-cutoff-plan.md D3) —
    // `date` + the schedule's "HH:mm" resolved in the academy timezone at
    // generation time, the same shape PrivateClassSession.startDate/endDate
    // already store. Every "has this session started / is it upcoming" query
    // reads these. Only groupClassSession.service.js's generator and
    // groupClassSchedule.service.js's update() may write them.
    startsAt: {
      type: Date,
      required: true,
    },
    endsAt: {
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
groupClassSessionSchema.index({ scheduleId: 1, startsAt: 1 });

const GroupClassSession = mongoose.model('GroupClassSession', groupClassSessionSchema);

module.exports = GroupClassSession;
