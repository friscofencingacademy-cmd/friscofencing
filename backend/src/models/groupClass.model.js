const mongoose = require('mongoose');

const { Schema } = mongoose;

// No price-related field here by design — price is looked up dynamically by
// level at billing time in a later phase, not stored as a foreign key here.
const groupClassSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    levelId: {
      type: Schema.Types.ObjectId,
      ref: 'Level',
      required: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

const GroupClass = mongoose.model('GroupClass', groupClassSchema);

module.exports = GroupClass;
