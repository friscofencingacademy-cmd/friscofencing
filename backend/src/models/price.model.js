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
  },
  {
    timestamps: true,
  }
);

const Price = mongoose.model('Price', priceSchema);

module.exports = Price;
