import type { PublicTestimonial } from '../../../lib/types';
import Button from '../ui/Button/Button';
import styles from './marketing.module.css';

interface TestimonialsSectionProps {
  testimonials: PublicTestimonial[];
}

// Slight alternating tilt per card, mirroring the live site's "scattered
// polaroid" look — cycles through these four angles regardless of how many
// testimonials there are.
const ROTATIONS = [-3, 2, -2, 3];

// The live site's own red quote-mark glyph, pulled from the WP export
// verbatim (2026-08-29) rather than a generic icon-font quote — fill is
// currentColor so it takes the existing --color-accent token via
// .testimonialQuoteIcon, not the export's hardcoded hex.
function QuoteMarkIcon() {
  return (
    <svg
      className={styles.testimonialQuoteIcon}
      viewBox="0 0 42 29"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M23.1675 28.9284V16.2564L31.3595 0.000389099H38.6555L32.3835 14.9764H41.4715V28.9284H23.1675ZM-0.000468731 28.9284V16.2564L8.12753 0.000389099H15.4875L9.15153 14.9764H18.1755V28.9284H-0.000468731Z"
        fill="currentColor"
      />
    </svg>
  );
}

function TestimonialCard({
  testimonial,
  rotation,
}: {
  testimonial: PublicTestimonial;
  rotation: number;
}) {
  return (
    <div className={styles.testimonialCard}>
      <div className={styles.testimonialPolaroid} style={{ transform: `rotate(${rotation}deg)` }}>
        <span className={styles.testimonialTape} aria-hidden="true" />
        {testimonial.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- an
          // admin-uploaded Blob/owner-hosted URL, not a local/optimizable asset.
          <img src={testimonial.imageUrl} alt="" className={styles.testimonialPhoto} />
        ) : (
          <div className={styles.testimonialPhotoFallback} aria-hidden="true" />
        )}
        {testimonial.caption ? (
          <p className={styles.testimonialCaption}>{testimonial.caption}</p>
        ) : null}
      </div>
      <QuoteMarkIcon />
      <p className={styles.testimonialQuote}>{testimonial.quote}</p>
      <p className={styles.testimonialAuthor}>by {testimonial.authorName}</p>
    </div>
  );
}

// Mirrors the live WP site's "What Families Says" section: a fixed navy/
// crimson ribbon banner sits centered over an auto-scrolling horizontal
// marquee of tilted polaroid testimonial cards (docs/plans/
// wordpress-ui-alignment-plan.md's testimonials addendum). Renders nothing
// if there are no published testimonials yet — same graceful-empty pattern
// Spotlight used (see git history: TeamBand/SpotlightCard, removed from
// this page in favor of this section).
//
// The track is the testimonials list duplicated once (same technique as
// ValuesMarquee) so the CSS animation's translateX(-50%) loops seamlessly;
// unlike ValuesMarquee this content is NOT aria-hidden, since it's real
// substantive text, not decorative atmosphere.
export default function TestimonialsSection({ testimonials }: TestimonialsSectionProps) {
  if (testimonials.length === 0) {
    return null;
  }

  const track = [...testimonials, ...testimonials];

  return (
    <section className={`${styles.testimonialsBand} ${styles.fullBleed}`}>
      <div className={styles.testimonialsMarquee}>
        <div className={styles.testimonialsTrack}>
          {track.map((testimonial, index) => (
            <TestimonialCard
              key={`${testimonial.authorName}-${index}`}
              testimonial={testimonial}
              rotation={ROTATIONS[index % ROTATIONS.length]}
            />
          ))}
        </div>
      </div>
      <div className={styles.testimonialsBanner}>
        <div className={styles.testimonialsBannerHead}>
          <span className={styles.eyebrow}>Testimonials</span>
          <h2 className={styles.testimonialsBannerTitle}>What Families Says</h2>
        </div>
        <div className={styles.testimonialsBannerTail}>
          <Button as="a" href="/register" size="sm">
            All Testimonials
          </Button>
        </div>
      </div>
    </section>
  );
}
