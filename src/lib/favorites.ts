const FAVORITES_STORAGE_PREFIX = 'idea-tool:favorites:';

function getStorageKey(appId: string): string {
  return `${FAVORITES_STORAGE_PREFIX}${appId}`;
}

function normalizePart(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function buildFavoriteFingerprint(parts: unknown[]): string {
  return parts
    .map(normalizePart)
    .filter(Boolean)
    .join('||');
}

export function loadFavoriteKeys(appId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();

  try {
    const raw = window.localStorage.getItem(getStorageKey(appId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0));
  } catch {
    return new Set();
  }
}

export function saveFavoriteKeys(appId: string, keys: Iterable<string>): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getStorageKey(appId), JSON.stringify(Array.from(keys)));
  } catch {
    // Ignore storage errors so the rest of the UI still works.
  }
}
