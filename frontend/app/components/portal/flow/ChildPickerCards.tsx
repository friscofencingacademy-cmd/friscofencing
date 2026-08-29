import { getChildPalette } from '../../../../lib/childPalette';
import type { Student } from '../../../../lib/types';
import styles from './flow.module.css';

export interface ChildPickerCardsProps {
  students: Student[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function ChildPickerCards({ students, selectedId, onSelect }: ChildPickerCardsProps) {
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
            </span>
          </button>
        );
      })}
    </div>
  );
}
