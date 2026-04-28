export type HealthMetricKey = 'heartRate' | 'bloodPressure' | 'bloodGlucose';

type HealthMetricDefinition = {
  key: HealthMetricKey;
  label: string;
  promptLabel: string;
  patterns: RegExp[];
};

const HEALTH_METRICS: HealthMetricDefinition[] = [
  {
    key: 'heartRate',
    label: 'nhịp tim',
    promptLabel: 'heart rate / nhịp tim',
    patterns: [
      /\bheart\s*rate\b/,
      /\bnhip\s*tim\b/,
      /\btim\s*mach\b/,
      /\bsuc\s*khoe\s*tim\b/,
      /\bbenh\s*tim\b/,
      /\btim\s*minh\b/,
      /\bbpm\b/,
      /\bpulse\b/,
    ],
  },
  {
    key: 'bloodPressure',
    label: 'huyết áp',
    promptLabel: 'blood pressure / huyết áp',
    patterns: [
      /\bblood\s*pressure\b/,
      /\bhuyet\s*ap\b/,
      /\bcao\s*huyet\s*ap\b/,
      /\bmay\s*do\s*huyet\s*ap\b/,
      /\bdo\s*huyet\s*ap\b/,
    ],
  },
  {
    key: 'bloodGlucose',
    label: 'đường huyết',
    promptLabel: 'blood glucose / đường huyết',
    patterns: [
      /\bblood\s*glucose\b/,
      /\bglucose\b/,
      /\bduong\s*huyet\b/,
      /\btieu\s*duong\b/,
      /\bdiabetes\b/,
    ],
  },
];

export type HealthMetricConflict = {
  solutionMetric: HealthMetricKey;
  solutionLabel: string;
  conflictingAngles: string[];
  conflictingPainPoints: string[];
};

export function normalizeForFilterMatching(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMetricDefinition(key: HealthMetricKey): HealthMetricDefinition {
  return HEALTH_METRICS.find(metric => metric.key === key) || HEALTH_METRICS[0];
}

export function getHealthMetricLabel(key: HealthMetricKey): string {
  return getMetricDefinition(key).label;
}

export function getHealthMetricPromptLabel(key: HealthMetricKey): string {
  return getMetricDefinition(key).promptLabel;
}

export function getHealthMetricsInText(text: string): HealthMetricKey[] {
  const normalized = normalizeForFilterMatching(text);
  if (!normalized) return [];

  return HEALTH_METRICS
    .filter(metric => metric.patterns.some(pattern => pattern.test(normalized)))
    .map(metric => metric.key);
}

function uniqueMetrics(values: string[]): HealthMetricKey[] {
  return Array.from(new Set(values.flatMap(value => getHealthMetricsInText(value))));
}

export function getPrimarySolutionMetric(solutionValues: string[]): HealthMetricKey | null {
  const metrics = uniqueMetrics(solutionValues);
  return metrics.length === 1 ? metrics[0] : null;
}

export function getHealthMetricConflict(input: {
  solutionValues?: string[];
  angleValues?: string[];
  painPointValues?: string[];
}): HealthMetricConflict | null {
  const solutionValues = input.solutionValues || [];
  const solutionMetric = getPrimarySolutionMetric(solutionValues);
  if (!solutionMetric) return null;

  const hasConflictingMetric = (value: string) => {
    const metrics = getHealthMetricsInText(value);
    return metrics.some(metric => metric !== solutionMetric);
  };

  const conflictingAngles = (input.angleValues || []).filter(hasConflictingMetric);
  const conflictingPainPoints = (input.painPointValues || []).filter(hasConflictingMetric);

  if (conflictingAngles.length === 0 && conflictingPainPoints.length === 0) return null;

  return {
    solutionMetric,
    solutionLabel: getHealthMetricLabel(solutionMetric),
    conflictingAngles,
    conflictingPainPoints,
  };
}

export function formatHealthMetricConflictMessage(conflict: HealthMetricConflict): string {
  const conflictingValues = [...conflict.conflictingAngles, ...conflict.conflictingPainPoints]
    .map(value => `"${value}"`)
    .join(', ');

  return `PSP đang là ${conflict.solutionLabel}, nhưng angle/painpoint đang nói sang metric khác: ${conflictingValues}. Hãy chọn lại PSP hoặc bỏ option lệch metric trước khi tạo.`;
}

export function buildFilterConsistencyPromptBlock(input: {
  solutionValues?: string[];
  angleValues?: string[];
  painPointValues?: string[];
}): string {
  const solutionValues = input.solutionValues || [];
  const solutionMetric = getPrimarySolutionMetric(solutionValues);
  if (!solutionMetric) return '';

  const conflict = getHealthMetricConflict(input);
  const selectedPsp = solutionValues.join('; ') || getHealthMetricPromptLabel(solutionMetric);

  return `## FILTER CONSISTENCY CONTRACT
- Locked health metric from selected PSP: ${getHealthMetricPromptLabel(solutionMetric)}
- Selected PSP/app action is the source of truth: ${selectedPsp}
- Every hook, visual, body, proof object, app_demo_action, text overlay, and CTA must stay on this locked metric.
- If APP BRAIN, recent ideas, feature list, hook title, or selected angle mentions another health metric, treat that wording as background noise and do not switch the idea to that metric.
${conflict ? `- Conflicting selected wording detected: ${[...conflict.conflictingAngles, ...conflict.conflictingPainPoints].join(' | ')}. Keep only its emotional/format intent; replace the metric with ${getHealthMetricPromptLabel(solutionMetric)}.` : ''}`;
}

export function detectTargetLanguageFromMarkets(targetMarkets: string[], coreUsers: string[] = []): string | null {
  const joined = normalizeForFilterMatching([...targetMarkets, ...coreUsers].join(' '));
  if (!joined) return null;

  if (/\bnoi\s*tieng\s*(es|spanish|tay\s*ban\s*nha)\b|\btieng\s*es\b|\bspanish\b|\bespanol\b|\btay\s*ban\s*nha\b/.test(joined)) return 'Spanish';
  if (/\bnoi\s*tieng\s*(pt|portuguese|bo\s*dao\s*nha)\b|\btieng\s*pt\b|\bportuguese\b|\bbrazil\b|\bbrasil\b|\bbo\s*dao\s*nha\b/.test(joined)) return 'Portuguese';
  if (/\bnoi\s*tieng\s*(fr|french|france)\b|\btieng\s*(fr|france|phap)\b|\bfrench\b|\bfrancais\b|\bfrance\b|\bphap\b/.test(joined)) return 'French';
  if (/\bnoi\s*tieng\s*(de|german|duc)\b|\btieng\s*(de|duc)\b|\bgerman\b|\bgermany\b|\bdeutsch\b|\bduc\b|\bde\b/.test(joined)) return 'German';
  if (/\bnoi\s*tieng\s*(it|italian|y)\b|\btieng\s*(it|y)\b|\bitalian\b|\bitaly\b|\bit\b/.test(joined)) return 'Italian';
  if (/\bnoi\s*tieng\s*(jp|japanese|nhat)\b|\bjapanese\b|\bjapan\b|\bnhat\b|\bjp\b/.test(joined)) return 'Japanese';
  if (/\bnoi\s*tieng\s*(kr|korean|han)\b|\bkorean\b|\bkorea\b|\bhan\b|\bkr\b/.test(joined)) return 'Korean';
  if (/\bnoi\s*tieng\s*(vi|vietnamese|viet)\b|\bvietnamese\b|\bvietnam\b|\bviet\b|\bvn\b/.test(joined)) return 'Vietnamese';
  if (/\bthai\b|\bthailand\b|\bthai\s*lan\b/.test(joined)) return 'Thai';
  if (/\bindonesian\b|\bindonesia\b/.test(joined)) return 'Indonesian';
  if (/\bmalay\b|\bmalaysia\b/.test(joined)) return 'Malay';
  if (/\bus\b|\busa\b|\bunited\s*states\b|\bmy\b|\buk\b|\bunited\s*kingdom\b|\bcanada\b|\baustralia\b|\benglish\b/.test(joined)) return 'English';

  return null;
}
