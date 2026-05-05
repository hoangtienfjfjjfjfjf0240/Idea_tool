import type { FilterState } from '@/types/database';

export type StrategyCodeFilterKey =
  | 'coreUser'
  | 'solution'
  | 'emotion'
  | 'visualType'
  | 'painPoint'
  | 'angle';

export const STRATEGY_CODE_FIELDS: Array<{
  key: StrategyCodeFilterKey;
  prefix: string;
  label: string;
}> = [
  { key: 'coreUser', prefix: 'A', label: 'Core User' },
  { key: 'solution', prefix: 'B', label: 'PSP/Tinh nang' },
  { key: 'emotion', prefix: 'C', label: 'Emotion' },
  { key: 'visualType', prefix: 'D', label: 'Visual' },
  { key: 'painPoint', prefix: 'E', label: 'Painpoint' },
  { key: 'angle', prefix: 'F', label: 'Angle' },
];

export type StrategyCodeLookup = Partial<Record<StrategyCodeFilterKey, Record<string, string>>>;

export function normalizeStrategyCodeValue(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function cleanStrategyValues(values: unknown): string[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  return values
    .map(value => String(value || '').trim())
    .filter(value => {
      if (!value) return false;
      const normalized = normalizeStrategyCodeValue(value);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export function formatStrategyValueGroup(values: unknown): string {
  return cleanStrategyValues(values).join(', ');
}

export function buildStrategyCodeLookup(source: Partial<Record<StrategyCodeFilterKey, string[]>>): StrategyCodeLookup {
  const lookup: StrategyCodeLookup = {};

  STRATEGY_CODE_FIELDS.forEach(field => {
    const levelLookup: Record<string, string> = {};
    cleanStrategyValues(source[field.key]).forEach((value, index) => {
      levelLookup[normalizeStrategyCodeValue(value)] = `${field.prefix}${index + 1}`;
    });
    lookup[field.key] = levelLookup;
  });

  return lookup;
}

export function getStrategyCodeForValue(
  lookup: StrategyCodeLookup,
  key: StrategyCodeFilterKey,
  value: unknown
) {
  return lookup[key]?.[normalizeStrategyCodeValue(value)] || '';
}

export function formatStrategyCodeForFilters(
  filters: Partial<FilterState> | null | undefined,
  lookup: StrategyCodeLookup,
  keys: StrategyCodeFilterKey[] = STRATEGY_CODE_FIELDS.map(field => field.key)
) {
  if (!filters) return '';

  return keys
    .flatMap(key => cleanStrategyValues(filters[key]).map(value => getStrategyCodeForValue(lookup, key, value)))
    .filter(Boolean)
    .join('');
}

export function formatStrategyCodeForFilterGroups(
  filters: Partial<FilterState> | null | undefined,
  lookup: StrategyCodeLookup,
  keys: StrategyCodeFilterKey[] = STRATEGY_CODE_FIELDS.map(field => field.key)
) {
  if (!filters) return '';

  return keys
    .map(key => getStrategyCodeForValue(lookup, key, formatStrategyValueGroup(filters[key])))
    .filter(Boolean)
    .join('');
}

export function getStrategyCodeMapRows(
  filters: Partial<FilterState> | null | undefined,
  lookup: StrategyCodeLookup,
  keys: StrategyCodeFilterKey[] = STRATEGY_CODE_FIELDS.map(field => field.key)
) {
  if (!filters) return [];

  return keys.flatMap(key => {
    const field = STRATEGY_CODE_FIELDS.find(item => item.key === key);
    if (!field) return [];

    return cleanStrategyValues(filters[key])
      .map(value => {
        const code = getStrategyCodeForValue(lookup, key, value);
        return code ? `${code} = ${field.label}: ${value}` : '';
      })
      .filter(Boolean);
  });
}

export function getStrategyGroupCodeMapRows(
  filters: Partial<FilterState> | null | undefined,
  lookup: StrategyCodeLookup,
  keys: StrategyCodeFilterKey[] = STRATEGY_CODE_FIELDS.map(field => field.key)
) {
  if (!filters) return [];

  return keys
    .map(key => {
      const field = STRATEGY_CODE_FIELDS.find(item => item.key === key);
      const value = formatStrategyValueGroup(filters[key]);
      if (!field || !value) return '';

      const code = getStrategyCodeForValue(lookup, key, value);
      return code ? `${code} = ${field.label}: ${value}` : '';
    })
    .filter(Boolean);
}
