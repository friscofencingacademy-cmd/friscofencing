const mongoose = require('mongoose');

const { Schema } = mongoose;

// A coach-published weekly private-lesson slot. studentId/enrollmentId null
// = the slot is available for a parent to self-register into (§5.4/§5.5).
// Duplicate-slot rule (same coachId + dayOfWeek + startTime) is enforced at
// the service layer, not here.
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
    // "HH:mm" 24h format.
    startTime: {
      type: String,
      required: true,
    },
    durationMinutes: {
      type: Number,
      default: 60,
      min: 15,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    enrollmentId: {
      type: Schema.Types.ObjectId,
      ref: 'PrivateClassEnrollment',
      default: null,
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

privateClassScheduleSchema.index({ coachId: 1, isActive: 1 });
privateClassScheduleSchema.index({ studentId: 1 });

module.exports = mongoose.model('PrivateClassSchedule', privateClassScheduleSchema);
