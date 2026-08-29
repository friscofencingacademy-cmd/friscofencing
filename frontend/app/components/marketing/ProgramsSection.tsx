import Image from 'next/image';

import Card from '../ui/Card/Card';
import styles from './marketing.module.css';

// Static marketing content, NOT backend-driven — deliberately decoupled from
// the admin-configured `Level`/`Price` catalog (2026-08-29, replacing the
// old `LevelGrid`, which mapped 1:1 over `/levels/public` and showed live
// pricing). The owner wants this section to always show the same curated
// three-program showcase the live WP site does, regardless of how many
// levels or what pricing an admin has actually configured — that real,
// live data belongs on `/classes` instead, which already pulls it
// independently from the backend. See
// docs/plans/wordpress-ui-alignment-plan.md's addendum for the full history
// (this replaces Phase 2's dynamic version).
//
// Copy (duration + description per program) is verbatim from the WP
// export's Programs section — re-extracted 2026-08-29 alongside the hero
// video find. The "Know more" CTA text is also left as-is as the export has
// it, at the owner's explicit call, even though the live site's own hero
// buttons elsewhere drifted from their export text.
interface Program {
  key: string;
  name: string;
  duration: string;
  description: string;
  photo: string;
  // How many of the 9 dots in the progress icon are filled — mirrors the
  // live site's own dot-cluster icon per program (6/8/9 of 9), a visual cue
  // for how far into training each program sits.
  filledDots: number;
}

const PROGRAMS: Program[] = [
  {
    key: 'beginner',
    name: 'Beginner',
    duration: '6–12 months',
    description:
      'A calm supportive environment where students learn the fundamentals of fencing while building confidence, discipline, and respect. Designed for those new to the sport, with safety and enjoyment at the core.',
    photo: '/marketing/program-beginner.jpg',
    filledDots: 6,
  },
  {
    key: 'intermediate',
    name: 'Intermediate',
    duration: '12–18 months',
    description:
      'For students ready to refine technique and deepen understanding. Training becomes more structured, with greater focus on movement, strategy, and personal progress.',
    photo: '/marketing/program-intermediate.jpg',
    filledDots: 8,
  },
  {
    key: 'advanced',
    name: 'Advanced',
    duration: '18 months+',
    description:
      'Designed for committed athletes pursuing competitive excellence. Training emphasizes precision, preparation, and long-term development guided closely by experienced coaches.',
    photo: '/marketing/program-advanced.png',
    filledDots: 9,
  },
];

// 3x3 grid of dots, same layout/coordinates as the live site's own icon —
// only the first `filled` positions (row-major) are rendered, the rest are
// simply absent (not hollow), matching the source SVGs exactly.
const DOT_POSITIONS = [5.31818, 19.4998, 33.6815].flatMap((cx) =>
  [5.31818, 18.7908, 32.2635].map((cy) => ({ cx, cy }))
);

function DotProgressIcon({ filled }: { filled: number }) {
  return (
    <svg
      className={styles.programDotIcon}
      xmlns="http://www.w3.org/2000/svg"
      width="39"
      height="38"
      viewBox="0 0 39 38"
      fill="none"
      aria-hidden="true"
    >
      {DOT_POSITIONS.slice(0, filled).map(({ cx, cy }) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5.31818" fill="currentColor" />
      ))}
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M190.5 66.9l22.2-22.2c9.4-9.4 24.6-9.4 33.9 0L441 239c9.4 9.4 9.4 24.6 0 33.9L246.6 467.3c-9.4 9.4-24.6 9.4-33.9 0l-22.2-22.2c-9.5-9.5-9.3-25 .4-34.3L311.4 296H24c-13.3 0-24-10.7-24-24v-32c0-13.3 10.7-24 24-24h287.4L190.9 101.2c-9.8-9.3-10-24.8-.4-34.3z" />
    </svg>
  );
}

export default function ProgramsSection() {
  return (
    <section>
      <span className={styles.eyebrow}>Programs</span>
      <h2 className={styles.sectionTitle}>A clear path for every stage</h2>
      <p className={styles.heroSubcopy}>
        Our programs are designed to meet students where they are and guide them forward with
        structure, care, and consistency.
      </p>
      <div className={styles.levelGrid}>
        {PROGRAMS.map((program) => (
          <Card key={program.key}>
            <div className={styles.levelCardPhoto}>
              <Image src={program.photo} alt="" fill sizes="(max-width: 760px) 100vw, 33vw" />
              <DotProgressIcon filled={program.filledDots} />
            </div>
            <div className={styles.levelCardBody}>
              <span className={styles.programDuration}>{program.duration}</span>
              <h3 className={styles.levelName}>{program.name}</h3>
              <p className={styles.programDescription}>{program.description}</p>
              <a href="/register" className={styles.programCta}>
                <span className={styles.programCtaIcon}>
                  <ArrowIcon />
                </span>
                Know more
              </a>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
