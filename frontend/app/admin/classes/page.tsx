'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';

import api from '../../../lib/api';
import ProtectedRoute from '../../components/ProtectedRoute';

interface LevelOption {
  _id: string;
  name: string;
}

interface LocationOption {
  _id: string;
  name: string;
}

interface GroupClassItem {
  _id: string;
  name: string;
  levelId: string;
  locationId: string;
  capacity: number;
}

function levelName(levels: LevelOption[], id: string): string {
  return levels.find((level) => level._id === id)?.name ?? id;
}

function locationName(locations: LocationOption[], id: string): string {
  return locations.find((location) => location._id === id)?.name ?? id;
}

function ClassesPageContent() {
  const [groupClasses, setGroupClasses] = useState<GroupClassItem[]>([]);
  const [levels, setLevels] = useState<LevelOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [levelId, setLevelId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [capacity, setCapacity] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [classesRes, levelsRes, locationsRes] = await Promise.all([
        api.get<{ groupClasses: GroupClassItem[] }>('/group-classes'),
        api.get<{ levels: LevelOption[] }>('/levels'),
        api.get<{ locations: LocationOption[] }>('/locations'),
      ]);
      setGroupClasses(classesRes.data.groupClasses);
      setLevels(levelsRes.data.levels);
      setLocations(locationsRes.data.locations);
    } catch (err) {
      setError('Failed to load classes.');
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
      await api.post('/group-classes', {
        name,
        levelId,
        locationId,
        capacity: Number(capacity),
      });
      setName('');
      setLevelId('');
      setLocationId('');
      setCapacity('');
      await fetchAll();
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Failed to create class.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Group Classes</h1>

      {error ? <p role="alert">{error}</p> : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Level</th>
              <th>Location</th>
              <th>Capacity</th>
            </tr>
          </thead>
          <tbody>
            {groupClasses.map((groupClass) => (
              <tr key={groupClass._id}>
                <td>{groupClass.name}</td>
                <td>{levelName(levels, groupClass.levelId)}</td>
                <td>{locationName(locations, groupClass.locationId)}</td>
                <td>{groupClass.capacity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Add Class</h2>
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
          <label htmlFor="locationId">Location</label>
          <select
            id="locationId"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            required
          >
            <option value="">Select a location</option>
            {locations.map((location) => (
              <option key={location._id} value={location._id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="capacity">Capacity</label>
          <input
            id="capacity"
            type="number"
            min={1}
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding...' : 'Add Class'}
        </button>
      </form>
    </main>
  );
}

export default function ClassesPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'superadmin']}>
      <ClassesPageContent />
    </ProtectedRoute>
  );
}
