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
    // Set the first time a parent saves a card (stripeCustomer.service.js).
    // Not schema-required: most users (students, coaches, admins who never
    // pay) never get one. sparse: true for the same reason as email above —
    // without it, every user missing this field would collide on `null`.
    stripeCustomerId: {
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
