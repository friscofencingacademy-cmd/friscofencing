import api from '../api';
import type { LatestAuditRunsResponse } from '../types';

// Query (throws on failure) — sole consumer is admin/audits/page.tsx.
// Superadmin-only on the backend; a non-superadmin visitor never reaches
// this call (see the page's own role guard).
export async function fetchLatestAuditRuns(): Promise<LatestAuditRunsResponse> {
  const res = await api.get<{ data: LatestAuditRunsResponse }>('/audit-runs', {
    params: { latest: 'true' },
  });
  return res.data.data;
}
