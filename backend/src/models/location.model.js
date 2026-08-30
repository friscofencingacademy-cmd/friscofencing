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
      // First real consumer: groupClassSchedule.service.js's listPublic()
      // (docs/plans/frontend-polish-plan.md PR 4) returns this per public
      // schedule row, so /classes no longer guesses a timezone from
      // "whichever location loaded first." This validator exists so a typo
      // on a location fails loudly at write time instead of moment-timezone
      // silently treating an unrecognized zone as UTC — the exact
      // wrong-timezone bug docs/plans/timezone-consistency-plan.md (D8)
      // exists to fix, reintroduced through a data-entry mistake with no
      // error.
      validate: {
        validator: (value) => moment.tz.names().includes(value),
        message: (props) => `${props.value} is not a valid IANA timezone name`,
      },
    },
    // Public contact info (docs/plans/frontend-polish-plan.md PR 5.3) —
    // empty by default; the owner fills the real values in on the admin
    // Locations page whenever they're ready. Backend stays the source of
    // truth: the public site renders a phone/email only when non-empty,
    // never a hardcoded placeholder.
    phone: {
      type: String,
      default: '',
      trim: true,
    },
    // Same optional/empty-by-default treatment as phone, but WITH a
    // minimal format validator — unlike phone (free-form, display-only), a
    // malformed email would silently ship a broken `mailto:` link with no
    // error at write time. Same loud-failure-at-write-time philosophy as
    // this field's `timezone` neighbor above; only validates non-empty
    // values, blank is always allowed.
    email: {
      type: String,
      default: '',
      trim: true,
      validate: {
        validator: (value) => value === '' || /^\S+@\S+\.\S+$/.test(value),
        message: (props) => `${props.value} is not a valid email address`,
      },
    },
  },
  {
    timestamps: true,
  }
);

const Location = mongoose.model('Location', locationSchema);

module.exports = Location;
