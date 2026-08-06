'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';

import api from '../../../lib/api';
import ProtectedRoute from '../../components/ProtectedRoute';

interface LevelOption {
  _id: string;
  name: string;
}

interface PriceItem {
  _id: string;
  levelId: string;
  monthlyFee: number;
}

function levelName(levels: LevelOption[], id: string): string {
  return levels.find((level) => level._id === id)?.name ?? id;
}

function PricesPageContent() {
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [levels, setLevels] = useState<LevelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [levelId, setLevelId] = useState('');
  const [monthlyFee, setMonthlyFee] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [pricesRes, levelsRes] = await Promise.all([
        api.get<{ prices: PriceItem[] }>('/prices'),
        api.get<{ levels: LevelOption[] }>('/levels'),
      ]);
      setPrices(pricesRes.data.prices);
      setLevels(levelsRes.data.levels);
    } catch (err) {
      setError('Failed to load prices.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await api.post('/prices', {
        levelId,
        monthlyFee: Number(monthlyFee),
      });
      setLevelId('');
      setMonthlyFee('');
      await fetchAll();
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Failed to create price.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Prices</h1>

      {error ? <p role="alert">{error}</p> : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Level</th>
              <th>Monthly Fee</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((price) => (
              <tr key={price._id}>
                <td>{levelName(levels, price.levelId)}</td>
                <td>{price.monthlyFee}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Add Price</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="levelId">Level</label>
          <select
            id="levelId"
            value={levelId}
            onChange={(event) => setLevelId(event.target.value)}
            required
          >
            <option value="">Select a level</option>
            {levels.map((level) => (
              <option key={level._id} value={level._id}>
                {level.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="monthlyFee">Monthly Fee</label>
          <input
            id="monthlyFee"
            type="number"
            min={0}
            value={monthlyFee}
            onChange={(event) => setMonthlyFee(event.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding...' : 'Add Price'}
        </button>
      </form>
    </main>
  );
}

export default function PricesPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'superadmin']}>
      <PricesPageContent />
    </ProtectedRoute>
  );
}
