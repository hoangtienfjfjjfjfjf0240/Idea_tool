export interface HookFrameworkSource {
  title?: unknown;
  subtitle?: unknown;
  description?: unknown;
  hook_concept?: unknown;
  visual_detail?: unknown;
  painpoint?: unknown;
  emotion?: unknown;
  core_user?: unknown;
  creative_type?: unknown;
}

export interface HookFrameworkSnapshot {
  coreUser: string;
  painpoint: string;
  emotion: string;
  psp: string;
  creativeType: string;
  angle: string;
}

function readText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function isWeakValue(value: string) {
  const normalized = value.toLowerCase().trim();
  return !normalized
    || ['n/a', 'na', 'none', 'unknown', 'general', 'general viewer', 'general user friction', 'hook modify'].includes(normalized)
    || normalized.startsWith('general ');
}

function firstUseful(...values: unknown[]) {
  for (const value of values) {
    const text = readText(value);
    if (text && !isWeakValue(text)) return text;
  }
  return '';
}

function compact(value: string, limit = 120) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function looksHealthRelated(source: string) {
  return /\b(?:health|fitness|wellness|body|organ|heart|blood|pressure|rate|morning|exercise|routine|stiff|energy|sleep|suc khoe|sức khỏe|noi tang|nội tạng|bai tap|bài tập|co the|cơ thể)\b/i.test(source);
}

function looksStorageRelated(source: string) {
  return /\b(?:storage|memory|photo|video|file|clean|cleanup|phone full|ios|update|dung luong|bộ nhớ|bo nho|day may|đầy máy)\b/i.test(source);
}

export function buildHookFrameworkFallback(
  hook: HookFrameworkSource,
  options: { appName?: string; appCategory?: string } = {}
): HookFrameworkSnapshot {
  const title = readText(hook.title, 'Imported hook');
  const description = readText(hook.description);
  const visual = readText(hook.visual_detail);
  const concept = readText(hook.hook_concept);
  const creativeType = firstUseful(hook.creative_type, hook.subtitle) || 'UGC';
  const source = [title, description, visual, concept, options.appCategory, options.appName].filter(Boolean).join('\n');

  const coreUser = firstUseful(hook.core_user)
    || (looksHealthRelated(source)
      ? 'Health-conscious adults who want a simple, low-friction wellness routine'
      : looksStorageRelated(source)
        ? 'Mobile users who feel blocked by phone storage or cleanup friction'
        : 'Viewers who recognize the imported video situation and want a clearer next action');

  const painpoint = firstUseful(hook.painpoint)
    || (looksHealthRelated(source)
      ? 'Morning body feels stiff or low-energy, and the viewer wants to understand body signals without panic'
      : looksStorageRelated(source)
        ? 'Phone feels full or cluttered, blocking the next action the user wants to take'
        : compact(description || visual || concept || title, 180));

  const emotion = firstUseful(hook.emotion)
    || (looksHealthRelated(source)
      ? 'Curiosity -> Relief -> Empowerment'
      : looksStorageRelated(source)
        ? 'Frustration -> Relief -> Control'
        : 'Curiosity -> Recognition -> Action');

  const psp = firstUseful(hook.hook_concept)
    || (options.appName ? `${options.appName} as the next action connected to this hook` : compact(description || visual || title, 160));

  const angle = [
    creativeType,
    compact(firstUseful(concept, description, visual, title), 120),
  ].filter(Boolean).join(' | ');

  return {
    coreUser,
    painpoint,
    emotion,
    psp,
    creativeType,
    angle: angle || `Winning Hook: ${title}`,
  };
}

export function enrichHookWithFramework<T extends HookFrameworkSource>(
  hook: T,
  options: { appName?: string; appCategory?: string } = {}
): T & {
  core_user: string;
  painpoint: string;
  emotion: string;
  hook_concept: string;
  creative_type: string;
} {
  const framework = buildHookFrameworkFallback(hook, options);
  return {
    ...hook,
    core_user: framework.coreUser,
    painpoint: framework.painpoint,
    emotion: framework.emotion,
    hook_concept: framework.psp,
    creative_type: framework.creativeType,
  };
}
