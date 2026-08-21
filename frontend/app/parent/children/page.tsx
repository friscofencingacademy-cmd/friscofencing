'use client';

import { useState, type FormEvent } from 'react';

import { useParentPortal } from '../../context/ParentPortalContext';
import { createStudent } from '../../../lib/services/parent';
import { getErrorMessage } from '../../../lib/hooks/useLoadState';
import type { SkillLevel } from '../../../lib/types';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import Alert from '../../components/ui/Alert/Alert';
import LoadError from '../../components/ui/LoadError/LoadError';
import styles from '../../components/ui/shared.module.css';

export default function ChildrenPage() {
  const { students, loading, error, reload } = useParentPortal();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('beginner');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    const result = await createStudent({ firstName, lastName, skillLevel });

    setSubmitting(false);

    if (result.status === 'success') {
      setFirstName('');
      setLastName('');
      setSkillLevel('beginner');
      reload();
    } else {
      setFormError(result.message);
    }
  }

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>My Children</h1>
      </div>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              flexWrap: 'wrap',
            }}
          >
            <p style={{ margin: 0 }}>Ready to try a class? Book a free trial for your child.</p>
            <Button as="a" href="/parent/book-trial" size="sm">
              Book a Free Trial
            </Button>
          </div>
        </Card>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={reload} />
      ) : loading ? (
        <p>Loading...</p>
      ) : (
        <Card>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>First Name</th>
                <th>Last Name</th>
                <th>Skill Level</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student._id}>
                  <td>{student.firstName}</td>
                  <td>{student.lastName}</td>
                  <td>{student.skillLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div style={{ marginTop: 'var(--space-5)' }}>
        <Card>
          <h2>Add Child</h2>
          {formError ? (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <Alert variant="error">{formError}</Alert>
            </div>
          ) : null}
          <form onSubmit={handleSubmit}>
            <div className={styles.formField}>
              <label htmlFor="firstName" className={styles.formLabel}>
                First Name
              </label>
              <input
                id="firstName"
                className={styles.formInput}
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
              />
            </div>
            <div className={styles.formField}>
              <label htmlFor="lastName" className={styles.formLabel}>
                Last Name
              </label>
              <input
                id="lastName"
                className={styles.formInput}
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                required
              />
            </div>
            <div className={styles.formField}>
              <label htmlFor="skillLevel" className={styles.formLabel}>
                Skill Level
              </label>
              <select
                id="skillLevel"
                className={styles.formSelect}
                value={skillLevel}
                onChange={(event) => setSkillLevel(event.target.value as SkillLevel)}
                required
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Child'}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
