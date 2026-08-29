import Button from '../ui/Button/Button';
import styles from './marketing.module.css';

// Full-bleed hero band, restyled 2026-08-29 to mirror the live WP site's
// home page (docs/plans/wordpress-ui-alignment-plan.md, Phase 2). Chip and
// headline are the owner's own copy, verbatim from the live site.
//
// Video background added 2026-08-29 (same doc's addendum): re-extracted from
// the WP export after the owner flagged that Phase 2's solid-gradient
// treatment (see git history on this file for that reasoning — the
// designated hero *photo* turned out to be a leftover soccer stock image)
// wasn't what actually shows on the live site. The live hero uses a genuine
// fencing video (two fencers lunging, teal-lit smoky stage), which this
// re-extraction found by searching the export for `background_video_link`
// settings — the original extraction only ever checked `background_image`
// and so missed it entirely. Verified against the owner's own screenshot of
// the live page before building this.
//
// The source clip was 1920x1080/15.7MB; `hero-video.mp4` here is a
// re-encoded 1280x720/1.5MB copy (no audio track — it's always muted) sized
// for a background loop rather than a focal video. `hero-poster.jpg` is a
// still frame from that same clip: it's the <video>'s poster, and — because
// the <source> below is gated to `min-width: 768px` — it's also the *only*
// thing phones ever download for this hero, no video fetch attempted.
//
// Subcopy is NOT copied from WP: the live site's actual hero paragraph is
// its own separate piece of leftover boilerplate ("...a center to bring
// people together through sports") — this keeps the existing, accurate,
// fencing-specific subcopy instead.
export default function Hero() {
  return (
    <section className={`${styles.heroBand} ${styles.fullBleed}`}>
      <video
        className={styles.heroVideo}
        autoPlay
        muted
        loop
        playsInline
        poster="/marketing/hero-poster.jpg"
      >
        <source src="/marketing/hero-video.mp4" media="(min-width: 768px)" type="video/mp4" />
      </video>
      <div className={styles.heroScrim} />
      <div className={styles.heroPhotoContent}>
        <span className={styles.heroChip}>Welcome to Frisco Fencing Academy</span>
        <h1 className={styles.heroTitle}>Olympic Fencing.</h1>
        <p className={styles.heroSubheading}>Child-First Training</p>
        <p className={styles.heroSubcopy}>
          Structured group classes from the first lesson through competitive bouting. Start
          with a free trial class and find out where your child fits.
        </p>
        <div className={styles.heroActions}>
          <Button as="a" href="/register" size="lg">
            Take a Trial Class
          </Button>
          <Button as="a" href="/private-classes" variant="accent" size="lg">
            Book Private Class with Coach
          </Button>
        </div>
      </div>
    </section>
  );
}
