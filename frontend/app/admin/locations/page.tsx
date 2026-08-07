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

interface LocationItem {
  _id: string;
  name: string;
  address: string;
  timezone: string;
}

function LocationsPageContent() {
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [timezone, setTimezone] = useState('America/Chicago');
  const [submitting, setSubmitting] = useState(false);

  const fetchLocations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ locations: LocationItem[] }>('/locations');
      setLocations(res.data.locations);
    } catch (err) {
      setError('Failed to load locations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await api.post('/locations', { name, address, timezone });
      setName('');
      setAddress('');
      setTimezone('America/Chicago');
      await fetchLocations();
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Failed to create location.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Locations</h1>
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
                <th>Address</th>
                <th>Timezone</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => (
                <tr key={location._id}>
                  <td>{location.name}</td>
                  <td>{location.address}</td>
                  <td>{location.timezone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div style={{ marginTop: 'var(--space-5)' }}>
        <Card>
          <h2>Add Location</h2>
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
              <label htmlFor="address" className={styles.formLabel}>
                Address
              </label>
              <input
                id="address"
                className={styles.formInput}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                required
              />
            </div>
            <div className={styles.formField}>
              <label htmlFor="timezone" className={styles.formLabel}>
                Timezone
              </label>
              <input
                id="timezone"
                className={styles.formInput}
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Location'}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}

export default function LocationsPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'superadmin']}>
      <AppShell>
        <LocationsPageContent />
      </AppShell>
    </ProtectedRoute>
  );
}
