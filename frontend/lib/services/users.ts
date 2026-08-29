import api from '../api';
import type { AuthUser, Role, SkillLevel } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

export interface CreateUserPayload {
  role: Role;
  firstName: string;
  lastName: string;
  email?: string;
  password?: string;
  parentId?: string;
  skillLevel?: SkillLevel;
  // Student-only; not hard-required by the backend for this admin-facing
  // path (docs/plans/trial-registration-required-fields-plan.md §1.3).
  dateOfBirth?: string;
  // Login-capable-role-only; also not hard-required here (§1.2 hard-
  // requires it only at public self-signup, a different endpoint).
  phone?: string;
}

export interface UpdateUserPayload {
  firstName: string;
  lastName: string;
  email?: string;
  dateOfBirth?: string;
  phone?: string;
}

export async function fetchUsers(role?: Role): Promise<AuthUser[]> {
  const res = await api.get<{ users: AuthUser[] }>('/users', {
    params: role ? { role } : undefined,
  });
  return res.data.users;
}

export async function createUser(data: CreateUserPayload): Promise<MutationResult<AuthUser>> {
  try {
    const res = await api.post<{ user: AuthUser }>('/users', data);
    return { status: 'success', data: res.data.user };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to create user.') };
  }
}

export async function updateUser(
  id: string,
  data: UpdateUserPayload
): Promise<MutationResult<AuthUser>> {
  try {
    const res = await api.put<{ user: AuthUser }>(`/users/${id}`, data);
    return { status: 'success', data: res.data.user };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to update user.') };
  }
}

export async function updateUserPassword(
  id: string,
  newPassword: string
): Promise<MutationResult<undefined>> {
  try {
    await api.put(`/users/${id}/password`, { password: newPassword });
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to update password.') };
  }
}

export async function deleteUser(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.delete(`/users/${id}`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to delete user.') };
  }
}
