const mongoose = require('mongoose');

const { Schema } = mongoose;

const levelSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    // Used for sorting/display order (e.g. beginner=1, intermediate=2, ...).
    order: {
      type: Number,
      required: true,
      unique: true,
    },
  },
  {
    timestamps: true,
  }
);

const Level = mongoose.model('Level', levelSchema);

module.exports = Level;
