'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';

import api from '../../../lib/api';
import ProtectedRoute from '../../components/ProtectedRoute';

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
      <h1>Locations</h1>

      {error ? <p role="alert">{error}</p> : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
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
      )}

      <h2>Add Location</h2>
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
          <label htmlFor="address">Address</label>
          <input
            id="address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="timezone">Timezone</label>
          <input
            id="timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding...' : 'Add Location'}
        </button>
      </form>
    </main>
  );
}

export default function LocationsPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'superadmin']}>
      <LocationsPageContent />
    </ProtectedRoute>
  );
}
