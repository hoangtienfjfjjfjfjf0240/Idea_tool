export const SYSTEM_RULE_CATEGORY = '__system_rule__';

export const DEFAULT_FAST_SYSTEM_RULE = [
  'Generate production-ready Meta vertical video ad ideas for mobile apps.',
  'Keep the selected core user, pain point, PSP, emotion, visual type, trend/angle, and quantity locked.',
  'Open with a concrete, filmable pain-led hook. Show the blocker/consequence in the first beat.',
  'Hook, body, and CTA must form one clear problem-solution chain; body must show the PSP/app action.',
  'Title, visual scenes, and production notes are Vietnamese. Audience voice/script follows the selected market language.',
  'hook_text_overlay and cta_text are bilingual Vietnamese / market language when market language is not Vietnamese.',
  'hook_voice_vi is Vietnamese with full diacritics and translates hook_vo or hook_character_speech.',
  'For health/wellness, use track/check/monitor/reference/wellness; never diagnose, cure, treat, detect disease, or replace a doctor.',
  'Every visual_scene_1/2/3 includes timing plus Position anchor, Contact anchor, and Physical action anchor.',
  'Return JSON only in the current idea schema. Backend will normalize and save.',
].join('\n');

export function looksLikeLearnedAppKnowledge(value: string | null | undefined): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  return /^\[Cập nhật:/i.test(text)
    || /^\[Cáº­p nháº­t:/i.test(text)
    || /Learned ideas:\s*\d+/i.test(text)
    || /filter_combos:\s*\d+/i.test(text)
    || /DATA COVERAGE/i.test(text);
}

export function compactSystemRule(value: string | null | undefined, maxChars = 2400): string {
  const raw = String(value || '').trim();
  const source = raw && !looksLikeLearnedAppKnowledge(raw)
    ? raw
    : DEFAULT_FAST_SYSTEM_RULE;
  const lines = source
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const normalized = lines.join('\n');

  if (normalized.length <= maxChars) return normalized;

  const corePattern = /\b(?:system|rule|framework|schema|json|output|format|hook|body|cta|pacing|language|voice|visual|scene|anchor|compliance|health|medical|must|never|required|core user|pain|painpoint|psp|emotion|trend|quantity|vietnamese|market|luat|dinh dang|ngon ngu|bat buoc|khong|cam|y te|suc khoe)\b/i;
  const scoredLines = lines.map((line, index) => {
    const keywordScore = (line.match(corePattern) ? 2 : 0)
      + (/[.!?:]$/.test(line) ? 1 : 0)
      + (/^(?:[-*#]|\d+[.)])/.test(line) ? 1 : 0);
    return { line, index, score: keywordScore };
  });

  const selected = new Map<number, string>();
  let usedChars = 0;
  const addLine = (entry: { line: string; index: number }) => {
    if (selected.has(entry.index)) return;
    const extra = entry.line.length + (selected.size > 0 ? 1 : 0);
    if (usedChars + extra > maxChars) return;
    selected.set(entry.index, entry.line);
    usedChars += extra;
  };

  scoredLines
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .forEach(addLine);

  if (usedChars < Math.floor(maxChars * 0.75)) {
    scoredLines
      .sort((left, right) => left.index - right.index)
      .forEach(addLine);
  }

  const compacted = [...selected.entries()]
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, line]) => line)
    .join('\n')
    .trim();

  return (compacted || normalized).slice(0, maxChars).replace(/\s+\S*$/, '').trim();
}
