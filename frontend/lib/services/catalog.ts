import api from '../api';
import type { GroupClass, Level, Location, Price, PublicLevel, PublicLocation } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// ── Public (no auth) ─────────────────────────────────────────────────────

export async function fetchPublicLevels(): Promise<PublicLevel[]> {
  const res = await api.get<{ levels: PublicLevel[] }>('/levels/public');
  return res.data.levels;
}

export async function fetchPublicLocations(): Promise<PublicLocation[]> {
  const res = await api.get<{ locations: PublicLocation[] }>('/locations/public');
  return res.data.locations;
}

// ── Locations ────────────────────────────────────────────────────────────

export async function fetchLocations(): Promise<Location[]> {
  const res = await api.get<{ locations: Location[] }>('/locations');
  return res.data.locations;
}

export async function createLocation(
  data: Pick<Location, 'name' | 'address' | 'timezone'>
): Promise<MutationResult<Location>> {
  try {
    const res = await api.post<{ location: Location }>('/locations', data);
    return { status: 'success', data: res.data.location };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to create location.') };
  }
}

export async function updateLocation(
  id: string,
  data: Partial<Pick<Location, 'name' | 'address' | 'timezone'>>
): Promise<MutationResult<Location>> {
  try {
    const res = await api.put<{ location: Location }>(`/locations/${id}`, data);
    return { status: 'success', data: res.data.location };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to update location.') };
  }
}

export async function deleteLocation(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.delete(`/locations/${id}`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to delete location.') };
  }
}

// ── Levels ───────────────────────────────────────────────────────────────

export async function fetchLevels(): Promise<Level[]> {
  const res = await api.get<{ levels: Level[] }>('/levels');
  return res.data.levels;
}

export async function createLevel(
  data: Pick<Level, 'name' | 'order'>
): Promise<MutationResult<Level>> {
  try {
    const res = await api.post<{ level: Level }>('/levels', data);
    return { status: 'success', data: res.data.level };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to create level.') };
  }
}

export async function updateLevel(
  id: string,
  data: Partial<Pick<Level, 'name' | 'order'>>
): Promise<MutationResult<Level>> {
  try {
    const res = await api.put<{ level: Level }>(`/levels/${id}`, data);
    return { status: 'success', data: res.data.level };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to update level.') };
  }
}

export async function deleteLevel(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.delete(`/levels/${id}`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to delete level.') };
  }
}

// ── Group classes ────────────────────────────────────────────────────────

export async function fetchGroupClasses(): Promise<GroupClass[]> {
  const res = await api.get<{ groupClasses: GroupClass[] }>('/group-classes');
  return res.data.groupClasses;
}

export async function createGroupClass(
  data: Pick<GroupClass, 'name' | 'levelId' | 'locationId' | 'capacity'>
): Promise<MutationResult<GroupClass>> {
  try {
    const res = await api.post<{ groupClass: GroupClass }>('/group-classes', data);
    return { status: 'success', data: res.data.groupClass };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to create class.') };
  }
}

export async function updateGroupClass(
  id: string,
  data: Partial<Pick<GroupClass, 'name' | 'levelId' | 'locationId' | 'capacity'>>
): Promise<MutationResult<GroupClass>> {
  try {
    const res = await api.put<{ groupClass: GroupClass }>(`/group-classes/${id}`, data);
    return { status: 'success', data: res.data.groupClass };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to update class.') };
  }
}

export async function deleteGroupClass(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.delete(`/group-classes/${id}`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to delete class.') };
  }
}

// ── Prices ───────────────────────────────────────────────────────────────

export async function fetchPrices(): Promise<Price[]> {
  const res = await api.get<{ prices: Price[] }>('/prices');
  return res.data.prices;
}

export async function createPrice(
  data: Pick<Price, 'levelId' | 'monthlyFee'>
): Promise<MutationResult<Price>> {
  try {
    const res = await api.post<{ price: Price }>('/prices', data);
    return { status: 'success', data: res.data.price };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to create price.') };
  }
}

export async function updatePrice(
  id: string,
  data: Partial<Pick<Price, 'levelId' | 'monthlyFee'>>
): Promise<MutationResult<Price>> {
  try {
    const res = await api.put<{ price: Price }>(`/prices/${id}`, data);
    return { status: 'success', data: res.data.price };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to update price.') };
  }
}

export async function deletePrice(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.delete(`/prices/${id}`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to delete price.') };
  }
}
