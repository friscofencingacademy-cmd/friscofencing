import { getChildPalette } from '../../../../lib/childPalette';
import type { StudentBase } from '../../../../lib/types';
import styles from './flow.module.css';

export interface ChildPickerCardsProps {
  // StudentBase, not Student — this component only ever reads _id/
  // firstName/lastName/age/skillLevel, never enrollment. A real Student
  // (which extends StudentBase) is still assignable here.
  students: StudentBase[];
  selectedId: string;
  onSelect: (id: string) => void;
  // Optional per-card status chip (e.g. "Already enrolled") — the caller
  // decides from its own full Student data (enrollment, in particular);
  // this component still never reads that field itself, only renders
  // whatever string (or null, for "no chip") the caller hands back per
  // student (docs/plans/booking-and-private-class-fixes-plan.md §1).
  getBadge?: (student: StudentBase) => string | null;
}

export default function ChildPickerCards({ students, selectedId, onSelect, getBadge }: ChildPickerCardsProps) {
  return (
    <div className={styles.childGrid} role="radiogroup" aria-label="Select a child">
      {students.map((student, index) => {
        const palette = getChildPalette(index);
        const selected = student._id === selectedId;
        // age is backend-computed (docs/plans/trial-registration-required-
        // fields-plan.md §1.5/§2.3) — null/absent on a child created before
        // dateOfBirth existed, so it just doesn't render, never a guess.
        const metaParts = [student.age != null ? `Age ${student.age}` : null, student.skillLevel].filter(
          Boolean
        );
        const badge = getBadge?.(student) ?? null;

        return (
          <button
            key={student._id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`${styles.childCard} ${selected ? styles.childCardSelected : ''}`}
            onClick={() => onSelect(student._id)}
          >
            <span className={styles.childAvatar} style={{ background: palette.gradient }} aria-hidden="true">
              {student.firstName[0]?.toUpperCase() ?? '?'}
            </span>
            <span>
              <div className={styles.childName}>
                {student.firstName} {student.lastName}
              </div>
              {metaParts.length > 0 ? <div className={styles.childMeta}>{metaParts.join(' · ')}</div> : null}
              {badge ? <div className={styles.childBadge}>{badge}</div> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
