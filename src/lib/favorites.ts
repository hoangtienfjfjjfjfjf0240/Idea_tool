const FAVORITES_STORAGE_PREFIX = 'idea-tool:favorites:';
export const FAVORITES_UPDATED_EVENT = 'idea-tool:favorites-updated';

interface FavoriteIdeaLike {
  id?: string | null;
  title?: string | null;
  duration?: string | null;
  content?: {
    meta?: {
      isFavorite?: boolean;
      favoriteKeys?: string[];
      favoriteMarkedAt?: string | null;
    };
    hook?: {
      voice?: string;
      textOverlay?: string;
      script?: string;
    };
    body?: {
      voice?: string;
    };
    cta?: {
      voice?: string;
      endCard?: string;
    };
  } | null;
}

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

export function buildIdeaFavoriteFingerprint(appId: string, idea: FavoriteIdeaLike): string {
  return buildFavoriteFingerprint([
    'filter-generator',
    appId,
    idea.title,
    idea.duration,
    idea.content?.hook?.voice,
    idea.content?.hook?.textOverlay,
    idea.content?.hook?.script,
    idea.content?.body?.voice,
    idea.content?.cta?.voice,
    idea.content?.cta?.endCard,
  ]);
}

export function buildIdeaFavoriteKeys(appId: string, idea: FavoriteIdeaLike): string[] {
  return [
    idea.id || '',
    ...(Array.isArray(idea.content?.meta?.favoriteKeys) ? idea.content.meta.favoriteKeys : []),
    buildIdeaFavoriteFingerprint(appId, idea),
  ].filter((key): key is string => typeof key === 'string' && key.trim().length > 0);
}

export function isPersistedFavoriteIdea(idea: FavoriteIdeaLike): boolean {
  return idea.content?.meta?.isFavorite === true;
}

export function hasFavoriteIdeaKey(appId: string, idea: FavoriteIdeaLike, favoriteKeys: Set<string>): boolean {
  if (isPersistedFavoriteIdea(idea)) return true;
  if (favoriteKeys.size === 0) return false;
  return buildIdeaFavoriteKeys(appId, idea).some(key => favoriteKeys.has(key));
}

export function collectFavoriteKeysFromIdeas(appId: string, ideas: FavoriteIdeaLike[]): Set<string> {
  const keys = new Set<string>();

  ideas.forEach(idea => {
    if (!isPersistedFavoriteIdea(idea)) return;
    buildIdeaFavoriteKeys(appId, idea).forEach(key => keys.add(key));
  });

  return keys;
}

export function mergeFavoriteKeys(appId: string, keys: Iterable<string>, ideas: FavoriteIdeaLike[]): Set<string> {
  const merged = new Set(Array.from(keys).filter(key => typeof key === 'string' && key.trim().length > 0));
  collectFavoriteKeysFromIdeas(appId, ideas).forEach(key => merged.add(key));
  return merged;
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

export function notifyFavoriteKeysChanged(appId: string): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(FAVORITES_UPDATED_EVENT, { detail: { appId } }));
}
