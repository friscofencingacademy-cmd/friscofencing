const mongoose = require('mongoose');

const { Schema } = mongoose;

const locationSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    address: {
      type: String,
      required: true,
    },
    timezone: {
      type: String,
      default: 'America/Chicago',
    },
  },
  {
    timestamps: true,
  }
);

const Location = mongoose.model('Location', locationSchema);

module.exports = Location;
