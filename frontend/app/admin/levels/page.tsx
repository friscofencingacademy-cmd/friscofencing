'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';

import api from '../../../lib/api';
import ProtectedRoute from '../../components/ProtectedRoute';

interface LevelItem {
  _id: string;
  name: string;
  order: number;
}

function LevelsPageContent() {
  const [levels, setLevels] = useState<LevelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [order, setOrder] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchLevels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ levels: LevelItem[] }>('/levels');
      setLevels(res.data.levels);
    } catch (err) {
      setError('Failed to load levels.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLevels();
  }, [fetchLevels]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await api.post('/levels', { name, order: Number(order) });
      setName('');
      setOrder('');
      await fetchLevels();
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Failed to create level.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Levels</h1>

      {error ? <p role="alert">{error}</p> : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Order</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((level) => (
              <tr key={level._id}>
                <td>{level.name}</td>
                <td>{level.order}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Add Level</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="name">Name</label>
          <input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="order">Order</label>
          <input
            id="order"
            type="number"
            value={order}
            onChange={(event) => setOrder(event.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding...' : 'Add Level'}
        </button>
      </form>
    </main>
  );
}

export default function LevelsPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'superadmin']}>
      <LevelsPageContent />
    </ProtectedRoute>
  );
}
