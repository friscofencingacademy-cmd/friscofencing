const mongoose = require('mongoose');

const { Schema } = mongoose;

const groupClassScheduleSchema = new Schema(
  {
    classId: {
      type: Schema.Types.ObjectId,
      ref: 'GroupClass',
      required: true,
    },
    coachId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // JS Date.getDay() convention: 0=Sunday ... 6=Saturday.
    dayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
    },
    // "HH:mm" 24h format, e.g. "16:30".
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
    // The enrolled roster.
    students: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const GroupClassSchedule = mongoose.model('GroupClassSchedule', groupClassScheduleSchema);

module.exports = GroupClassSchedule;
