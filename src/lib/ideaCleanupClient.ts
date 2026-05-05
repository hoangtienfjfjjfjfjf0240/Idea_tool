import { authenticatedFetch } from '@/lib/authFetch';

export async function cleanupInvalidStrategyIdeas(appId: string) {
  const response = await authenticatedFetch('/api/cleanup-invalid-ideas', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId }),
  });

  const payload = await response.json().catch(() => null) as { deletedCount?: number; error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error || 'Cleanup invalid ideas failed.');
  }

  return payload?.deletedCount || 0;
}
