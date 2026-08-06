'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';

import api from '../../../lib/api';
import ProtectedRoute from '../../components/ProtectedRoute';

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
      <h1>My Children</h1>

      {error ? <p role="alert">{error}</p> : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
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
      )}

      <h2>Add Child</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="firstName">First Name</label>
          <input
            id="firstName"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="lastName">Last Name</label>
          <input
            id="lastName"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="skillLevel">Skill Level</label>
          <select
            id="skillLevel"
            value={skillLevel}
            onChange={(event) => setSkillLevel(event.target.value as SkillLevel)}
            required
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding...' : 'Add Child'}
        </button>
      </form>
    </main>
  );
}

export default function ChildrenPage() {
  return (
    <ProtectedRoute allowedRoles={['parent']}>
      <ChildrenPageContent />
    </ProtectedRoute>
  );
}
