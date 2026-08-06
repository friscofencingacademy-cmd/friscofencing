const mongoose = require('mongoose');

const { Schema } = mongoose;

// Attendance MARKING (the mutation endpoint / grid UI) is Phase 5 — this
// model only establishes the `isPresent` field, defaulted false at
// session-generation time.
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
    students: {
      type: [
        {
          studentId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
          },
          isPresent: {
            type: Boolean,
            default: false,
          },
        },
      ],
      default: [],
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
