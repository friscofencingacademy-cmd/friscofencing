const mongoose = require('mongoose');

const { Schema } = mongoose;

const PRIVATE_CLASS_ENROLLMENT_STATUSES = ['active', 'cancelled'];

// The parent-facing private-lesson enrollment fact — born active at
// self-registration (D4: no admin-created-then-parent-accepts step, unlike
// CKQ). agreedHourlyRate is PINNED at registration time from the coach's
// current contract and is immutable afterward (D7) — a later contract-rate
// change affects only future enrollments, never this one.
const privateClassEnrollmentSchema = new Schema(
  {
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
    coachId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Audit trail: which contract set the pinned rate below.
    coachContractId: {
      type: Schema.Types.ObjectId,
      ref: 'CoachContract',
      required: true,
    },
    agreedHourlyRate: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: PRIVATE_CLASS_ENROLLMENT_STATUSES,
      default: 'active',
    },
    endDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const PrivateClassEnrollment = mongoose.model('PrivateClassEnrollment', privateClassEnrollmentSchema);

module.exports = PrivateClassEnrollment;
module.exports.PRIVATE_CLASS_ENROLLMENT_STATUSES = PRIVATE_CLASS_ENROLLMENT_STATUSES;
