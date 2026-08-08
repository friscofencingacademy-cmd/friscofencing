'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';

import api from '../../../lib/api';
import ProtectedRoute from '../../components/ProtectedRoute';
import AppShell from '../../components/layout/AppShell';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import Alert from '../../components/ui/Alert/Alert';
import styles from '../../components/ui/shared.module.css';

type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

interface StudentItem {
  _id: string;
  firstName: string;
  lastName: string;
  skillLevel?: SkillLevel;
}

function ChildrenPageContent() {
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('beginner');
  const [submitting, setSubmitting] = useState(false);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ students: StudentItem[] }>('/students/mine');
      setStudents(res.data.students);
    } catch (err) {
      setError('Failed to load children.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // No parentId in this payload — it's forced server-side to the
      // logged-in parent, never taken from client input.
      await api.post('/students', { firstName, lastName, skillLevel });
      setFirstName('');
      setLastName('');
      setSkillLevel('beginner');
      await fetchStudents();
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Failed to add child.';
      setError(message);
    } finally {
      setSubmitting(false);
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
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
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

export default function ChildrenPage() {
  return (
    <ProtectedRoute allowedRoles={['parent']}>
      <AppShell>
        <ChildrenPageContent />
      </AppShell>
    </ProtectedRoute>
  );
}
