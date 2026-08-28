const mongoose = require('mongoose');
const moment = require('moment-timezone');

const { Schema } = mongoose;
const { DEFAULT_TIMEZONE } = require('../config/timezone');

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
      default: DEFAULT_TIMEZONE,
      // Not wired into any date computation yet — one location today, so
      // there's nothing to select between (docs/plans/timezone-consistency
      // -plan.md D8). This validator exists so a typo on a FUTURE second
      // location fails loudly at write time instead of moment-timezone
      // silently treating an unrecognized zone as UTC — the exact
      // wrong-timezone bug this plan exists to fix, reintroduced through a
      // data-entry mistake with no error.
      validate: {
        validator: (value) => moment.tz.names().includes(value),
        message: (props) => `${props.value} is not a valid IANA timezone name`,
      },
    },
  },
  {
    timestamps: true,
  }
);

const Location = mongoose.model('Location', locationSchema);

module.exports = Location;
