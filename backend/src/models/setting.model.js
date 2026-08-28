const mongoose = require('mongoose');

const { Schema } = mongoose;

// Singleton document — exactly one Setting doc ever exists (enforced by
// setting.service.js always querying/upserting via findOne(), never by a
// unique index on a constant key, matching this codebase's existing
// singleton conventions rather than inventing a new one). Superadmin-only
// (see setting.routes.js) — these values change the charge on every future
// registration immediately, with no confirmation step, so the bar is higher
// than a regular admin's Price/Level CRUD.
const settingSchema = new Schema(
  {
    // One-time fee charged on top of the first month's charge at
    // registration (registration.service.js's create()). $0 (the default)
    // means no charge at all — existing behavior is unchanged until an
    // admin explicitly sets a positive amount.
    registrationFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Waives the registration fee for a student who already has a prior
    // (now-cancelled) Subscription whose currentPeriodEnd is within this
    // many months of "now" — a "welcome back" grace period. 0 (the default)
    // means no waiver is ever granted, regardless of history.
    returningStudentGracePeriodMonths: {
      type: Number,
      default: 0,
      min: 0,
    },
    // DEPRECATED (docs/decisions/007-calendar-month-billing.md) — prorated
    // first-month billing is now unconditional (registration.service.js no
    // longer reads this field), since a full-month charge for a partial
    // calendar month would be an overcharge under calendar-month billing.
    // Field kept, not removed, so a pre-existing stored Setting doc doesn't
    // need a migration; no code path reads or writes it anymore.
    prorationEnabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Setting = mongoose.model('Setting', settingSchema);

module.exports = Setting;
