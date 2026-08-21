const mongoose = require('mongoose');

const { Schema } = mongoose;

const PRIVATE_CLASS_ATTENDANCE_STATUSES = ['scheduled', 'attended', 'missed'];

// One generated occurrence of a private-lesson slot. coachId/studentId/
// parentId are denormalized from the schedule/enrollment at generation
// time — this is the money-relevant fact record, so it must still be
// correct even if the schedule/enrollment is later reassigned.
const privateClassSessionSchema = new Schema(
  {
    scheduleId: {
      type: Schema.Types.ObjectId,
      ref: 'PrivateClassSchedule',
      required: true,
    },
    enrollmentId: {
      type: Schema.Types.ObjectId,
      ref: 'PrivateClassEnrollment',
      required: true,
    },
    coachId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    // startDate + the slot's durationMinutes at generation time.
    endDate: {
      type: Date,
      required: true,
    },
    attendance: {
      type: String,
      enum: PRIVATE_CLASS_ATTENDANCE_STATUSES,
      default: 'scheduled',
    },
    markedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    markedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Generator idempotency (CKQ pattern) — one session per schedule per start
// instant, so re-running the generator can never create a duplicate.
privateClassSessionSchema.index({ scheduleId: 1, startDate: 1 }, { unique: true });

const PrivateClassSession = mongoose.model('PrivateClassSession', privateClassSessionSchema);

module.exports = PrivateClassSession;
module.exports.PRIVATE_CLASS_ATTENDANCE_STATUSES = PRIVATE_CLASS_ATTENDANCE_STATUSES;
