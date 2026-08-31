const mongoose = require('mongoose');

const { Schema } = mongoose;

// Academy-wide date-range blocks (docs/plans/holiday-blocking-plan.md) — no
// scope/location split (D1, single-location academy), no isMakeUpAllowed/
// soft-delete (D2, no billing interaction here, hard delete like every other
// catalog model in this codebase).
//
// startDate/endDate are calendar-day sentinels (UTC-midnight Dates with no
// real timezone meaning, built ONLY via backend/src/utils/dateShapes.js's
// dateOnlyUTC — D3), the exact same shape GroupClassSession.date already
// uses. An inclusive range: a one-day holiday has startDate === endDate.
// Never a real instant — never compare these against todayAtMidnight() or
// any other real-instant value.
const holidaySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

holidaySchema.index({ startDate: 1, endDate: 1 });

const Holiday = mongoose.model('Holiday', holidaySchema);

module.exports = Holiday;
