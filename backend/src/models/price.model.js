const mongoose = require('mongoose');

const { Schema } = mongoose;

const priceSchema = new Schema(
  {
    levelId: {
      type: Schema.Types.ObjectId,
      ref: 'Level',
      required: true,
      unique: true,
    },
    monthlyFee: {
      type: Number,
      required: true,
      min: 0,
    },
    // One-time registration fee for THIS level, overriding the academy-wide
    // Setting.registrationFee when set (see registrationFee.service.js's
    // resolveRegistrationFee). null (the default) means "inherit the
    // academy-wide fee"; an explicit 0 means "this level charges no
    // registration fee" — the two are deliberately distinct, so this is
    // read with ?? (nullish coalescing), never ||.
    registrationFee: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

const Price = mongoose.model('Price', priceSchema);

module.exports = Price;
