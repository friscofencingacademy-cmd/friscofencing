const mongoose = require('mongoose');

const { Schema } = mongoose;

const REGISTRATION_STATUSES = ['active', 'cancelled'];

// The enrollment record for a paid group-class registration. Distinct from
// Subscription (billing state) — this is the enrollment fact: this student
// is registered for this schedule.
const registrationSchema = new Schema(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    scheduleId: {
      type: Schema.Types.ObjectId,
      ref: 'GroupClassSchedule',
      required: true,
    },
    status: {
      type: String,
      enum: REGISTRATION_STATUSES,
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

const Registration = mongoose.model('Registration', registrationSchema);

module.exports = Registration;
module.exports.REGISTRATION_STATUSES = REGISTRATION_STATUSES;
