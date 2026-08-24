const mongoose = require('mongoose');

const { Schema } = mongoose;

// The trial-assessment record — verified against CKQ's evaluation.model.js
// directly (docs/plans/premium-registration-and-attendance-plan.md §2),
// trimmed of everything Frisco doesn't have (no isActive/isDeleted —
// Frisco's own convention is explicit status enums / hard edit, not soft
// delete; see that section's decision #8).
const evaluationSchema = new Schema(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Always the requesting user at creation time (evaluation.service.js's
    // create()) — never a client-supplied field, matching CKQ's controller
    // exactly (`{ ...req.body, coach: req.user.id }`, spread order means
    // any body-supplied value is silently overridden).
    coachId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    groupClassSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'GroupClassSession',
      required: true,
    },
    assignedLevelId: {
      type: Schema.Types.ObjectId,
      ref: 'Level',
      required: true,
    },
    notes: {
      type: String,
      required: true,
      maxlength: 1000,
    },
  },
  {
    timestamps: true,
  }
);

// Backstop behind the service-layer pre-check (evaluation.service.js's
// create) — same two-layer pattern trialClass.service.js already uses
// ahead of TrialClass's own unique index. CKQ has no equivalent index
// (pre-check only); this is a deliberate improvement matching Frisco's own
// established convention, not a CKQ gap being copied forward.
evaluationSchema.index({ studentId: 1, groupClassSessionId: 1 }, { unique: true });

const Evaluation = mongoose.model('Evaluation', evaluationSchema);

module.exports = Evaluation;
