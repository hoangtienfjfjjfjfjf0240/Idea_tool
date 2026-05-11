import type { FilterState, GeneratedIdea } from '@/types/database';

export const REQUIRED_STRATEGY_FILTER_KEYS: Array<keyof FilterState> = [
  'coreUser',
  'solution',
  'emotion',
  'visualType',
  'painPoint',
  'angle',
];

function toFilterValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim());
  }

  if (typeof value === 'string' && value.trim().length > 0) return [value.trim()];
  return [];
}

export function hasCompleteStrategyFilters(filters: Partial<FilterState> | null | undefined) {
  if (!filters || typeof filters !== 'object') return false;
  return REQUIRED_STRATEGY_FILTER_KEYS.every(key => toFilterValues(filters[key]).length > 0);
}

export function isHookLibraryIdeaLike(idea: Pick<GeneratedIdea, 'content' | 'filters_snapshot'>) {
  const meta = idea.content?.meta;
  const angleValues = toFilterValues(idea.filters_snapshot?.angle);
  const videoStructures = toFilterValues(idea.filters_snapshot?.videoStructure);

  if (meta?.builderVersion === 'hook_library_modify_history_v1' || meta?.builderVersion === 'hook_library_full_idea_v1') {
    return true;
  }

  if (meta?.track === 'hook-modify' || meta?.track === 'hook-full-idea') {
    return true;
  }

  if (meta?.sessionType === 'modify-hook' || meta?.sessionType === 'full-idea') {
    return true;
  }

  if (idea.content?.creativeType === 'Modified Hook') {
    return true;
  }

  if (videoStructures.includes('Hook Library') || videoStructures.includes('Modified Hook')) {
    return true;
  }

  return angleValues.some(value => value.startsWith('Winning Hook:') || value.startsWith('Modified Hook:'));
}

function isLocalFallbackStrategyIdeaLike(idea: Pick<GeneratedIdea, 'content'>) {
  const meta = idea.content?.meta;
  const builderVersion = String(meta?.builderVersion || '').toLowerCase();

  if (
    builderVersion.includes('fallback')
    || builderVersion.includes('local_backup')
    || builderVersion.includes('local backup')
    || builderVersion.includes('template')
  ) {
    return true;
  }

  const contentText = JSON.stringify(idea.content || {}).toLowerCase();
  return contentText.includes('[hook_character_speech]')
    || contentText.includes('[hook_text_overlay]')
    || contentText.includes('structured fallback because the ai batch returned too few valid ideas')
    || contentText.includes('why does this keep happening every time?')
    || contentText.includes('guessing keeps you stuck');
}

export function isInvalidStrategyIdea(idea: Pick<GeneratedIdea, 'content' | 'filters_snapshot'>) {
  if (isHookLibraryIdeaLike(idea)) return false;
  return isLocalFallbackStrategyIdeaLike(idea) || !hasCompleteStrategyFilters(idea.filters_snapshot);
}
