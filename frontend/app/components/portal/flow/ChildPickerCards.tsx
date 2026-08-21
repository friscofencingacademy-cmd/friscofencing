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
              {student.skillLevel ? <div className={styles.childMeta}>{student.skillLevel}</div> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
