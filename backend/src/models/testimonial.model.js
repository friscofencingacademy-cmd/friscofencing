const mongoose = require('mongoose');

const { Schema } = mongoose;

// Editorial content, admin-authored — same standalone, hand-published
// pattern as Spotlight (see that model's own comment): not linked to a
// User by ObjectId, since a testimonial is a parent's own words about the
// academy, not an account record.
const testimonialSchema = new Schema(
  {
    quote: {
      type: String,
      required: true,
    },
    authorName: {
      type: String,
      required: true,
    },
    // Short handwriting-style pull-quote shown under the photo, e.g. "More
    // than a sport, an environment for growth" — mirrors the live WP site's
    // "polaroid caption" treatment. Optional: a testimonial without one
    // just shows no caption line.
    caption: {
      type: String,
    },
    imageUrl: {
      type: String,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    // Display order among published testimonials.
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const Testimonial = mongoose.model('Testimonial', testimonialSchema);

module.exports = Testimonial;
