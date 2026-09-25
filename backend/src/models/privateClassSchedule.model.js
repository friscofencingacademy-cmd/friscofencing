const mongoose = require('mongoose');

const { Schema } = mongoose;
const { DEFAULT_LESSON_MINUTES } = require('./coachContract.model');

// A coach's published AVAILABILITY RULE for private lessons
// (docs/plans/private-class-per-session-booking-plan.md D1): "this weekday,
// this start time, this length, bookable between startDate and endDate."
// Nobody owns a schedule — different families book different dates of the
// same rule. A booking is a PrivateClassSession; nothing is generated ahead
// of time (docs/decisions/011-private-per-session-booking.md).
//
// Rules are usually created in bulk (privateClassSchedule.service.js's
// createBulk: "Mon/Wed 5–8 pm, 30-minute slots" = 6 rules per weekday).
// Overlap rule (same coach + weekday + start time with intersecting date
// ranges) is enforced at the service layer, not an index — the conflict is
// about date-range intersection, which an index cannot express.
const privateClassScheduleSchema = new Schema(
  {
    coachId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // JS Date.getDay() convention: 0=Sunday...6=Saturday — matches
    // GroupClassSchedule's convention.
    dayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
    },
    // "HH:mm" 24h, Central wall-clock.
    startTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    durationMinutes: {
      type: Number,
      default: DEFAULT_LESSON_MINUTES,
      min: 15,
    },
    // Calendar-day sentinels (dateShapes.js dateOnlyUTC), inclusive — the
    // rule offers its weekday's occurrences only inside this range.
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

privateClassScheduleSchema.path('endDate').validate(function endOnOrAfterStart(value) {
  return !this.startDate || !value || value.getTime() >= this.startDate.getTime();
}, 'endDate must be on or after startDate');

privateClassScheduleSchema.index({ coachId: 1, isActive: 1 });
// The overlap check's lookup.
privateClassScheduleSchema.index({ coachId: 1, dayOfWeek: 1, startTime: 1 });

module.exports = mongoose.model('PrivateClassSchedule', privateClassScheduleSchema);
