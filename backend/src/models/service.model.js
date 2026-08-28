const mongoose = require('mongoose');

const { Schema } = mongoose;

// The three shapes a Registration ledger row can ever take — see
// registration.model.js's own header comment for the full discriminator
// design (docs/plans/service-registry-unified-ledger-plan.md). Exported here
// (not redeclared) since a Service's `billingShape` and a Registration
// discriminator's key are the same enum by construction.
const BILLING_SHAPES = ['subscription_cycle', 'per_session', 'one_time_event'];

// The service registry — what the academy actually offers, as data, not
// code. Two deliberate departures from CKQ's own Service model (the
// precedent this was built from): every reference to a service uses `code`
// (or this doc's `_id`), never the display `name` string, so renaming a
// service is never a data migration; and each service declares its own
// `billingShape` up front, which is what lets the Registration ledger stay
// ONE collection instead of growing a new near-duplicate schema per service
// (docs/plans/service-registry-unified-ledger-plan.md D1/D4).
const serviceSchema = new Schema(
  {
    // Stable machine key — the ONLY thing code ever branches on or looks up
    // by. Deliberately NOT a schema enum: adding a service (camps, meets, or
    // whatever comes after) is a seed-data change, never a schema change.
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: /^[a-z0-9]+(-[a-z0-9]+)*$/,
    },
    // Display only — freely renameable with zero data migration, since
    // nothing is ever keyed on this.
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Which Registration discriminator this service's charges are written
    // as. Enum'd — unlike `code`, the set of billing shapes IS a code-level
    // concept (each shape has its own sub-schema + dedup index), so adding a
    // fourth shape is a real schema change, not a seed-data one.
    billingShape: {
      type: String,
      enum: BILLING_SHAPES,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    // No isDeleted — this repo has no soft-delete convention anywhere, and
    // services are near-static config rows, not user data with a delete
    // guard to think about.
    timestamps: true,
  }
);

const Service = mongoose.model('Service', serviceSchema);

module.exports = Service;
module.exports.BILLING_SHAPES = BILLING_SHAPES;
