const mongoose = require('mongoose');

const { Schema } = mongoose;

// One trial ever, per student, platform-wide — the unique index on
// studentId is the race-safety backstop behind the service-layer pre-check
// in trialClass.service.js, same two-layer pattern as Price.levelId.
const trialClassSchema = new Schema(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'GroupClassSession',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const TrialClass = mongoose.model('TrialClass', trialClassSchema);

module.exports = TrialClass;
