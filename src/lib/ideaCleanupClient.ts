import { authenticatedFetch } from '@/lib/authFetch';

export async function cleanupInvalidStrategyIdeas(appId: string) {
  try {
    const response = await authenticatedFetch('/api/cleanup-invalid-ideas', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, dryRun: true }),
    });

    const payload = await response.json().catch(() => null) as { deletedCount?: number; error?: string } | null;
    if (!response.ok) {
      console.warn('Cleanup invalid ideas skipped:', payload?.error || response.statusText);
      return 0;
    }

    return payload?.deletedCount || 0;
  } catch (error) {
    console.warn('Cleanup invalid ideas skipped:', error);
    return 0;
  }
}
