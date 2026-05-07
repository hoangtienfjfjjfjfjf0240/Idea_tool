import type { AppProject } from '@/types/database';

function normalizeAppName(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function getWebFunnelAppName(name: string) {
  const normalized = normalizeAppName(name);

  if (/\bikcal\b/.test(normalized) || /\bcalori(?:e)?\s+counter\b/.test(normalized)) {
    return 'iKcal AI webfunnel';
  }

  if (/\bicardiac\b/.test(normalized) || /\bheart\s+health\s+monitor\b/.test(normalized)) {
    return 'iCardiac webfunnel';
  }

  return name;
}

export function withWebFunnelAppName<T extends AppProject | null>(app: T): T {
  if (!app) return app;
  return {
    ...app,
    name: getWebFunnelAppName(app.name),
  };
}
