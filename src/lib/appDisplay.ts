import type { AppProject } from '@/types/database';

const WEB_FUNNEL_APP_NAMES_BY_ID: Record<string, string> = {
  '3938d476-cb33-4d4e-a650-19e23fdc6819': 'iKcal AI webfunnel',
  '481f61f2-cd3a-4e51-beba-8a167594fdff': 'iCardiac webfunnel',
};

export function isPinnedHealthWebFunnelApp(app: Pick<AppProject, 'id'> | null | undefined) {
  return Boolean(app?.id && WEB_FUNNEL_APP_NAMES_BY_ID[app.id]);
}

export function withPinnedWebFunnelAppName<T extends AppProject | null>(app: T): T {
  if (!app || !WEB_FUNNEL_APP_NAMES_BY_ID[app.id]) return app;
  return {
    ...app,
    name: WEB_FUNNEL_APP_NAMES_BY_ID[app.id],
  };
}
