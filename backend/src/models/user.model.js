const mongoose = require('mongoose');

const { Schema } = mongoose;

const ROLES = ['student', 'parent', 'coach', 'admin', 'superadmin'];
const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'];

const userSchema = new Schema(
  {
    role: {
      type: String,
      enum: ROLES,
      required: true,
    },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: true,
    },
    // Not schema-required: students may not have an email yet in this MVP.
    // sparse: true is required alongside unique — without it, a unique index
    // on a field most students omit would treat every missing email as the
    // same `null` value and collide on the second student created.
    email: {
      type: String,
      lowercase: true,
      trim: true,
      unique: true,
      sparse: true,
    },
    // Not schema-required for the same reason as email: only login-capable
    // roles (parent/coach/admin/superadmin) get a password. Enforced at the
    // service layer (auth.service.js), not here.
    passwordHash: {
      type: String,
    },
    // For students: links to the parent's User doc. Not schema-required —
    // enforced in application logic when a student is created.
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    skillLevel: {
      type: String,
      enum: SKILL_LEVELS,
    },
    // Parent-only in practice (collected at signup, auth.service.js's
    // register()). Not schema-required, same reasoning as email below —
    // enforcement lives where each field's own ask actually applies
    // (docs/plans/trial-registration-required-fields-plan.md): hard-required
    // at signup itself, and re-checked at trial-booking time as the backstop
    // for any account created before this field existed.
    phone: {
      type: String,
      trim: true,
    },
    // Student-only in practice (collected on Add Child, student.service.js's
    // create()). Not schema-required — admin's own student-creation dialog
    // may not always have a birthdate in hand (docs/plans/trial-registration-
    // required-fields-plan.md §1.3). age.js's calculateAge() derives display
    // age from this, fresh on every read, never stored.
    dateOfBirth: {
      type: Date,
    },
    // Set the first time a parent saves a card (stripeCustomer.service.js).
    // Not schema-required: most users (students, coaches, admins who never
    // pay) never get one. sparse: true for the same reason as email above —
    // without it, every user missing this field would collide on `null`.
    stripeCustomerId: {
      type: String,
      unique: true,
      sparse: true,
    },
    // The legacy system's stable per-person "PIN" (backend/scripts/
    // import-legacy-data.js). Only ever set on migrated students — sparse:
    // true so every non-migrated user (the overwhelming majority) omitting
    // it never collides on `null`, same reasoning as email/stripeCustomerId
    // above. This is what makes the import script idempotent: re-running it
    // against a corrected export (e.g. the real data at go-live) upserts by
    // this field instead of duplicating.
    legacyPin: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash;
        return ret;
      },
    },
  }
);

// Same guarantee as the toJSON transform above, exposed as an explicit
// instance method for call sites that want a safe plain object without
// going through JSON serialization.
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return this.toJSON();
};

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
module.exports.SKILL_LEVELS = SKILL_LEVELS;
