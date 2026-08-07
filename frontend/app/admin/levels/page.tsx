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
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Levels</h1>
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
        </Card>
      )}

      <div style={{ marginTop: 'var(--space-5)' }}>
        <Card>
          <h2>Add Level</h2>
          <form onSubmit={handleSubmit}>
            <div className={styles.formField}>
              <label htmlFor="name" className={styles.formLabel}>
                Name
              </label>
              <input
                id="name"
                className={styles.formInput}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className={styles.formField}>
              <label htmlFor="order" className={styles.formLabel}>
                Order
              </label>
              <input
                id="order"
                type="number"
                className={styles.formInput}
                value={order}
                onChange={(event) => setOrder(event.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Level'}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}

export default function LevelsPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'superadmin']}>
      <AppShell>
        <LevelsPageContent />
      </AppShell>
    </ProtectedRoute>
  );
}
