const mongoose = require('mongoose');

const { Schema } = mongoose;

// Editorial content, admin-authored — deliberately NOT linked to a User by
// ObjectId (see docs/features/public-site.md): coupling a spotlight to an
// account row would mean either polluting User with marketing fields or
// publishing a minor's record automatically. Standalone + hand-published
// is the safer MVP.
const spotlightSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['coach', 'student'],
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    title: {
      type: String,
    },
    body: {
      type: String,
    },
    bullets: {
      type: [String],
      default: [],
      validate: {
        validator: (bullets) => bullets.length <= 3,
        message: 'A spotlight can have at most 3 bullets.',
      },
    },
    imageUrl: {
      type: String,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    // Display order within a type, for when more than one spotlight per
    // type exists later.
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const Spotlight = mongoose.model('Spotlight', spotlightSchema);

module.exports = Spotlight;
