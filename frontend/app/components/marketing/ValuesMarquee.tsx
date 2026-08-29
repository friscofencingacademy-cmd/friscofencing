import styles from './marketing.module.css';

interface ValuesMarqueeProps {
  words: string[];
}

// Pure-CSS infinite horizontal scroll of value words, mirroring the live WP
// site's two marquee bands (docs/plans/wordpress-ui-alignment-plan.md,
// Phase 2). Decorative atmosphere, not content — aria-hidden, and the word
// list is duplicated in the DOM to make the scroll loop seamless.
// marketing.module.css disables the animation under prefers-reduced-motion.
export default function ValuesMarquee({ words }: ValuesMarqueeProps) {
  return (
    <div className={`${styles.marquee} ${styles.fullBleed}`} aria-hidden="true">
      <div className={styles.marqueeTrack}>
        {[...words, ...words].map((word, index) => (
          <span key={`${word}-${index}`} className={styles.marqueeWord}>
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}
