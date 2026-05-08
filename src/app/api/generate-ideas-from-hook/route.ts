import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';
import {
  BULLETPROOF_VISUAL_ANCHOR_RULES,
  buildFrameworkInjection,
  CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT,
  CREATIVE_PROMPT_RULES,
  PROMPT_SYSTEM_BUILDER_RULES,
  PROMPT_SYSTEM_BUILDER_COMPATIBILITY_GUARDRAILS,
  estimateHookDurationSeconds,
  normalizeCreativeBriefOutput,
  normalizeIdeaOutput,
  parseJsonLoose,
  TOOL_COMPATIBILITY_GUARDRAILS,
} from '@/lib/creativePromptSystem';
import { guardApiRequest } from '@/lib/apiGuards';
import {
  buildFilterConsistencyPromptBlock,
  detectTargetLanguageFromMarkets,
} from '@/lib/filterConsistency';
import { enrichHookWithFramework } from '@/lib/hookFramework';

export const maxDuration = 300;
const MAX_IDEAS_PER_AI_BATCH = 5;
const MAX_IDEAS_PER_REQUEST = 5;
const GENERATE_FROM_HOOK_BATCH_TIMEOUT_MS = 30000;
const GENERATE_FROM_HOOK_FALLBACK_TIMEOUT_MS = 15000;
const GENERATE_FROM_HOOK_REFILL_TIMEOUT_MS = 30000;
const GENERATE_FROM_HOOK_REQUEST_AI_BUDGET_MS = 105000;
const GENERATE_FROM_HOOK_MIN_CALL_TIMEOUT_MS = 8000;
const GENERATE_FROM_HOOK_REFILL_CONCURRENCY = 3;
const ENABLE_HOOK_FULL_IDEA_RETRY = false;
const ENABLE_HOOK_FULL_IDEA_REFILL = true;
const PROMPT_SYSTEM_BUILDER_HTML_MARKER = 'PROMPT_SYSTEM_BUILDER_HTML_V1';
const TRACKING_ID_PATTERN = /^P\d+-A\d+-I\d+$/;
const PATTERN_INTERRUPT_PATTERN = /(?:\?|\d|=|vs\b|still\b|without\b|stop\b|never\b|why\b|how\b|worst\b|finally\b|painful\b|awkward\b|annoying\b|sao\b|vẫn\b|đừng\b|không cần\b|thay vì|bao giờ|tệ nhất|mệt|phiền|khổ)/i;
const MEDICAL_CLAIM_PATTERN = /\b(?:diagnos(?:e|is|ing)|cure|treat(?:ment|ing)?|heal(?:ed|ing)?|detect disease|replace doctor|medical results?|clinical diagnosis|chẩn đoán|điều trị|chữa(?: khỏi)?|phát hiện bệnh|thay thế bác sĩ|kết quả y tế chính xác)\b/i;
const BEFORE_AFTER_PATTERN = /\b(?:before\s*\/\s*after|before and after|trước\s+và\s+sau|trước\s*\/\s*sau)\b/i;
const HEALTH_CONTEXT_PATTERN = /\b(?:health|doctor|disease|symptom|condition|therapy|medical|bệnh|bác sĩ|triệu chứng|sức khỏe|điều trị)\b/i;

const RAW_FULL_IDEA_PAYLOAD_PATTERNS = [
  /"?title"?\s*:/i,
  /"?duration"?\s*:/i,
  /"?creativeType"?\s*:/i,
  /"?framework"?\s*:/i,
  /"?hook"?\s*:\s*\{/i,
  /"?body"?\s*:\s*\{/i,
  /"?cta"?\s*:\s*\{/i,
];

const FULL_IDEA_VARIATION_FOCUS = [
  'mirror/selfie confession with a surprising first-frame reveal',
  'morning routine friction that makes the viewer pause',
  'social comment or friend reaction that creates FOMO',
  'close-up app demo proof object with a human reaction',
  '3D or motion graphic knowledge beat over real UGC footage',
  'kitchen/bedroom/home-life moment with a private worry',
  'screen-recording first with a sharp data/check moment',
  'POV narrative where the user changes one small habit',
  'split contrast between old assumption and new tracking habit',
  'trend-native challenge/reaction format with a safe wellness angle',
];

function toPositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function buildIdeaBatchPlans(totalRequestedQuantity: number) {
  const plans: Array<{ batchQuantity: number; batchStartIndex: number }> = [];
  for (let batchStartIndex = 0; batchStartIndex < totalRequestedQuantity; batchStartIndex += MAX_IDEAS_PER_AI_BATCH) {
    plans.push({
      batchQuantity: Math.min(MAX_IDEAS_PER_AI_BATCH, totalRequestedQuantity - batchStartIndex),
      batchStartIndex,
    });
  }
  return plans;
}

function parseJson(text: string) {
  return parseJsonLoose(text);
}

function parseFullIdeaAiText(text: string) {
  return parseJson(text) || parseGeminiJsonLikeFullIdeasText(text) || parseReadableFullIdeasText(text);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function looksLikeRawFullIdeaPayload(value: unknown): boolean {
  const text = asText(value);
  if (!text) return false;
  const sample = text.slice(0, 1800);
  const markerCount = RAW_FULL_IDEA_PAYLOAD_PATTERNS.filter(pattern => pattern.test(sample)).length;
  const startsLikePayload = /^\s*(?:\d+(?:[.,]\d+)?\s*[-\u2013\u2014\u2212]\s*\d+(?:[.,]\d+)?s?\s*:\s*)?[\[{]/.test(sample);
  return markerCount >= 3 || (startsLikePayload && markerCount >= 2);
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  const text = asText(value);
  return text ? [text] : [];
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function normalizeCompareText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardSimilarity(a: string, b: string) {
  const tokensA = new Set(normalizeCompareText(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeCompareText(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function hasDistinctHookVariations(variations: string[]): boolean {
  const normalized = variations.map(normalizeCompareText);
  if (new Set(normalized).size !== normalized.length) return false;

  for (let i = 0; i < variations.length; i++) {
    for (let j = i + 1; j < variations.length; j++) {
      if (jaccardSimilarity(variations[i], variations[j]) >= 0.78) {
        return false;
      }
    }
  }

  return true;
}

function isSpecificDontDo(text: string): boolean {
  const normalized = normalizeCompareText(text);
  if (countWords(text) < 4) return false;
  return !/^(dont|don't|do not|avoid|khong|không)\s+(generic|bad|boring|ugly|messy)$/.test(normalized);
}

function totalVoiceWords(item: Record<string, unknown>): number {
  const hook = asRecord(item.hook);
  const body = asRecord(item.body);
  const cta = asRecord(item.cta);
  return countWords([
    asText(hook.characterSpeech),
    asText(hook.voiceover),
    asText(hook.voice),
    asText(body.characterSpeech),
    asText(body.voiceover),
    asText(body.voice),
    asText(cta.characterSpeech),
    asText(cta.voiceover),
    asText(cta.voice),
  ].filter(Boolean).join(' '));
}

function repairIdeaTrackingFields(
  item: Record<string, unknown>,
  context: { batchStartIndex: number; ideaIndex: number; pillar: string }
): Record<string, unknown> {
  const next = { ...item };
  const meta = { ...asRecord(item.meta) };
  const globalIdeaIndex = context.batchStartIndex + context.ideaIndex;

  next.id = `P0-A0-I${globalIdeaIndex}`;
  meta.builderVersion = asText(meta.builderVersion) || 'prompt_system_builder_v1';
  meta.pillar = asText(meta.pillar) || context.pillar;
  meta.pillarIndex = Number(meta.pillarIndex ?? 0) || 0;
  next.meta = meta;

  return next;
}

function sanitizeComplianceText(text: string): string {
  return text
    .replace(/\bdiagnos(?:e|is|ing)\b/gi, 'check')
    .replace(/\bclinical diagnosis\b/gi, 'wellness note')
    .replace(/\bmedical results?\b/gi, 'wellness reference')
    .replace(/\bdetect disease\b/gi, 'notice patterns')
    .replace(/\breplace doctor\b/gi, 'support your routine')
    .replace(/\btreat(?:ment|ing)?\b/gi, 'support')
    .replace(/\bcure\b/gi, 'support')
    .replace(/\bheal(?:ed|ing)?\b/gi, 'improve')
    .replace(/cháº©n Ä‘oÃ¡n/gi, 'theo dÃµi')
    .replace(/Ä‘iá»u trá»‹/gi, 'há»— trá»£')
    .replace(/chá»¯a(?: khá»i)?/gi, 'há»— trá»£')
    .replace(/phÃ¡t hiá»‡n bá»‡nh/gi, 'nháº­n tháº¥y dáº¥u hiá»‡u')
    .replace(/thay tháº¿ bÃ¡c sÄ©/gi, 'há»— trá»£ thá»›i quen cá»§a báº¡n')
    .replace(/káº¿t quáº£ y táº¿ chÃ­nh xÃ¡c/gi, 'thÃ´ng tin tham kháº£o');
}

function sanitizeComplianceTextStrict(text: string): string {
  return text
    .replace(/\bdiagnos(?:e|es|ed|ing|is|tic|tics)\b/gi, 'check')
    .replace(/\bclinical diagnosis\b/gi, 'wellness note')
    .replace(/\bdiagnostic results?\b/gi, 'wellness reference')
    .replace(/\bmedical results?\b/gi, 'wellness reference')
    .replace(/\bdetect(?:s|ed|ing)?\s+(?:a\s+)?(?:disease|condition|diabetes|cancer|heart disease|illness)\b/gi, 'notice wellness patterns')
    .replace(/\b(?:replace|skip|avoid)\s+(?:your\s+)?doctor\b/gi, 'support your routine')
    .replace(/\btreat(?:s|ed|ing|ment|ments)?\b/gi, 'support')
    .replace(/\bcure(?:s|d|ing)?\b/gi, 'support')
    .replace(/\bheal(?:s|ed|ing)?\b/gi, 'improve')
    .replace(/\btherapy\b/gi, 'routine')
    .replace(/\bbefore\s*\/\s*after\b/gi, 'start/result')
    .replace(/\bbefore and after\b/gi, 'start and result')
    .replace(/trước\s*\/\s*sau/gi, 'lúc đầu/kết quả')
    .replace(/trước\s+và\s+sau/gi, 'lúc đầu và kết quả')
    .replace(/chẩn đoán/gi, 'theo dõi')
    .replace(/điều trị/gi, 'hỗ trợ')
    .replace(/chữa(?: khỏi)?/gi, 'hỗ trợ')
    .replace(/phát hiện bệnh/gi, 'nhận thấy dấu hiệu')
    .replace(/thay thế bác sĩ/gi, 'hỗ trợ thói quen của bạn')
    .replace(/kết quả y tế chính xác/gi, 'thông tin tham khảo');
}

function sanitizeComplianceValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeComplianceTextStrict(sanitizeComplianceText(value));
  if (Array.isArray(value)) return value.map(sanitizeComplianceValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, sanitizeComplianceValue(item)])
    );
  }
  return value;
}

function sanitizeIdeaComplianceLanguage(item: Record<string, unknown>): Record<string, unknown> {
  return sanitizeComplianceValue(item) as Record<string, unknown>;
}

function validateIdeaOutput(item: Record<string, unknown>): string[] {
  const meta = asRecord(item.meta);
  const hook = asRecord(item.hook);
  const body = asRecord(item.body);
  const cta = asRecord(item.cta);

  const id = asText(item.id);
  const hookPrimary = asText(meta.hookPrimary);
  const hookAlt1 = asText(meta.hookAlt1);
  const hookAlt2 = asText(meta.hookAlt2);
  const hookVisual = asText(hook.visual) || asText(hook.script);
  const hookCharacterSpeech = asText(hook.characterSpeech);
  const hookVoiceover = asText(hook.voiceover);
  const hookVoice = [hookCharacterSpeech, hookVoiceover, asText(hook.voice)].filter(Boolean).join(' ');
  const hookTextOverlay = asText(hook.textOverlay) || asText(hook.text);
  const bodyVisual = asText(body.visual) || asText(body.script);
  const bodyVoice = [asText(body.characterSpeech), asText(body.voiceover), asText(body.voice)].filter(Boolean).join(' ');
  const bodyTextOverlay = asText(body.textOverlay) || asText(body.text);
  const ctaVisual = asText(cta.visual) || asText(cta.script);
  const ctaVoice = [asText(cta.characterSpeech), asText(cta.voiceover), asText(cta.voice)].filter(Boolean).join(' ');
  const ctaTextOverlay = asText(cta.textOverlay) || asText(cta.text);
  const ctaEndCard = asText(cta.endCard);
  const dontDo = asText(meta.dontDo);

  const errors: string[] = [];

  if (!TRACKING_ID_PATTERN.test(id)) errors.push('id must follow P{pillar}-A{angle}-I{idea}');
  if (!hookPrimary) errors.push('meta.hookPrimary is required');
  if (!hookVisual) errors.push('hook.visual is required');
  if (!hookVoice && !hookTextOverlay) errors.push('hook needs voice or text overlay');
  if (hookCharacterSpeech && hookVoiceover) errors.push('hook must use either characterSpeech or voiceover, not both');
  if (hookCharacterSpeech && !/^\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\s*s\s*[-:]\s*[^:]{2,80}:/m.test(hookCharacterSpeech)) {
    errors.push('hook characterSpeech must include time + speaker label');
  }
  if (/\b(?:Voiceover|Voice over|VO|Character speech|CHARACTER SPEECH|VOICEOVER|VOICE|Text\s+(?:hien|hi[eệ]n))\s*:/i.test(hookVisual)) {
    errors.push('hook visual must not contain inline Voiceover, Character speech, or Text hien labels');
  }
  if (!bodyVisual) errors.push('body.visual is required');
  if (!bodyVoice && !bodyTextOverlay) errors.push('body needs voice or text overlay');
  if (!ctaVisual) errors.push('cta.visual is required');
  if (!ctaVoice && !ctaTextOverlay) errors.push('cta needs voice or text overlay');
  if (!ctaEndCard) errors.push('cta.endCard is required');

  [
    ['hook.visual', hookVisual],
    ['hook.voice', hookVoice],
    ['hook.textOverlay', hookTextOverlay],
    ['body.visual', bodyVisual],
    ['body.voice', bodyVoice],
    ['body.textOverlay', bodyTextOverlay],
    ['cta.visual', ctaVisual],
    ['cta.voice', ctaVoice],
    ['cta.textOverlay', ctaTextOverlay],
    ['cta.endCard', ctaEndCard],
  ].forEach(([field, value]) => {
    if (looksLikeRawFullIdeaPayload(value)) {
      errors.push(`${field} contains raw JSON payload instead of production copy`);
    }
  });

  const complianceText = [
    hookPrimary,
    hookAlt1,
    hookAlt2,
    hookVisual,
    hookVoice,
    hookTextOverlay,
    bodyVisual,
    bodyVoice,
    bodyTextOverlay,
    ctaVisual,
    ctaVoice,
    ctaTextOverlay,
    ctaEndCard,
  ]
    .filter(Boolean)
    .join(' ');

  if (MEDICAL_CLAIM_PATTERN.test(complianceText)) {
    errors.push('contains prohibited medical claim language');
  }

  if (BEFORE_AFTER_PATTERN.test(complianceText) && HEALTH_CONTEXT_PATTERN.test(complianceText)) {
    errors.push('contains prohibited before/after health framing');
  }

  return errors;
}

function normalizeAndValidateIdeas(
  items: unknown[],
  context: { duration: string; appName: string; pillar: string; batchStartIndex: number }
) {
  const valid: Record<string, unknown>[] = [];
  const invalidReasons: string[] = [];

  items.forEach((item, ideaIndex) => {
    const normalized = sanitizeIdeaComplianceLanguage(repairIdeaTrackingFields(
      normalizeIdeaOutput(item, {
        duration: context.duration,
        appName: context.appName,
        pillar: context.pillar,
      }),
      { batchStartIndex: context.batchStartIndex, ideaIndex, pillar: context.pillar }
    ));
    const errors = validateIdeaOutput(normalized);

    if (errors.length === 0) valid.push(normalized);
    else invalidReasons.push(`Idea ${context.batchStartIndex + ideaIndex + 1}: ${errors.join('; ')}`);
  });

  return { valid, invalidReasons };
}

function appendBriefInvalidReasonsWhenRelevant(
  validation: { invalidReasons: string[] },
  briefOutput: { items: Record<string, unknown>[]; invalidReasons: string[] },
  looseIdeas: Record<string, unknown>[]
) {
  // Full-idea-from-hook may validly arrive as a flat idea array/readable text.
  // In that case the nested pillar->angles parser will complain, but the loose
  // full-idea parser is the correct source and those schema warnings are noise.
  const actionableReasons = briefOutput.invalidReasons.filter(reason => !isFullIdeaSchemaNoise(reason));
  if ((briefOutput.items.length > 0 || looseIdeas.length === 0) && actionableReasons.length > 0) {
    validation.invalidReasons.unshift(...actionableReasons);
  }
}

function isFullIdeaSchemaNoise(reason: string): boolean {
  return /(?:pillar\s+\d+\s*:\s*)?angles?\s+array\s+is\s+required|pillar\s+\d+\s*:\s*angles?/i.test(reason);
}

function cleanWarningReasonsForUser(reasons: string[]) {
  return reasons.filter(reason => !isFullIdeaSchemaNoise(reason));
}

function selectFullIdeaCandidates(
  briefItems: Record<string, unknown>[],
  looseIdeas: Record<string, unknown>[]
) {
  // For Hook Library full ideas, AI often returns flat arrays or readable script
  // cards. Prefer that source to avoid nested pillar/angle parser noise.
  return looseIdeas.length > 0 ? looseIdeas : briefItems;
}

function buildFullIdeasFromHookOutputSpec(options: { quantity: number; duration: string; appName: string; language: string; scriptStartIndex?: number }) {
  const scriptStartIndex = Math.max(1, Math.floor(options.scriptStartIndex || 1));
  const scriptEndIndex = scriptStartIndex + options.quantity - 1;
  const titleSequence = Array.from({ length: options.quantity }, (_item, index) => `"Script 1.${scriptStartIndex + index}"`).join(', ');
  return `## OUTPUT SPECIFICATION - HOOK LIBRARY FULL IDEAS

Return a JSON array ONLY. No markdown fences. No preamble. No explanation.
Return exactly ${options.quantity} objects. Do NOT wrap inside pillar/angles.
COUNT CONTRACT: the top-level array length must be ${options.quantity}. Return one complete object for each requested title slot: ${titleSequence}. Do not return only one detailed object.
For this request, title numbering must start at Script 1.${scriptStartIndex} and end at Script 1.${scriptEndIndex}.

Each object must use this exact flat schema:
[
  {
    "title": "Script 1.${scriptStartIndex}: short scenario name",
    "duration": "${options.duration}",
    "creativeType": "UGC|POV|Screen Recording|Motion Graphic|3D",
    "framework": {
      "coreUser": "target user from winning hook",
      "painpoint": "specific situation from winning hook",
      "emotion": "Hook emotion -> Body emotion -> CTA emotion",
      "psp": "product selling point / app action"
    },
    "meta": {
      "hookPrimary": "main hook text overlay",
      "hookAlt1": "alternative hook 1",
      "hookAlt2": "alternative hook 2",
      "angleType": "Fact|POV|Comparison|Demo|Trend|Social|Curiosity|Relief|Tutorial|Challenge|Fear",
      "bodyMotivationPattern": "Reveal|Demo-Story|Escalate|Compare|Transform",
      "ctaFrictionReducer": "Free|No signup|30 seconds|1 tap",
      "visualRefNotes": "camera, lighting, talent direction, pacing",
      "talentProfile": "talent profile or No talent - screen recording only",
      "dontDo": "one concrete QC restriction",
      "track": "A|B|C",
      "priority": "A|B|C"
    },
    "hook": {
      "durationSeconds": 5,
      "visual": "Hook timing format. Example: 0-2.5s: ...\\n2.5-5s: Text hien: ... | Voiceover: ... | curiosity gap. Max 2 scenes/camera angles for 5s.",
      "textOverlay": "short on-screen hook",
      "characterSpeech": "on-camera speech if visible talent talks, otherwise empty",
      "voiceover": "off-camera voice/video voice",
      "voice": "same as voiceover if no characterSpeech",
      "script": "same hook timing text"
    },
    "body": {
      "visual": "Diễn biến (Body): production-ready body scene with tension and app proof",
      "textOverlay": "body support text",
      "characterSpeech": "",
      "voiceover": "body voiceover line",
      "voice": "body voiceover line",
      "script": "body scene + voice + text"
    },
    "cta": {
      "visual": "CTA visual with app/download/action visible",
      "textOverlay": "CTA text",
      "characterSpeech": "",
      "voiceover": "CTA voice line",
      "voice": "CTA voice line",
      "endCard": "Kêu gọi hành động (CTA): exact CTA",
      "script": "CTA visual + voice + end card"
    },
    "explanation": "why this will work"
  }
]

Rules:
- Use plain English title prefixes: "Script 1.1:", "Script 1.2:", "Script 1.3:" and so on. Do not copy schema example text.
- User-facing copy fields must be in ${options.language}: title, hook text, speech, voiceover, CTA.
- Visual descriptions and production notes must also be in ${options.language}.
- Every idea must have hook, body, CTA. Do not return hook-only objects.
- Map the global V2.1 scene rules into this flat schema: visual_scene_1 = hook.visual, visual_scene_2 = body.visual, visual_scene_3 = cta.visual.
- Apply Rule 4 pacing strictly: 1 scene/camera angle must last at least 2.5 seconds.
- For 5-second hooks/videos, hook.visual uses max 2 timing rows/camera angles, normally 0-2.5s and 2.5-5s. Never use 3+ rows or 3+ actions/cuts in 5s.
- For 8-10 second hooks/videos, use max 3-4 scenes/camera angles, each around 2.5-3s. Use split-screen or complex transitions only when each pane/beat has about 3 seconds.
- hook.visual, body.visual, and cta.visual must each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- For Health/Fitness: no diagnose, treat, cure, detect disease, replace doctor, medical result claims. Use track, monitor, check, reference, wellness.
- Do not use before/after body or health outcome framing.
- Do not output generic placeholders. Make each idea visually different.`;
}

function buildSingleFullIdeaFromHookOutputSpec(options: { duration: string; appName: string; language: string; scriptIndex: number }) {
  return `Return JSON only: a top-level array with exactly 1 object for "Script 1.${options.scriptIndex}".
No markdown fences. No preamble. No nested pillar/angles.

Required shape:
[
  {
    "title": "Script 1.${options.scriptIndex}: short scenario name",
    "duration": "${options.duration}",
    "creativeType": "UGC|POV|Screen Recording|Motion Graphic|3D",
    "framework": { "coreUser": "", "painpoint": "", "emotion": "", "psp": "" },
    "meta": {
      "hookPrimary": "",
      "hookAlt1": "",
      "hookAlt2": "",
      "angleType": "Curiosity",
      "bodyMotivationPattern": "Reveal|Demo-Story|Escalate|Compare|Transform",
      "ctaFrictionReducer": "Free|No signup|30 seconds|1 tap",
      "visualRefNotes": "",
      "talentProfile": "",
      "dontDo": "",
      "track": "B",
      "priority": "A"
    },
    "hook": {
      "durationSeconds": 5,
      "visual": "0-2.5s: ...\\n2.5-5s: Text appears: ... | Voiceover: ... | curiosity gap",
      "textOverlay": "",
      "characterSpeech": "",
      "voiceover": "",
      "voice": "",
      "script": ""
    },
    "body": { "visual": "", "textOverlay": "", "characterSpeech": "", "voiceover": "", "voice": "", "script": "" },
    "cta": { "visual": "", "textOverlay": "", "characterSpeech": "", "voiceover": "", "voice": "", "endCard": "", "script": "" },
    "explanation": ""
  }
]

Rules:
- Every generated text field must be in ${options.language}, including title, visual notes, production notes, hook text, speech, voiceover, CTA, and endCard.
- Every idea must include non-empty hook.visual, hook voice/text, body.visual, body voice/text, cta.visual, cta voice/text, and cta.endCard.
- Apply Rule 4 pacing strictly: 5s hooks/videos max 2 scenes/camera angles; 8-10s hooks/videos max 3-4 scenes/camera angles; each scene/camera angle must last at least 2.5 seconds.
- hook.visual, body.visual, and cta.visual must each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- Keep it tied to ${options.appName}; no generic placeholders.
- For Health/Fitness: no diagnose, treat, cure, detect disease, replace doctor, or medical-result promise. Use track, monitor, check, reference, wellness.`;
}

function buildIdeaFingerprint(item: Record<string, unknown>) {
  const meta = asRecord(item.meta);
  const hook = asRecord(item.hook);
  const body = asRecord(item.body);
  const cta = asRecord(item.cta);

  return [
    asText(meta.hookPrimary),
    asText(hook.characterSpeech),
    asText(hook.voiceover),
    asText(hook.voice),
    asText(hook.textOverlay) || asText(hook.text),
    asText(hook.visual) || asText(hook.script),
    asText(body.visual) || asText(body.script),
    asText(body.characterSpeech),
    asText(body.voiceover),
    asText(body.voice),
    asText(cta.characterSpeech),
    asText(cta.voiceover),
    asText(cta.voice),
    asText(cta.textOverlay) || asText(cta.text),
  ]
    .filter(Boolean)
    .join('\n');
}

function ideaHookLine(idea: Record<string, unknown>): string {
  const meta = asRecord(idea.meta);
  const hook = asRecord(idea.hook);
  return asText(meta.hookPrimary) || asText(hook.textOverlay) || asText(hook.voiceover) || asText(hook.voice);
}

function hasSameHookFrame(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const left = ideaHookLine(a);
  const right = ideaHookLine(b);
  if (!left || !right) return false;
  const normalizedLeft = normalizeCompareText(left);
  const normalizedRight = normalizeCompareText(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight) || jaccardSimilarity(left, right) >= 0.72;
}

function dedupeIdeas(
  candidates: Record<string, unknown>[],
  existing: Record<string, unknown>[]
) {
  const unique: Record<string, unknown>[] = [];

  for (const candidate of candidates) {
    const candidateFingerprint = buildIdeaFingerprint(candidate);
    const isUnique = [...existing, ...unique].every(item => (
      jaccardSimilarity(candidateFingerprint, buildIdeaFingerprint(item)) < 0.82
    )) && ![...existing, ...unique].some(item => hasSameHookFrame(candidate, item));

    if (isUnique) unique.push(candidate);
  }

  return unique;
}

function selectUsableUniqueIdeas(
  candidates: Record<string, unknown>[],
  existing: Record<string, unknown>[],
  quantity: number
) {
  const unique = dedupeIdeas(candidates, existing).slice(0, quantity);
  if (unique.length >= quantity) return unique;

  const uniqueSet = new Set(unique);
  const topUp = candidates.filter(candidate => !uniqueSet.has(candidate));
  return [...unique, ...topUp].slice(0, quantity);
}

function buildFallbackIdeasFromHook(
  hook: Record<string, unknown>,
  options: { quantity: number; startIndex?: number; duration: string; appName: string; ideaDirection?: string | null }
) {
  const title = asText(hook.title) || 'Winning Hook';
  const baseTitle = title.replace(/\s*-\s*Biến thể\s*\d+\s*$/i, '').trim() || title;
  const painpoint = asText(hook.painpoint) || 'the user blocker';
  const coreUser = asText(hook.core_user) || 'General viewer';
  const emotion = asText(hook.emotion) || 'Curiosity';
  const psp = asText(hook.hook_concept) || asText(hook.description) || options.appName;
  const visualBase = asText(hook.visual_detail) || 'A social-first handheld setup that shows the problem clearly.';
  const directionHint = asText(options.ideaDirection) || psp;
  const patterns = [
    {
      creativeType: 'UGC',
      hookPrimary: 'Why this move matters',
      hookAlt1: 'Still missing this detail?',
      hookAlt2: 'The clue is here',
      hookVoice: `Wait, why does this simple move expose ${painpoint}?`,
      bodyVoice: `The reveal lands faster when the blocker is visible before the explanation starts.`,
      ctaVoice: `Open ${options.appName} and test this angle before you lock the creative.`,
      bodyOverlay: 'See the clue faster',
      ctaOverlay: `Try ${options.appName} now`,
      angle: 'Desk setup macro reveal',
    },
    {
      creativeType: 'POV',
      hookPrimary: 'The detail people miss',
      hookAlt1: 'Most viewers miss this',
      hookAlt2: 'Look closer here',
      hookVoice: 'Most people miss this detail in the first second.',
      bodyVoice: 'Use a tighter POV to make the pain point and solution click faster.',
      ctaVoice: `Build one more POV version inside ${options.appName}.`,
      bodyOverlay: 'Show the blocker early',
      ctaOverlay: 'Build another version',
      angle: 'Tighter POV reveal',
    },
    {
      creativeType: 'Social Proof',
      hookPrimary: 'Same pain, new angle',
      hookAlt1: 'This compare changes it',
      hookAlt2: 'Spot the real trigger',
      hookVoice: 'Same pain point, but this compare makes it click instantly.',
      bodyVoice: 'Frame the old friction and the fix in one contrast so the payoff is obvious.',
      ctaVoice: `Turn this winning DNA into a fresh test in ${options.appName}.`,
      bodyOverlay: 'Make the contrast obvious',
      ctaOverlay: `Test in ${options.appName}`,
      angle: 'Compare-frame social proof',
    },
    {
      creativeType: 'Reaction',
      hookPrimary: 'You notice it late',
      hookAlt1: 'This lands too late',
      hookAlt2: 'Watch the miss happen',
      hookVoice: 'You only notice the blocker when it is already too late.',
      bodyVoice: 'Use a reaction beat to show the pain landing, then pivot into the product fix immediately.',
      ctaVoice: `Use ${options.appName} to spin a reaction-led variant next.`,
      bodyOverlay: 'Show the reaction beat',
      ctaOverlay: `Try reaction format`,
      angle: 'Reaction-led reveal',
    },
    {
      creativeType: 'Challenge',
      hookPrimary: 'Try spotting this',
      hookAlt1: 'Can you catch it?',
      hookAlt2: 'Most people fail this',
      hookVoice: 'Try spotting the blocker before the reveal lands.',
      bodyVoice: 'Turn the same friction into a quick challenge so the viewer stays to see the answer.',
      ctaVoice: `Build a challenge version in ${options.appName} and test it against the control.`,
      bodyOverlay: 'Make it a challenge',
      ctaOverlay: `Test challenge hook`,
      angle: 'Challenge-style stopper',
    },
  ];

  return Array.from({ length: options.quantity }, (_, index) => {
    const pattern = patterns[((options.startIndex || 0) + index) % patterns.length];
    const displayIndex = (options.startIndex || 0) + index;
    return {
      id: `P0-A0-I${displayIndex}`,
      title: `${baseTitle} - Full Idea ${displayIndex + 1}`,
      duration: options.duration,
      creativeType: pattern.creativeType,
      meta: {
        builderVersion: 'hook_library_full_idea_api_fallback_v1',
        pillar: painpoint,
        pillarIndex: 0,
        angleName: `Winning Hook: ${title}`,
        angleType: 'Curiosity',
        angleDesc: pattern.angle,
        hookPrimary: pattern.hookPrimary,
        hookAlt1: pattern.hookAlt1,
        hookAlt2: pattern.hookAlt2,
        visualRefNotes: visualBase,
        talentProfile: coreUser,
        dontDo: 'Do not let body and CTA drift away from the opening pain point.',
        track: 'B',
        priority: 'A',
      },
      framework: {
        coreUser,
        painpoint,
        emotion,
        psp,
      },
      explanation: `Expand the winning hook into a full brief that keeps the pain point "${painpoint}" and pushes direction "${directionHint}".`,
      hook: {
        durationSeconds: estimateHookDurationSeconds({
          visual: `${visualBase} Reframe the opening around ${pattern.angle} so "${directionHint}" is visible immediately in the first action.`,
          voice: pattern.hookVoice,
          textOverlay: pattern.hookPrimary,
        }),
        visual: `${visualBase} Reframe the opening around ${pattern.angle} so "${directionHint}" is visible immediately in the first action.`,
        voice: pattern.hookVoice,
        textOverlay: pattern.hookPrimary,
        viTranslation: `Giữ đúng nỗi đau "${painpoint}" nhưng mở theo hướng "${directionHint}" để người xem dừng lại ngay giây đầu.`,
        viewerProfile: `Người xem giống ${coreUser} và nhận ra đúng bối cảnh của họ.`,
        viewerEmotion: `Người xem thấy ${emotion.toLowerCase()} ngay khi blocker lộ ra.`,
        painpointImpact: `Pain point "${painpoint}" trở nên cụ thể vì blocker xuất hiện ngay khung đầu.`,
        whyTheyStopScrolling: `Khung đầu cho thấy pain point "${painpoint}" theo góc "${pattern.angle}" nên người xem dừng lại để hiểu tiếp.`,
      },
      body: {
        visual: `Push into a closer demo of the same problem, then show how ${psp} changes the situation in a way that is easy to copy for production.`,
        voice: pattern.bodyVoice,
        textOverlay: pattern.bodyOverlay,
        viTranslation: `Cho thấy ${psp} xử lý tình huống này như thế nào theo cách dễ quay và dễ hiểu.`,
      },
      cta: {
        visual: 'End on the app screen with the key action ready to tap and the result visible enough for one clean CTA beat.',
        voice: pattern.ctaVoice,
        textOverlay: pattern.ctaOverlay,
        viTranslation: `Kêu gọi người xem mở app và test biến thể này ngay.`,
        endCard: `${options.appName} - ${psp}`,
      },
    };
  });
}

function normalizeFallbackIdeasFromHook(
  hook: Record<string, unknown>,
  options: { quantity: number; startIndex?: number; duration: string; appName: string; ideaDirection?: string | null }
) {
  return buildFallbackIdeasFromHook(hook, options).map(item =>
    normalizeIdeaOutput(item, {
      duration: options.duration,
      appName: options.appName,
      pillar: asText(hook.painpoint) || 'General user friction',
    })
  );
}

function isJunkOutputText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length <= 1 || /^[\[\]{}'",:]+$/.test(trimmed);
}

function describeParsedShape(value: unknown): string {
  if (Array.isArray(value)) {
    const firstRecord = asRecord(value[0]);
    return `array(${value.length}) firstKeys=${Object.keys(firstRecord).slice(0, 8).join(',') || 'none'}`;
  }

  const record = asRecord(value);
  if (Object.keys(record).length > 0) {
    return `object keys=${Object.keys(record).slice(0, 10).join(',')}`;
  }

  return value === null ? 'null' : typeof value;
}

function previewOutputText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function readFirstAvailableText(...values: unknown[]) {
  for (const value of values) {
    const text = asText(value);
    if (text && !isJunkOutputText(text)) return text;
  }
  return '';
}

function cleanFullIdeaTitle(value: unknown, fallback: string) {
  const text = asText(value);
  if (!text) return fallback;
  const normalized = normalizeCompareText(text);
  const looksLikeFieldLine = /^(?:voice|voiceover|textoverlay|script|visual|hook|body|cta|endcard)\b/.test(normalized);
  const isTooLong = countWords(text) > 14;
  const hasJsonNoise = /[`{}"]\s*:/.test(text);
  return looksLikeFieldLine || isTooLong || hasJsonNoise ? fallback : text;
}

function readLooseRecordText(record: Record<string, unknown>, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = record[key];
    const text = asText(value);
    if (text) return text;
  }
  return fallback;
}

function collectLooseFullIdeaRecords(input: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];

  const walk = (value: unknown, depth = 0) => {
    if (depth > 5) return;

    if (Array.isArray(value)) {
      value.forEach(item => walk(item, depth + 1));
      return;
    }

    const record = asRecord(value);
    if (Object.keys(record).length === 0) return;

    [
      'angles',
      'ideas',
      'items',
      'data',
      'scripts',
      'fullIdeas',
      'full_ideas',
      'results',
      'output',
    ].forEach(key => {
      const nested = record[key];
      if (Array.isArray(nested)) nested.forEach(item => walk(item, depth + 1));
      else if (nested && typeof nested === 'object') walk(nested, depth + 1);
    });

    const hook = asRecord(record.hook);
    const body = asRecord(record.body);
    const cta = asRecord(record.cta);
    const hasIdeaSignal = Object.keys(hook).length > 0
      || Object.keys(body).length > 0
      || Object.keys(cta).length > 0
      || Boolean(readLooseRecordText(record, [
        'hook_text_overlay',
        'hookTextOverlay',
        'hook_primary',
        'hookPrimary',
        'visual_scene_1',
        'visualScene1',
        'script_vo',
        'scriptVo',
        'cta_text',
        'ctaText',
      ]));

    if (hasIdeaSignal) records.push(record);
  };

  walk(input);

  const seen = new Set<string>();
  return records.filter(record => {
    const key = JSON.stringify(record).slice(0, 500);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseReadableFullIdeasText(text: string): Record<string, unknown>[] {
  const normalized = normalizeCompareText(text);
  if (!/\b(?:hook|body|cta|dien bien|keu goi|kich ban|script|idea)\b/.test(normalized)) return [];

  const scriptChunkPattern = /(?=(?:^|\n)\s*(?:#{1,4}\s*)?(?:Kịch bản|Kich ban|Script|Idea)\s*\d+(?:\.\d+)?[:.)\-\s])/i;
  if (/^[\[{]/.test(text.trim()) && !scriptChunkPattern.test(text)) return [];

  const chunks = text
    .split(scriptChunkPattern)
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.length > 80);

  const sourceChunks = chunks.length > 0 ? chunks : [text.trim()];

  return sourceChunks.map((chunk, index) => {
    const lines = chunk.split('\n').map(line => line.trim()).filter(Boolean);
    const title = (lines[0] || `Full Idea ${index + 1}`)
      .replace(/^#+\s*/, '')
      .replace(/^(?:Kịch bản|Kich ban|Script|Idea)\s*\d+(?:\.\d+)?[:.)\-\s]*/i, '')
      .trim() || `Full Idea ${index + 1}`;

    const hookMatch = chunk.match(/Hook[\s\S]*?(?=(?:\n\s*(?:Diễn biến|Dien bien|Body|Voiceover chính|Voiceover chinh|CTA|Kêu gọi|Keu goi)\b)|$)/i);
    const bodyMatch = chunk.match(/(?:Diễn biến|Dien bien|Body)[\s\S]*?(?=(?:\n\s*(?:Voiceover chính|Voiceover chinh|CTA|Kêu gọi|Keu goi)\b)|$)/i);
    const voiceMatch = chunk.match(/(?:Voiceover chính|Voiceover chinh)\s*:\s*["“]?([\s\S]*?)(?=(?:\n\s*(?:CTA|Kêu gọi|Keu goi)\b)|$)/i);
    const ctaMatch = chunk.match(/(?:CTA|Kêu gọi hành động|Keu goi hanh dong|Kêu gọi|Keu goi)[\s\S]*$/i);
    const hookText = hookMatch?.[0]?.trim() || lines.slice(1, 5).join(' ');
    const bodyText = bodyMatch?.[0]?.trim() || lines.slice(5, 9).join(' ');
    const ctaText = ctaMatch?.[0]?.replace(/^(?:CTA|Kêu gọi hành động|Keu goi hanh dong|Kêu gọi|Keu goi)\s*:\s*/i, '').trim() || 'Try it now';

    return {
      title,
      hook: {
        visual: hookText,
        textOverlay: title,
        voiceover: '',
        voice: '',
      },
      body: {
        visual: bodyText || hookText,
        voiceover: voiceMatch?.[1]?.trim() || bodyText,
        voice: voiceMatch?.[1]?.trim() || bodyText,
        textOverlay: 'See the idea',
      },
      cta: {
        visual: ctaText,
        voiceover: ctaText,
        voice: ctaText,
        textOverlay: ctaText,
        endCard: ctaText,
      },
    };
  }).filter(record => {
    const hook = asRecord(record.hook);
    const body = asRecord(record.body);
    return asText(hook.visual).length > 20 && asText(body.visual).length > 20;
  });
}

function parseGeminiJsonLikeFullIdeasText(text: string): Record<string, unknown>[] {
  const clean = text.replace(/```json\s*|```/gi, '').trim();
  if (!/"title"\s*:/.test(clean)) return [];

  const decode = (value: string) => value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .trim();
  const readString = (source: string, key: string) => {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i');
    const match = source.match(pattern);
    return match ? decode(match[1]) : '';
  };
  const readSafeString = (source: string, key: string) => {
    const value = readString(source, key);
    return looksLikeRawFullIdeaPayload(value) ? '' : value;
  };
  const readSection = (source: string, sectionKey: string) => {
    const startMatch = new RegExp(`"${sectionKey}"\\s*:\\s*\\{`, 'i').exec(source);
    if (!startMatch) return '';

    let depth = 0;
    let inString = false;
    let escaped = false;
    const start = startMatch.index + startMatch[0].lastIndexOf('{');

    for (let index = start; index < source.length; index++) {
      const char = source[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
      }
    }

    return source.slice(start);
  };

  return clean
    .split(/(?=\{\s*"title"\s*:)/g)
    .map(chunk => chunk.replace(/^\s*\[\s*/, '').replace(/\]\s*$/, '').trim())
    .filter(chunk => chunk.length > 80)
    .map((chunk, index) => {
      const hook = readSection(chunk, 'hook');
      const body = readSection(chunk, 'body');
      const cta = readSection(chunk, 'cta');
      const framework = readSection(chunk, 'framework');
      const meta = readSection(chunk, 'meta');
      const fallbackTitle = `Script 1.${index + 1}`;
      const title = readSafeString(chunk, 'title') || fallbackTitle;
      const hookPrimary = readSafeString(meta, 'hookPrimary') || readSafeString(hook, 'textOverlay') || title;
      const ctaText = readSafeString(cta, 'textOverlay') || readSafeString(cta, 'voiceover') || readSafeString(cta, 'endCard') || hookPrimary || title || 'Try it now';
      const localizedFallbackSeed = hookPrimary || title;
      const fallbackHookVisual = localizedFallbackSeed || `Open on a concrete first-frame problem tied to the selected hook.`;
      const fallbackBodyVisual = localizedFallbackSeed || `Continue the same tension and show the next app/demo action clearly.`;
      const fallbackBodyVoice = hookPrimary || title || 'See the check-in';
      const fallbackCtaVisual = ctaText || localizedFallbackSeed || `End on the app or result screen with the next action visible.`;

      return {
        title,
        duration: readSafeString(chunk, 'duration'),
        creativeType: readSafeString(chunk, 'creativeType') || readSafeString(chunk, 'creative_type'),
        framework: {
          coreUser: readSafeString(framework, 'coreUser'),
          painpoint: readSafeString(framework, 'painpoint'),
          emotion: readSafeString(framework, 'emotion'),
          psp: readSafeString(framework, 'psp'),
        },
        meta: {
          hookPrimary,
          hookAlt1: readSafeString(meta, 'hookAlt1'),
          hookAlt2: readSafeString(meta, 'hookAlt2'),
          angleType: readSafeString(meta, 'angleType'),
          bodyMotivationPattern: readSafeString(meta, 'bodyMotivationPattern'),
          ctaFrictionReducer: readSafeString(meta, 'ctaFrictionReducer'),
          visualRefNotes: readSafeString(meta, 'visualRefNotes'),
          talentProfile: readSafeString(meta, 'talentProfile'),
          dontDo: readSafeString(meta, 'dontDo'),
          track: readSafeString(meta, 'track'),
          priority: readSafeString(meta, 'priority'),
        },
        hook: {
          visual: readSafeString(hook, 'visual') || readSafeString(hook, 'script') || fallbackHookVisual,
          textOverlay: readSafeString(hook, 'textOverlay') || hookPrimary,
          characterSpeech: readSafeString(hook, 'characterSpeech'),
          voiceover: readSafeString(hook, 'voiceover') || readSafeString(hook, 'voice') || hookPrimary,
          voice: readSafeString(hook, 'voice') || readSafeString(hook, 'voiceover') || hookPrimary,
          script: readSafeString(hook, 'script') || readSafeString(hook, 'visual') || fallbackHookVisual,
        },
        body: {
          visual: readSafeString(body, 'visual') || readSafeString(body, 'script') || fallbackBodyVisual,
          textOverlay: readSafeString(body, 'textOverlay') || readSafeString(body, 'voiceover') || 'See the check-in',
          characterSpeech: readSafeString(body, 'characterSpeech'),
          voiceover: readSafeString(body, 'voiceover') || readSafeString(body, 'voice') || fallbackBodyVoice,
          voice: readSafeString(body, 'voice') || readSafeString(body, 'voiceover') || fallbackBodyVoice,
          script: readSafeString(body, 'script') || readSafeString(body, 'visual') || fallbackBodyVisual,
        },
        cta: {
          visual: readSafeString(cta, 'visual') || readSafeString(cta, 'script') || fallbackCtaVisual,
          textOverlay: ctaText,
          characterSpeech: readSafeString(cta, 'characterSpeech'),
          voiceover: readSafeString(cta, 'voiceover') || readSafeString(cta, 'voice') || ctaText,
          voice: readSafeString(cta, 'voice') || readSafeString(cta, 'voiceover') || ctaText,
          endCard: readSafeString(cta, 'endCard') || ctaText,
          script: readSafeString(cta, 'script') || readSafeString(cta, 'visual') || fallbackCtaVisual,
        },
        explanation: readSafeString(chunk, 'explanation'),
      };
    })
    .filter(record => {
      const hook = asRecord(record.hook);
      const body = asRecord(record.body);
      const cta = asRecord(record.cta);
      return Boolean(asText(record.title) && (asText(hook.visual) || asText(hook.textOverlay)) && (asText(body.visual) || asText(body.voiceover)) && (asText(cta.visual) || asText(cta.textOverlay)));
    });
}

function enrichFullIdeaFromHook(
  rawIdea: Record<string, unknown>,
  hook: Record<string, unknown>,
  options: {
    duration: string;
    appName: string;
    appCategory: string;
    ideaDirection?: string | null;
    batchStartIndex: number;
    localIndex: number;
  }
) {
  const hookSection = asRecord(rawIdea.hook);
  const bodySection = asRecord(rawIdea.body);
  const ctaSection = asRecord(rawIdea.cta);
  const meta = asRecord(rawIdea.meta);
  const framework = asRecord(rawIdea.framework);
  const hookTitle = asText(hook.title) || 'Winning Hook';
  const hookPainpoint = asText(hook.painpoint) || asText(framework.painpoint) || 'General user friction';
  const hookCoreUser = asText(hook.core_user) || asText(framework.coreUser) || 'General viewer';
  const hookEmotion = asText(hook.emotion) || asText(framework.emotion) || 'Curiosity';
  const hookPsp = asText(hook.hook_concept) || asText(hook.description) || asText(framework.psp) || options.appName;
  const visualBase = asText(hook.visual_detail) || 'A social-first shot that makes the winning hook tension clear.';
  const directionHint = asText(options.ideaDirection) || hookPsp;
  const ideaIndex = options.batchStartIndex + options.localIndex;
  const hookPrimary = readFirstAvailableText(
    meta.hookPrimary,
    rawIdea.hook_text_overlay,
    rawIdea.hookTextOverlay,
    rawIdea.hook_primary,
    rawIdea.hookPrimary,
    hookSection.textOverlay,
    hookSection.text,
    hookSection.voiceover,
    hookSection.voice,
    rawIdea.title,
    hookTitle
  );
  const hookVoice = readFirstAvailableText(
    rawIdea.hook_vo,
    rawIdea.hookVoiceover,
    rawIdea.hook_voiceover,
    hookSection.voiceover,
    hookSection.voice,
    hookSection.characterSpeech,
    hookPrimary
  );
  const ctaText = readFirstAvailableText(
    rawIdea.cta_text,
    rawIdea.ctaText,
    ctaSection.textOverlay,
    ctaSection.text,
    ctaSection.voiceover,
    ctaSection.voice,
    `Try ${options.appName}`
  );
  const visualScene1 = readFirstAvailableText(
    rawIdea.visual_scene_1,
    rawIdea.visualScene1,
    hookSection.visual,
    hookSection.script,
    `${visualBase} Reopen the winning hook with a fresh situation tied to "${directionHint}".`
  );
  const visualScene2 = readFirstAvailableText(
    rawIdea.visual_scene_2,
    rawIdea.visualScene2,
    bodySection.visual,
    bodySection.script,
    `Continue the same tension, then show ${hookPsp} as the simple next action.`
  );
  const visualScene3 = readFirstAvailableText(
    rawIdea.visual_scene_3,
    rawIdea.visualScene3,
    ctaSection.visual,
    ctaSection.script,
    `End on ${options.appName} with the action and result visible.`
  );
  const rawCleanTitle = cleanFullIdeaTitle(rawIdea.title, '');
  const sourceTitleSignal = normalizeCompareText(hookTitle);
  const rawTitleSignal = normalizeCompareText(rawCleanTitle);
  const compactHookPrimary = hookPrimary.replace(/\s+/g, ' ').split(' ').slice(0, 10).join(' ');
  const localizedHookTitle = cleanFullIdeaTitle(hookPrimary, compactHookPrimary);
  const shouldUseHookPrimaryTitle = Boolean(
    rawCleanTitle
    && sourceTitleSignal
    && rawTitleSignal.includes(sourceTitleSignal)
  );
  const outputTitle = shouldUseHookPrimaryTitle
    ? (localizedHookTitle || compactHookPrimary || rawCleanTitle)
    : (rawCleanTitle || localizedHookTitle || `Script 1.${ideaIndex + 1}: ${hookTitle}`);

  return normalizeIdeaOutput({
    ...rawIdea,
    id: `P0-A0-I${ideaIndex}`,
    title: outputTitle,
    duration: readFirstAvailableText(rawIdea.duration, options.duration),
    creativeType: readFirstAvailableText(rawIdea.creativeType, rawIdea.creative_type, hook.creative_type, hook.subtitle, 'UGC'),
    meta: {
      ...meta,
      builderVersion: readFirstAvailableText(meta.builderVersion, 'hook_library_full_idea_ai_lenient_v1'),
      pillar: readFirstAvailableText(meta.pillar, hookPainpoint),
      pillarIndex: Number(meta.pillarIndex ?? 0) || 0,
      angleName: readFirstAvailableText(meta.angleName, `Winning Hook: ${hookTitle}`),
      angleType: readFirstAvailableText(meta.angleType, 'Curiosity'),
      angleDesc: readFirstAvailableText(meta.angleDesc, asText(options.ideaDirection), asText(hook.description), hookTitle),
      hookPrimary,
      hookAlt1: readFirstAvailableText(meta.hookAlt1, rawIdea.hook_alt_1_text, `${hookPrimary} - angle B`),
      hookAlt2: readFirstAvailableText(meta.hookAlt2, rawIdea.hook_alt_2_text, `${hookPrimary} - angle C`),
      visualRefNotes: readFirstAvailableText(meta.visualRefNotes, visualBase),
      talentProfile: readFirstAvailableText(meta.talentProfile, hookCoreUser),
      dontDo: readFirstAvailableText(meta.dontDo, 'Do not drift away from the winning hook pain point.'),
      track: readFirstAvailableText(meta.track, 'B'),
      priority: readFirstAvailableText(meta.priority, 'A'),
    },
    framework: {
      coreUser: readFirstAvailableText(framework.coreUser, hookCoreUser),
      painpoint: readFirstAvailableText(framework.painpoint, hookPainpoint),
      emotion: readFirstAvailableText(framework.emotion, hookEmotion),
      psp: readFirstAvailableText(framework.psp, hookPsp),
    },
    explanation: readFirstAvailableText(rawIdea.explanation, `Expanded from winning hook "${hookTitle}" with a fresh execution.`),
    hook: {
      ...hookSection,
      durationSeconds: estimateHookDurationSeconds({
        visual: visualScene1,
        voice: hookVoice,
        textOverlay: hookPrimary,
      }),
      visual: visualScene1,
      script: readFirstAvailableText(hookSection.script, visualScene1),
      characterSpeech: readFirstAvailableText(hookSection.characterSpeech),
      voiceover: hookVoice,
      voice: hookVoice,
      textOverlay: readFirstAvailableText(hookSection.textOverlay, hookSection.text, hookPrimary),
      text: readFirstAvailableText(hookSection.text, hookSection.textOverlay, hookPrimary),
      viewerProfile: readFirstAvailableText(hookSection.viewerProfile, hookCoreUser),
      viewerEmotion: readFirstAvailableText(hookSection.viewerEmotion, hookEmotion),
      painpointImpact: readFirstAvailableText(hookSection.painpointImpact, hookPainpoint),
      whyTheyStopScrolling: readFirstAvailableText(hookSection.whyTheyStopScrolling, `The first frame reframes the proven hook tension from "${hookTitle}".`),
    },
    body: {
      ...bodySection,
      visual: visualScene2,
      script: readFirstAvailableText(bodySection.script, visualScene2),
      voiceover: readFirstAvailableText(bodySection.voiceover, bodySection.voice, `Then ${options.appName} shows the next step clearly.`),
      voice: readFirstAvailableText(bodySection.voice, bodySection.voiceover, `Then ${options.appName} shows the next step clearly.`),
      textOverlay: readFirstAvailableText(bodySection.textOverlay, bodySection.text, 'See the next step'),
      text: readFirstAvailableText(bodySection.text, bodySection.textOverlay, 'See the next step'),
    },
    cta: {
      ...ctaSection,
      visual: visualScene3,
      script: readFirstAvailableText(ctaSection.script, visualScene3),
      voiceover: readFirstAvailableText(ctaSection.voiceover, ctaSection.voice, ctaText),
      voice: readFirstAvailableText(ctaSection.voice, ctaSection.voiceover, ctaText),
      textOverlay: readFirstAvailableText(ctaSection.textOverlay, ctaSection.text, ctaText),
      text: readFirstAvailableText(ctaSection.text, ctaSection.textOverlay, ctaText),
      endCard: readFirstAvailableText(ctaSection.endCard, `${options.appName} - ${hookPsp}`),
    },
  }, {
    duration: options.duration,
    appName: options.appName,
    pillar: hookPainpoint,
  });
}

function normalizeLooseFullIdeasFromHook(
  input: unknown,
  hook: Record<string, unknown>,
  options: {
    duration: string;
    appName: string;
    appCategory: string;
    ideaDirection?: string | null;
    batchStartIndex: number;
  }
) {
  return collectLooseFullIdeaRecords(input).map((record, localIndex) =>
    enrichFullIdeaFromHook(record, hook, {
      ...options,
      localIndex,
    })
  );
}

function resolveModel(selected?: string): string {
  const map: Record<string, string> = {
    'gemini-2.5-flash': 'gemini/gemini-2.5-flash',
    'gemini-2.5-pro': 'gemini/gemini-2.5-pro',
    'gemini-3-pro': 'gemini/gemini-3-pro-preview',
    'gpt-5.4': 'openai/gpt-5.4',
    'gpt-5.4-pro': 'openai/gpt-5.4-pro-2026-03-05',
    'gpt-5.4-mini': 'openai/gpt-5.4-mini',
    'gpt-4.1': 'openai/gpt-4.1',
    'o4-mini': 'openai/o4-mini',
  };
  return map[selected || ''] || 'gemini/gemini-3-pro-preview';
}

function resolveIdeaModels(selected?: string): string[] {
  return [resolveModel(selected)];
}

export async function POST(request: NextRequest) {
  let requestBody: Record<string, unknown> = {};
  try {
    const guard = await guardApiRequest(request, { key: 'generate-ideas-from-hook', max: 60, windowMs: 5 * 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    requestBody = asRecord(await request.json());
    const rawHook = asRecord(requestBody.hook);
    const quantity = requestBody.quantity ?? 3;
    const duration = asText(requestBody.duration) || 'Short social-first runtime';
    const appName = asText(requestBody.appName) || 'App';
    const appCategory = asText(requestBody.appCategory) || 'General';
    const hook = enrichHookWithFramework(rawHook, { appName, appCategory });
    const ideaDirection = asText(requestBody.ideaDirection) || undefined;
    const appKnowledge = asText(requestBody.appKnowledge);
    const usePromptSystemBuilderHtml = appKnowledge.toLowerCase().includes(PROMPT_SYSTEM_BUILDER_HTML_MARKER.toLowerCase());
    const previousIdeas = asText(requestBody.previousIdeas);
    const selectedModel = asText(requestBody.selectedModel) || undefined;
    const requestedQty = Math.min(toPositiveInt(quantity, 3), MAX_IDEAS_PER_REQUEST);
    const targetMarketValues = [
      ...asStringList(requestBody.targetMarket),
      ...asStringList(requestBody.targetMarkets),
      ...asStringList(hook.targetMarket),
      ...asStringList(hook.targetMarkets),
      ...asStringList(hook.target_market),
    ];
    const coreUserLanguageHints = [
      ...asStringList(requestBody.coreUser),
      ...asStringList(requestBody.coreUsers),
      ...asStringList(hook.coreUser),
      ...asStringList(hook.coreUsers),
      asText(hook.core_user),
    ].filter(Boolean);
    const targetLanguage = detectTargetLanguageFromMarkets(targetMarketValues, coreUserLanguageHints) || 'English';
    const batchPlans = buildIdeaBatchPlans(requestedQty);
    const aggregatedIdeas: Record<string, unknown>[] = [];
    const warnings: string[] = [];
    const fallbackCount = 0;
    const requestStartedAt = Date.now();
    const getRemainingAiBudgetMs = () => Math.max(
      0,
      GENERATE_FROM_HOOK_REQUEST_AI_BUDGET_MS - (Date.now() - requestStartedAt)
    );
    const hasAiBudget = () => getRemainingAiBudgetMs() >= GENERATE_FROM_HOOK_MIN_CALL_TIMEOUT_MS;
    const getBudgetedTimeoutMs = (timeoutMs: number) => Math.max(
      GENERATE_FROM_HOOK_MIN_CALL_TIMEOUT_MS,
      Math.min(timeoutMs, getRemainingAiBudgetMs())
    );
    const knowledgeBlock = appKnowledge
      ? `\n## APP BRAIN\n${appKnowledge.slice(0, 2200)}${appKnowledge.length > 2200 ? '\n[...truncated]' : ''}\n`
      : '';
    const recentIdeasBlock = previousIdeas
      ? `\n## RECENT IDEA HISTORY\n${previousIdeas.slice(0, 1400)}${previousIdeas.length > 1400 ? '\n[...truncated]' : ''}\n`
      : '';

    for (const plan of batchPlans) {
      const hookPainpoint = asText(hook.painpoint) || 'General user friction';
      const hookCoreUser = asText(hook.core_user) || 'General viewer';
      const hookPsp = asText(hook.hook_concept) || asText(hook.description) || appName;
      const hookAngle = [asText(hook.title), asText(hook.description), ideaDirection].filter(Boolean).join(' | ');
      const filterConsistencyBlock = buildFilterConsistencyPromptBlock({
        solutionValues: [hookPsp],
        angleValues: [hookAngle],
        painPointValues: [hookPainpoint],
      });
      const painpointPrecisionBlock = `
## PAINPOINT PRECISION CONTRACT
- Exact core user: ${hookCoreUser}
- Exact pain point pillar: ${hookPainpoint}
- Winning hook angle/DNA: ${hookAngle || 'No locked angle'}
- Exact PSP/app action: ${hookPsp}

Hard requirements:
- Do not reduce the pain point to a broad symptom. hook_primary and visual_scene_1 must include at least 2 concrete anchors from the winning hook/pain point.
- The first 3 seconds must show the specific trigger/context that makes this user care now.
- Hook must include psp_bridge so the winning hook tension connects to the PSP before the Body/demo.
- visual_scene_2 must show the selected PSP/app action tied to the same problem. No generic app demo.
- hook.visual/body.visual/cta.visual must each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- If this is a health/wellness app, position the app as tracking/logging/understanding trends only. Never diagnose, treat, detect disease, promise prevention, or imply before/after health improvement.
- If the PSP is a health tracker, hook_primary may be human/emotional, but visual_scene_1 or hook_alt must name the actual tracked concern/metric from the selected PSP/pain point. Do not stop at a generic symptom like "dizzy", "tired", or "worried".
- Avoid search-query hooks like "Huyết áp thấp có làm tôi choáng khi đứng dậy không?" Make hook_primary feel like a lived moment, confession, or tension line.
- Better lived-moment health hook style examples to adapt into ${targetLanguage}: "I thought it was just age." / "The dizzy moment was not the scariest part." / "My morning started with one strange pause."
- If returning multiple ideas, no two hook_primary lines may use the same sentence frame.`;

      const frameworkInjection = buildFrameworkInjection({
        appName,
        category: appCategory,
        coreUsers: [hookCoreUser].filter(Boolean),
        primaryEmotion: asText(hook.emotion) || 'Curiosity',
        visualTheme: `${asText(hook.creative_type) || asText(hook.subtitle) || 'UGC'}; use the winning hook as DNA, then expand it into a full brief.`,
        psp: hookPsp,
        pillars: [hookPainpoint].filter(Boolean),
        performanceData: [
          appKnowledge ? 'App Brain memory block attached below in supporting context.' : 'No App Brain memory attached.',
          previousIdeas ? 'Recent idea history block attached below in supporting context.' : 'No recent full-idea history attached.',
          'Winning hook metadata is attached below and should be treated as the strongest source of strategic DNA.',
        ],
        anglesPerPillar: 1,
        ideasPerAngle: plan.batchQuantity,
        language: `Every generated idea field in ${targetLanguage}, including visual and production notes`,
        priority: 'A',
        extraContext: [
          'Task type: expand a proven winning hook into new full ideas.',
          'Keep the same strategic DNA, but change situation, character, setting, and opening approach enough to avoid clones.',
          `Target market/localization: ${targetMarketValues.join(', ') || 'same as the winning hook'}. Use it for setting, culture, props, behavior, and vibe only; keep every generated field in ${targetLanguage}.`,
          ideaDirection ? `User direction: ${ideaDirection}` : 'No additional user direction.',
        ],
      });
      const priorIdeasBlock = aggregatedIdeas.length > 0
        ? `\n## IDEAS ALREADY GENERATED IN THIS REQUEST\n${aggregatedIdeas.map((idea, index) => {
            const meta = (idea.meta || {}) as Record<string, unknown>;
            const hookSection = (idea.hook || {}) as Record<string, unknown>;
            return `${index + 1}. ${String(meta.hookPrimary || idea.title || 'Idea')}\n- Hook voice: ${String(hookSection.voice || '').trim()}\n- Hook text: ${String(hookSection.textOverlay || hookSection.text || '').trim()}`;
          }).join('\n')}\n- Do not repeat or lightly paraphrase these ideas.`
        : '';

      const prompt = `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

${frameworkInjection}

## SUPPORTING CONTEXT
${knowledgeBlock || '- No App Brain memory attached.'}
${recentIdeasBlock || '- No recent idea history attached.'}
${painpointPrecisionBlock}
${filterConsistencyBlock || ''}
${BULLETPROOF_VISUAL_ANCHOR_RULES}

## WINNING HOOK DNA
- Title: "${hook.title}"
- Description: ${hook.description || 'N/A'}
- Hook concept: ${hook.hook_concept || 'N/A'}
- Creative type: ${hook.creative_type || hook.subtitle || 'N/A'}
- Visual: ${hook.visual_detail || 'N/A'}
- Core user: ${hook.core_user || 'N/A'}
- Painpoint: ${hook.painpoint || 'N/A'}
- Viewer emotion target: ${hook.emotion || 'N/A'}
- Target market/localization: ${targetMarketValues.join(', ') || 'same as the winning hook'}
${priorIdeasBlock}

## TASK
Create ${plan.batchQuantity} full ideas inspired by the winning hook for batch ${Math.floor(plan.batchStartIndex / MAX_IDEAS_PER_AI_BATCH) + 1}/${batchPlans.length}.
- Keep the same strategic DNA and problem-solution logic.
- Change situation, character, setting, and opening mechanism enough that they are not shallow rewrites.
- Hook must sell through to PSP with psp_bridge; Body is only the demo/proof continuation.
- Each output must include hook, body, and CTA, but keep runtime flexible and social-first instead of forcing a fixed 15s/30s/60s bucket.
- If the user provided an idea direction, prioritize it without breaking the winning DNA.

${buildFullIdeasFromHookOutputSpec({
  quantity: plan.batchQuantity,
  duration,
  appName,
  language: targetLanguage,
  scriptStartIndex: plan.batchStartIndex + 1,
})}

${usePromptSystemBuilderHtml ? PROMPT_SYSTEM_BUILDER_RULES : CREATIVE_PROMPT_RULES}
${usePromptSystemBuilderHtml ? PROMPT_SYSTEM_BUILDER_COMPATIBILITY_GUARDRAILS : TOOL_COMPATIBILITY_GUARDRAILS}`;

      const modelCandidates = resolveIdeaModels(selectedModel).slice(0, 2);
      console.log('[generate-ideas-from-hook] Prompt length:', prompt.length, 'chars, model:', modelCandidates[0], 'batch:', plan);
      const responseTokenBudget = Math.max(2600, plan.batchQuantity * 1500);
      const useSlotRefillOnly = plan.batchQuantity > 1;
      let text: string | null = null;
      let parsed: unknown = useSlotRefillOnly ? [] : null;
      let modelUsed = modelCandidates[0];

      if (!useSlotRefillOnly) {
        for (const [candidateIndex, model] of modelCandidates.entries()) {
          if (!hasAiBudget()) break;
          const candidateText = await askAI(prompt, {
            model,
            temperature: 0.8,
            max_tokens: responseTokenBudget,
            useCreativePersona: false,
            timeoutMs: getBudgetedTimeoutMs(candidateIndex === 0 ? GENERATE_FROM_HOOK_BATCH_TIMEOUT_MS : GENERATE_FROM_HOOK_FALLBACK_TIMEOUT_MS),
          });

          if (!candidateText) continue;

          const candidateParsed = parseFullIdeaAiText(candidateText);
          if (candidateParsed !== null && (!Array.isArray(candidateParsed) || candidateParsed.length > 0)) {
            text = candidateText;
            parsed = candidateParsed;
            modelUsed = model;
            break;
          }

          console.warn('[generate-ideas-from-hook] Parse failed for model candidate:', model);
        }
      }

      if (!text && !useSlotRefillOnly) {
        console.warn('[generate-ideas-from-hook] AI returned null for batch; trying slot refill instead', plan);
        parsed = [];
      }

      if (!parsed) {
        console.warn('[generate-ideas-from-hook] Failed to parse batch; trying slot refill instead:', text?.substring(0, 300));
        parsed = [];
      }

      const looseIdeas = useSlotRefillOnly
        ? []
        : normalizeLooseFullIdeasFromHook(parsed, hook, {
            duration,
            appName,
            appCategory,
            ideaDirection,
            batchStartIndex: plan.batchStartIndex,
          });
      let briefOutput = !useSlotRefillOnly && looseIdeas.length === 0
        ? normalizeCreativeBriefOutput(parsed, {
            duration,
            appName,
            pillar: hookPainpoint,
            coreUser: hookCoreUser,
            emotion: asText(hook.emotion) || 'Create a clear viewer emotion',
            psp: hookPsp,
            angle: hookAngle,
            ideaDescription: ideaDirection,
            language: targetLanguage,
            ruleset: usePromptSystemBuilderHtml ? 'builder' : 'default',
          })
        : { items: [] as Record<string, unknown>[], invalidReasons: [] as string[] };
      let validation = normalizeAndValidateIdeas(selectFullIdeaCandidates(briefOutput.items, looseIdeas), {
        duration,
        appName,
        pillar: hookPainpoint,
        batchStartIndex: plan.batchStartIndex,
      });
      appendBriefInvalidReasonsWhenRelevant(validation, briefOutput, looseIdeas);
      let dedupedBatch = selectUsableUniqueIdeas(validation.valid, aggregatedIdeas, plan.batchQuantity);

      if (ENABLE_HOOK_FULL_IDEA_RETRY && !useSlotRefillOnly && hasAiBudget() && (validation.invalidReasons.length > 0 || dedupedBatch.length < plan.batchQuantity)) {
        const retryNotes = [
          validation.invalidReasons.length > 0
            ? `Fix these rule violations:\n- ${validation.invalidReasons.slice(0, 6).join('\n- ')}`
            : '',
          dedupedBatch.length < plan.batchQuantity
            ? `Return ${plan.batchQuantity} valid, unique ideas. Do not reuse the same opening scene or generic fallback hook.`
            : '',
        ].filter(Boolean).join('\n\n');

        const retryText = await askAI(`${prompt}

[RETRY - CREATIVE BRIEF RULES FAILED]
Regenerate the full JSON array. Follow the HOOK LIBRARY FULL IDEAS flat schema exactly.
- Do not wrap inside pillar/angles.
- meta.hookPrimary must create a clear pattern interrupt.
- meta.hookAlt1 and meta.hookAlt2 must use different rhetorical approaches.
- hook.visual/body.visual/cta.visual must be concrete and shootable, with Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- Keep voiceover concise enough for the selected runtime.
${retryNotes}`, {
          model: modelUsed,
          temperature: 0.88,
          max_tokens: responseTokenBudget,
          useCreativePersona: false,
          timeoutMs: getBudgetedTimeoutMs(GENERATE_FROM_HOOK_FALLBACK_TIMEOUT_MS),
        });

        if (retryText) {
          const retryParsed = parseFullIdeaAiText(retryText);
          const retryLooseIdeas = normalizeLooseFullIdeasFromHook(retryParsed, hook, {
            duration,
            appName,
            appCategory,
            ideaDirection,
            batchStartIndex: plan.batchStartIndex,
          });
          const retryBriefOutput = retryLooseIdeas.length === 0
            ? normalizeCreativeBriefOutput(retryParsed, {
                duration,
                appName,
                pillar: hookPainpoint,
                coreUser: hookCoreUser,
                emotion: asText(hook.emotion) || 'Create a clear viewer emotion',
                psp: hookPsp,
                angle: hookAngle,
                ideaDescription: ideaDirection,
                language: targetLanguage,
                ruleset: usePromptSystemBuilderHtml ? 'builder' : 'default',
              })
            : { items: [] as Record<string, unknown>[], invalidReasons: [] as string[] };
          const retryValidation = normalizeAndValidateIdeas(selectFullIdeaCandidates(retryBriefOutput.items, retryLooseIdeas), {
            duration,
            appName,
            pillar: hookPainpoint,
            batchStartIndex: plan.batchStartIndex,
          });
          appendBriefInvalidReasonsWhenRelevant(retryValidation, retryBriefOutput, retryLooseIdeas);
          const retryDedupedBatch = selectUsableUniqueIdeas(retryValidation.valid, aggregatedIdeas, plan.batchQuantity);

          if (
            retryDedupedBatch.length > dedupedBatch.length
            || (dedupedBatch.length === 0 && retryDedupedBatch.length > 0)
            || (retryDedupedBatch.length === dedupedBatch.length && retryValidation.invalidReasons.length < validation.invalidReasons.length)
          ) {
            briefOutput = retryBriefOutput;
            validation = retryValidation;
            dedupedBatch = retryDedupedBatch;
          }
        }
      }

      if (ENABLE_HOOK_FULL_IDEA_RETRY && !useSlotRefillOnly && hasAiBudget() && dedupedBatch.length < plan.batchQuantity) {
        const alternateModel = modelCandidates.find(model => model !== modelUsed);
        if (alternateModel) {
          const alternateText = await askAI(`${prompt}

[ALTERNATE MODEL RETRY - NEED CLEAN FULL BATCH]
Return ${plan.batchQuantity} valid, unique ideas in the exact flat JSON schema.
- Do not wrap inside pillar/angles.
- User-facing copy must be ${targetLanguage}: title, hook text, character speech, voice/video voiceover, text overlay, and CTA.
- No generic template or fallback.
- No shallow paraphrase of existing ideas.
- Hook, body, and CTA must stay tied to the winning hook context and selected pain point.`, {
            model: alternateModel,
            temperature: 0.86,
            max_tokens: responseTokenBudget,
            useCreativePersona: false,
            timeoutMs: getBudgetedTimeoutMs(GENERATE_FROM_HOOK_FALLBACK_TIMEOUT_MS),
          });

          if (alternateText) {
            const alternateParsed = parseFullIdeaAiText(alternateText);
            const alternateLooseIdeas = normalizeLooseFullIdeasFromHook(alternateParsed, hook, {
              duration,
              appName,
              appCategory,
              ideaDirection,
              batchStartIndex: plan.batchStartIndex,
            });
            const alternateBriefOutput = alternateLooseIdeas.length === 0
              ? normalizeCreativeBriefOutput(alternateParsed, {
                  duration,
                  appName,
                  pillar: hookPainpoint,
                  coreUser: hookCoreUser,
                  emotion: asText(hook.emotion) || 'Create a clear viewer emotion',
                  psp: hookPsp,
                  angle: hookAngle,
                  ideaDescription: ideaDirection,
                  language: targetLanguage,
                  ruleset: usePromptSystemBuilderHtml ? 'builder' : 'default',
                })
              : { items: [] as Record<string, unknown>[], invalidReasons: [] as string[] };
            const alternateValidation = normalizeAndValidateIdeas(selectFullIdeaCandidates(alternateBriefOutput.items, alternateLooseIdeas), {
              duration,
              appName,
              pillar: hookPainpoint,
              batchStartIndex: plan.batchStartIndex,
            });
            appendBriefInvalidReasonsWhenRelevant(alternateValidation, alternateBriefOutput, alternateLooseIdeas);
            const alternateDedupedBatch = selectUsableUniqueIdeas(alternateValidation.valid, aggregatedIdeas, plan.batchQuantity);

            if (
              alternateDedupedBatch.length > dedupedBatch.length
              || (alternateDedupedBatch.length === dedupedBatch.length && alternateValidation.invalidReasons.length < validation.invalidReasons.length)
            ) {
              briefOutput = alternateBriefOutput;
              validation = alternateValidation;
              dedupedBatch = alternateDedupedBatch;
            }
          }
        }
      }

      if (ENABLE_HOOK_FULL_IDEA_REFILL && hasAiBudget() && dedupedBatch.length < plan.batchQuantity) {
        const missingCount = plan.batchQuantity - dedupedBatch.length;
        const existingForRefill = [...aggregatedIdeas, ...dedupedBatch];
        const refillInvalidReasons: string[] = [];
        const existingIdeasText = existingForRefill.map((idea, index) => {
          const meta = asRecord(idea.meta);
          const hookSection = asRecord(idea.hook);
          return `${index + 1}. ${asText(idea.title) || asText(meta.hookPrimary) || 'Idea'} | ${asText(meta.hookPrimary) || asText(hookSection.textOverlay) || asText(hookSection.voiceover)}`;
        }).join('\n') || '- None yet.';
        const refillModelCandidates = Array.from(new Set([
          'gemini/gemini-2.5-flash',
          ...modelCandidates.filter(model => model.startsWith('gemini/')),
        ])).slice(0, 3);

        const refillTasks = Array.from({ length: missingCount }).map((_item, refillIndex) => async () => {
            const slotIndex = plan.batchStartIndex + dedupedBatch.length + refillIndex;
            const variationFocus = FULL_IDEA_VARIATION_FOCUS[slotIndex % FULL_IDEA_VARIATION_FOCUS.length];
            const refillPrompt = `You are a senior short-form performance creative strategist.
Create one production-ready full video idea from a winning hook. Return clean JSON only.

## SUPPORTING CONTEXT
${knowledgeBlock || '- No App Brain memory attached.'}
${recentIdeasBlock || '- No recent idea history attached.'}

## WINNING HOOK DNA
- Title: "${hook.title}"
- Description: ${hook.description || 'N/A'}
- Hook concept / PSP: ${hookPsp}
- Creative type: ${hook.creative_type || hook.subtitle || 'N/A'}
- Visual: ${hook.visual_detail || 'N/A'}
- Core user: ${hookCoreUser}
- Painpoint: ${hookPainpoint}
- Viewer emotion target: ${hook.emotion || 'N/A'}
- Target market/localization: ${targetMarketValues.join(', ') || 'same as the winning hook'}

## IDEAS ALREADY CREATED - DO NOT REPEAT
${existingIdeasText}

## TASK
Create exactly 1 additional full idea for slot Script 1.${slotIndex + 1}.
- Variation focus: ${variationFocus}.
- Keep the winning hook DNA, but change scene, first frame, hook line, proof object, and CTA wording.
- Stay compliant: no diagnosis, treatment, cure, disease detection, doctor replacement, or medical-result promise.
- Output a complete flat full idea with hook, body, and CTA.
${ideaDirection ? `- User direction: ${ideaDirection}` : ''}

${buildSingleFullIdeaFromHookOutputSpec({
  duration,
  appName,
  language: targetLanguage,
  scriptIndex: slotIndex + 1,
})}

${usePromptSystemBuilderHtml ? PROMPT_SYSTEM_BUILDER_COMPATIBILITY_GUARDRAILS : TOOL_COMPATIBILITY_GUARDRAILS}`;

            for (const model of refillModelCandidates) {
              if (!hasAiBudget()) {
                refillInvalidReasons.push(`Refill slot ${slotIndex + 1}: skipped because AI time budget was exhausted.`);
                return null;
              }

              const refillText = await askAI(refillPrompt, {
                model,
                temperature: 0.84,
                max_tokens: 3600,
                useCreativePersona: false,
                timeoutMs: getBudgetedTimeoutMs(GENERATE_FROM_HOOK_REFILL_TIMEOUT_MS),
              });
              if (!refillText) {
                refillInvalidReasons.push(`Refill slot ${slotIndex + 1}: ${model} returned empty.`);
                continue;
              }

              const refillParsed = parseFullIdeaAiText(refillText);
              if (refillParsed === null) {
                refillInvalidReasons.push(`Refill slot ${slotIndex + 1}: ${model} parse failed.`);
                continue;
              }

              const refillLooseIdeas = normalizeLooseFullIdeasFromHook(refillParsed, hook, {
                duration,
                appName,
                appCategory,
                ideaDirection,
                batchStartIndex: slotIndex,
              });
              const refillBriefOutput = refillLooseIdeas.length === 0
                ? normalizeCreativeBriefOutput(refillParsed, {
                    duration,
                    appName,
                    pillar: hookPainpoint,
                    coreUser: hookCoreUser,
                    emotion: asText(hook.emotion) || 'Create a clear viewer emotion',
                    psp: hookPsp,
                    angle: hookAngle,
                    ideaDescription: ideaDirection,
                    language: targetLanguage,
                    ruleset: usePromptSystemBuilderHtml ? 'builder' : 'default',
                  })
                : { items: [] as Record<string, unknown>[], invalidReasons: [] as string[] };
              const refillValidation = normalizeAndValidateIdeas(selectFullIdeaCandidates(refillBriefOutput.items, refillLooseIdeas), {
                duration,
                appName,
                pillar: hookPainpoint,
                batchStartIndex: slotIndex,
              });
              appendBriefInvalidReasonsWhenRelevant(refillValidation, refillBriefOutput, refillLooseIdeas);
              const usable = selectUsableUniqueIdeas(refillValidation.valid, existingForRefill, 1);
              if (usable.length > 0) return usable[0];
              refillInvalidReasons.push(`Refill slot ${slotIndex + 1}: ${model} invalid - ${refillValidation.invalidReasons.slice(0, 2).join(' | ') || 'no valid idea candidates'} (${describeParsedShape(refillParsed)}; preview="${previewOutputText(refillText)}").`);
            }

            return null;
        });
        const refillResults: Array<Record<string, unknown> | null> = [];
        const refillConcurrency = Math.min(GENERATE_FROM_HOOK_REFILL_CONCURRENCY, refillTasks.length);
        for (let refillStart = 0; refillStart < refillTasks.length; refillStart += refillConcurrency) {
          if (!hasAiBudget()) {
            warnings.push(`Stopped refill early after ${refillResults.length}/${missingCount} slot attempt(s) because the AI time budget was exhausted.`);
            break;
          }
          const refillChunk = refillTasks.slice(refillStart, refillStart + refillConcurrency);
          refillResults.push(...await Promise.all(refillChunk.map(task => task())));
        }

        const refillIdeas = refillResults.filter((idea): idea is Record<string, unknown> => Boolean(idea));
        const uniqueRefillIdeas = selectUsableUniqueIdeas(refillIdeas, existingForRefill, missingCount);
        dedupedBatch.push(...uniqueRefillIdeas);
        if (uniqueRefillIdeas.length < missingCount) {
          warnings.push(`Refill attempted ${missingCount} slot(s), produced ${refillIdeas.length} parsed candidate(s), accepted ${uniqueRefillIdeas.length}.`);
        }
        if (uniqueRefillIdeas.length < missingCount && refillInvalidReasons.length > 0) {
          warnings.push(...refillInvalidReasons.slice(0, 6));
        }
      }

      if (validation.invalidReasons.length > 0) {
        warnings.push(...validation.invalidReasons);
      }

      dedupedBatch = dedupedBatch.map((idea, localIndex) => repairIdeaTrackingFields(
        idea,
        {
          batchStartIndex: plan.batchStartIndex,
          ideaIndex: localIndex,
          pillar: hookPainpoint,
        }
      ));
      aggregatedIdeas.push(...dedupedBatch);

      if (dedupedBatch.length < plan.batchQuantity) {
        warnings.push(`Batch ${Math.floor(plan.batchStartIndex / MAX_IDEAS_PER_AI_BATCH) + 1}: only ${dedupedBatch.length}/${plan.batchQuantity} valid unique ideas.`);
      }
    }

    if (aggregatedIdeas.length === 0) {
      const userFacingWarnings = cleanWarningReasonsForUser(warnings);
      return NextResponse.json({
        success: false,
        error: `Chưa tạo được full idea hợp lệ nào. ${(userFacingWarnings.length > 0 ? userFacingWarnings : warnings).slice(0, 3).join(' | ')}`,
        meta: { warnings: userFacingWarnings, rawWarnings: warnings, fallbackCount },
      }, { status: 502 });
    }

    if (aggregatedIdeas.length < requestedQty) {
      warnings.push(`Partial AI result: created ${aggregatedIdeas.length}/${requestedQty} clean full ideas. Saved clean AI output only; no local fallback.`);
    }

    const userFacingWarnings = cleanWarningReasonsForUser(warnings);

    return NextResponse.json({
      success: true,
      data: aggregatedIdeas.slice(0, requestedQty),
      meta: { warnings: userFacingWarnings, rawWarnings: warnings, fallbackCount, partial: aggregatedIdeas.length < requestedQty },
    });
  } catch (err) {
    console.error('[generate-ideas-from-hook] Exception:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({
      success: false,
      error: `Generate ideas from hook failed: ${message}. Không lưu fallback ideas.`,
      meta: {
        warnings: [`Generate ideas from hook exception: ${message}.`],
        fallbackCount: 0,
      },
    }, { status: 500 });
  }
}
