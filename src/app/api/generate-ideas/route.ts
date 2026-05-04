import { NextRequest, NextResponse } from 'next/server';
import { askAI, getAIApiKey, getAIChatCompletionsUrl, getLastAIErrorMessage } from '@/lib/aiClient';
import {
  buildCreativeBriefOutputSpec,
  buildFrameworkInjection,
  buildIdeaOutputSpec,
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
  getHealthMetricPromptLabel,
  getHealthMetricsInText,
  getPrimarySolutionMetric,
  type HealthMetricKey,
} from '@/lib/filterConsistency';

export const maxDuration = 300;

function parseJson(text: string) {
  return parseJsonLoose(text);
}

function getAIGenerationErrorMessage(): string {
  return getLastAIErrorMessage() || 'AI không phản hồi';
}

function isNonRecoverableAIGenerationError(message: string): boolean {
  return /budget\s+has\s+been\s+exceeded|budget_exceeded|insufficient\s+quota|quota\s+exceeded|billing|invalid\s+api\s+key|unauthorized|forbidden/i.test(message);
}

const TRACKING_ID_PATTERN = /^P\d+-A\d+-I\d+$/;
const PATTERN_INTERRUPT_PATTERN = /(?:\?|\d|=|vs\b|still\b|without\b|stop\b|never\b|why\b|how\b|worst\b|finally\b|painful\b|awkward\b|annoying\b|sao\b|vẫn\b|đừng\b|không cần\b|thay vì|bao giờ|tệ nhất|mệt|phiền|khổ)/i;
const MEDICAL_CLAIM_PATTERN = /\b(?:diagnos(?:e|is|ing)|cure|treat(?:ment|ing)?|heal(?:ed|ing)?|detect disease|replace doctor|medical results?|clinical diagnosis|chẩn đoán|điều trị|chữa(?: khỏi)?|phát hiện bệnh|thay thế bác sĩ|kết quả y tế chính xác)\b/i;
const BEFORE_AFTER_PATTERN = /\b(?:before\s*\/\s*after|before and after|trước\s+và\s+sau|trước\s*\/\s*sau)\b/i;
const HEALTH_CONTEXT_PATTERN = /\b(?:health|doctor|disease|symptom|condition|therapy|medical|bệnh|bác sĩ|triệu chứng|sức khỏe|điều trị)\b/i;
const MAX_IDEAS_PER_AI_BATCH = 2;
const MAX_IDEAS_PER_REQUEST = 10;
const GENERATE_IDEAS_BATCH_TIMEOUT_MS = 45000;
const GENERATE_IDEAS_GEMINI3_SMALL_BATCH_TIMEOUT_MS = 45000;
const GENERATE_IDEAS_RETRY_TIMEOUT_MS = 30000;
const GENERATE_IDEAS_REQUEST_AI_BUDGET_MS = 90000;
const GENERATE_IDEAS_MIN_CALL_TIMEOUT_MS = 5000;
const MAX_IDEA_MODEL_CANDIDATES = 2;
const ENABLE_AI_RECOVERY_REFILL = false;
const ENABLE_LOCAL_FALLBACK_TOPUP = true;
const GENERATE_IDEAS_CONTEXT_CHAR_LIMIT = 1800;
const GENERATE_IDEAS_HISTORY_CHAR_LIMIT = 1600;
const CREATIVE_RULESET_V7_MARKER = 'CREATIVE_RULESET_V7_TEST';
const PROMPT_SYSTEM_BUILDER_HTML_MARKER = 'PROMPT_SYSTEM_BUILDER_HTML_V1';

const CREATIVE_ADS_GENERATION_RULES_V7 = `CREATIVE ADS GENERATION RULES (VERSION 7.0)
ROLE:
Bạn là một Performance Creative Engine. Nhiệm vụ của bạn là chuyển hóa dữ liệu đầu vào thành kịch bản quảng cáo dạng ngắn (Short-form Ads) đột phá cho App Mobile, tối ưu cho Meta Reels toàn cầu.

I. NGUYÊN TẮC TƯ DUY (CORE PHILOSOPHY)
- Brutal Directness: Bỏ qua dẫn dắt. Đi thẳng vào hậu quả hoặc giải pháp ngay giây 0.1.
- Pattern Interruption: Hình ảnh phải đủ lạ hoặc gây sốc để chặn hành vi lướt tay.
- Hyper-Localization: Tùy biến sâu dựa trên sắc tộc, môi trường sống, hành vi và văn hóa bản địa của thị trường mục tiêu.
- Execution Simplicity: Ưu tiên bối cảnh đơn giản, dễ sản xuất (UGC, Stock, Gen AI) nhưng phải mô tả hành động nhân vật cực kỳ chi tiết.

II. CẤU TRÚC KỊCH BẢN BẮT BUỘC
1. CONCEPT NAME.
2. MARKET & USER ADAPTATION: Mô tả chi tiết ngoại hình nhân vật (sắc tộc), trang phục, bối cảnh kiến trúc đặc trưng của quốc gia đó để đảm bảo tính bản địa hóa.
3. MỞ ĐẦU TRỰC DIỆN (0-3s):
- Visual: Mô tả cụ thể từng chuyển động, góc máy, trạng thái cơ thể hoặc biểu cảm khuôn mặt. Các tình huống phải rõ ràng, chi tiết. Không viết chung chung. Phải nêu rõ hành động gây sốc hoặc gây tò mò là gì.
- Text/Voice: Một câu khẳng định duy nhất. Độ "gắt" tương ứng với cảm xúc được chọn.
- Bonus: Đối với các ý tưởng về sự giao tiếp (2 hoặc nhiều nhân vật giao tiếp với nhau), cần đơn giản, không phức tạp hóa. Viết kịch bản cần bao gồm cả lời thoại phù hợp.
4. CHUYỂN TRỤC GIẢI PHÁP (3-6s):
- Visual: Mô tả kỹ thao tác tay khi dùng tính năng (đặt ngón tay vào đâu, ánh sáng phát ra thế nào) và sự thay đổi của các con số/biểu đồ trên màn hình điện thoại.
- Text/Voice: Khẳng định quyền lực giải pháp.

III. CÁC ĐIỀU CẤM (NEGATIVE CONSTRAINTS)
- KHÔNG mô tả âm thanh thừa thãi trừ khi là mấu chốt của Hook.
- KHÔNG dùng câu hỏi tu từ hoặc lối nói lái, ẩn dụ.

IV. CƠ CHẾ THÍCH NGHI CẢM XÚC (Gây ra cho người xem)
- Fear/Urgency: Ngôn ngữ tàn nhẫn, đánh vào hậu quả mất mát ngay lập tức.
- Trust: Tập trung vào sự minh bạch, con số và bằng chứng thực tế, hoặc nhân vật/bối cảnh tạo ra được sự tin tưởng như truyền hình, người thật, góc quay thực tế thô, phỏng vấn chuyên gia trong lĩnh vực.
- Curiosity: Tập trung vào sự kỳ lạ, có thể là hành động, fact hoặc kiến thức gây tò mò.
- Educational: Khẳng định kiến thức mới một cách quyết đoán, không dạy đời.

V. LANGUAGE RULES
- User-facing copy must use the requested output language.
- This includes title, hook lines, character speech, text on screen, voice-over/video voice, script_vo, and CTA text.
- Visual descriptions and production notes should be Vietnamese so the internal team can read and execute them quickly.
- Target market controls setting, behavior, props, culture, and vibe; it must not change the user-facing copy language.
VI. INPUT VARIABLE HANDLING
- Use the Painpoint as the Hook attack target.
- Use the Feature, including exaggerated/fake feature behavior if the brief requires it, as the solution tool in the Pivot.
- Describe situations clearly enough that a camera operator or AI video tool can execute the action exactly.

VII. INTERNAL 5-FACTOR BRIEF DIGESTION
- The UI already selected Core User, Emotion Trigger, Visual/Theme, Product Selling Point, and Pain Point. Do not ask for them again and do not replace them.
- Before writing any idea, silently convert those selected inputs into one shootable creative brief: who is watching, what one emotion stops them, what Meta-native format creates trust, why this PSP matters now, and what exact pain situation appears in the first 3 seconds.
- Pain Point must become a specific moment + real-life setting + visible object/blocker + first action. If it is abstract, sharpen it without changing its meaning.
- Every hook/body/CTA must come from that hidden brief, not from generic app-demo logic.
- If the opening visual contains a visible person speaking, asking, replying, reacting to camera, or being asked a question, output that line in hook_character_speech. Do not put on-camera dialogue only in hook_voiceover or script_vo.`;

type IdeaBatchPlan = {
  batchQuantity: number;
  batchStartIndex: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function shouldUseCreativeRulesV7(appName: string, appKnowledge: string): boolean {
  const haystack = `${appName}\n${appKnowledge}`.toLowerCase();
  return haystack.includes(CREATIVE_RULESET_V7_MARKER.toLowerCase())
    || /\bv7\b/.test(haystack)
    || /rule\s*7/.test(haystack);
}

function shouldUsePromptSystemBuilderHtml(appKnowledge: string): boolean {
  const haystack = appKnowledge.toLowerCase();
  return haystack.includes(PROMPT_SYSTEM_BUILDER_HTML_MARKER.toLowerCase())
    || haystack.includes('prompt_system_builder_html_v1');
}

function buildV7ExecutionContract(input: {
  appName: string;
  coreUserValues: string[];
  primaryPillar: string;
  angleContext: string;
  featureContext: string;
  targetMarketValues: string[];
  targetLang: string;
  copyLanguage: string;
  visualType: string;
  ideaDescription?: string;
}) {
  return `## V7 EXECUTION CONTRACT - APPLIES TO THIS TEST APP ONLY
- App: ${input.appName}
- Market: ${input.targetMarketValues.join('; ') || 'Selected/default market'}
- Market language/culture reference: ${input.targetLang}
- Copy language: ${input.copyLanguage} for title, dialogue, on-screen text, voice-over, hook lines, script_vo, and CTA.
- Visual descriptions and production notes must be Vietnamese for the internal team.
- Core user: ${input.coreUserValues.join('; ') || 'General viewer'}
- Painpoint to attack: ${input.primaryPillar}
- Angle focus: ${input.angleContext || 'Creative freedom'}
- Feature/Pivot tool: ${input.featureContext}
- Visual style: ${input.visualType}
- User direction: ${input.ideaDescription || 'None'}

Hard V7 requirements:
- First, silently digest the selected Core User, Emotion Trigger, Visual/Theme, PSP, and Painpoint into a shootable brief. Do not output the brief.
- Ignore old rules about hook word count, hook 3-5s, 12-word hooks, and short one-line hook templates.
- The direct opening is the first stop-scroll beat: show consequence, shock, or an unusual visual at second 0.1.
- The solution pivot must happen immediately after: show the app/feature action with a specific finger movement and clear UI/number/chart change.
- Use the selected painpoint as the target of attack. Convert it into a concrete first-3-second situation, but do not soften it into a generic symptom.
- All Text/Voice must be written in ${input.copyLanguage}. Visual descriptions stay Vietnamese while preserving native setting, props, and vibe for the selected market.
- If a visible person speaks, asks, replies, reacts to camera, or is asked a question in the hook, hook_character_speech is required. If the idea relies on 2+ people communicating, keep the exchange simple and include only the necessary dialogue. If nobody visibly speaks, keep hook_character_speech empty.
- No rhetorical questions. Use direct statements.
- Keep production simple, but make every action, face, prop, environment, and screen state specific enough to shoot.`;
}

function buildV7TaskDirectives(quantity: number, copyLanguage = 'the requested output language') {
  return `Generate ${quantity} V7 production-ready short-form ad ideas for the selected filter combination.
- Before writing JSON, silently convert the selected Core User, Emotion Trigger, Visual/Theme, PSP, and Pain Point into one shootable creative brief. Do not output that brief.
- The selected Pain Point must appear as a specific first-3-second situation, not a label.
- Each idea must follow: Concept Name -> Market & User Adaptation -> Direct Opening (0-3s) -> Solution Pivot (3-6s) -> Proof/CTA continuation.
- The first frame must be a pattern interruption, not setup.
- The solution pivot must use the selected Feature/PSP as the tool that handles the problem.
- If the hook situation has a visible person talking to camera, replying, asking, or being questioned, fill hook_character_speech with that exact on-camera line. Use hook_voiceover only for off-camera narration/video voice.
- Write user-facing copy in ${copyLanguage}: title, hook lines, character dialogue, Text/Voice, text on screen, voice-over, and CTA. Write visual descriptions and production notes in Vietnamese.
- Think like the selected market: keep local behavior, home/work setting, social pressure, clothing, architecture, and cultural cues native to that market.
- Do not use old hook word-count constraints or old 3-5s hook section rules.
- Do not use rhetorical questions, wordplay, or vague metaphor hooks.
- If multiple ideas are requested, vary ethnicity/context/visual action/phone screen/proof object aggressively while staying inside the same painpoint and angle.`;
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
  context: { angleIndex: number; ideaIndex: number; pillar: string }
): Record<string, unknown> {
  const next = { ...item };
  const meta = { ...asRecord(item.meta) };

  next.id = `P0-A${context.angleIndex}-I${context.ideaIndex}`;
  meta.builderVersion = asText(meta.builderVersion) || 'prompt_system_builder_v1';
  meta.pillar = asText(meta.pillar) || context.pillar;
  meta.pillarIndex = Number(meta.pillarIndex ?? 0) || 0;
  next.meta = meta;

  return next;
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
  const hookVoice = [asText(hook.characterSpeech), asText(hook.voiceover), asText(hook.voice)].filter(Boolean).join(' ');
  const hookTextOverlay = asText(hook.textOverlay) || asText(hook.text);
  const dontDo = asText(meta.dontDo);

  const errors: string[] = [];

  if (!TRACKING_ID_PATTERN.test(id)) errors.push('id must follow P{pillar}-A{angle}-I{idea}');
  if (!hookPrimary) errors.push('meta.hookPrimary is required');
  if (!hookVisual) errors.push('hook.visual is required');
  if (!hookVoice && !hookTextOverlay) errors.push('hook needs voice or text overlay');

  const complianceText = [
    hookPrimary,
    hookAlt1,
    hookAlt2,
    hookVisual,
    hookVoice,
    hookTextOverlay,
    asText(body.visual) || asText(body.script),
    [asText(body.characterSpeech), asText(body.voiceover), asText(body.voice)].filter(Boolean).join(' '),
    asText(body.textOverlay) || asText(body.text),
    asText(cta.visual) || asText(cta.script),
    [asText(cta.characterSpeech), asText(cta.voiceover), asText(cta.voice)].filter(Boolean).join(' '),
    asText(cta.textOverlay) || asText(cta.text),
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectIdeaStringsForMetricScan(value: unknown, parentKey = ''): string[] {
  const key = parentKey.toLowerCase();
  if (key === 'id' || key === 'duration' || key === 'endcard') return [];

  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.flatMap(item => collectIdeaStringsForMetricScan(item, parentKey));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([childKey, childValue]) => (
      collectIdeaStringsForMetricScan(childValue, childKey)
    ));
  }

  return [];
}

function stripAppNameFromMetricScanText(text: string, appName: string): string {
  const terms = [appName, ...appName.split(/[:|/\\-]/)]
    .map(term => term.trim())
    .filter(term => term.length >= 5);

  return Array.from(new Set(terms)).reduce((next, term) => (
    next.replace(new RegExp(escapeRegExp(term), 'gi'), ' ')
  ), text);
}

function validateHealthMetricLockOutput(
  item: Record<string, unknown>,
  metricLock: HealthMetricKey | null | undefined,
  appName: string
): string[] {
  if (!metricLock) return [];

  const scanText = stripAppNameFromMetricScanText(
    collectIdeaStringsForMetricScan(item).join(' '),
    appName
  );
  const detectedMetrics = Array.from(new Set(getHealthMetricsInText(scanText)));
  const conflictingMetrics = detectedMetrics.filter(metric => metric !== metricLock);

  if (conflictingMetrics.length === 0) return [];

  return [
    `health metric must stay on ${getHealthMetricPromptLabel(metricLock)}; found ${conflictingMetrics.map(getHealthMetricPromptLabel).join(', ')}`,
  ];
}

function isInteriorDecorContext(context: {
  appName: string;
  category?: string;
  psp?: string;
  pillar?: string;
  angle?: string;
}): boolean {
  const haystack = normalizeCompareText([
    context.appName,
    context.category || '',
    context.psp || '',
    context.pillar || '',
    context.angle || '',
  ].join(' '));
  return /\b(?:home|interior|decor|decorate|decoration|redesign|restyle|redecor|room|house|furniture|living room|bedroom|kitchen|garden|yard)\b/.test(haystack);
}

function validateInteriorDecorClarityOutput(
  item: Record<string, unknown>,
  context: {
    appName: string;
    category?: string;
    psp?: string;
    pillar: string;
    angle?: string;
  }
): string[] {
  if (!isInteriorDecorContext(context)) return [];

  const meta = asRecord(item.meta);
  const hook = asRecord(item.hook);
  const titleHookCopy = normalizeCompareText([
    asText(item.title),
    asText(meta.hookPrimary),
    asText(meta.hookAlt1),
    asText(meta.hookAlt2),
    asText(hook.characterSpeech),
    asText(hook.voiceover),
    asText(hook.voice),
    asText(hook.textOverlay),
    asText(hook.text),
  ].filter(Boolean).join(' '));
  const hookVisual = normalizeCompareText(asText(hook.visual) || asText(hook.script));
  const fullText = normalizeCompareText(collectIdeaStringsForMetricScan(item).join(' '));

  const errors: string[] = [];
  const roomAnchor = /\b(?:room|space|living room|bedroom|kitchen|corner|wall|sofa|chair|rug|lamp|floor|furniture|decor|interior|garden|yard|phong|nha|goc|tuong|ghe|tham|den|san|noi that|vuon)\b/;
  const stuckAnchor = /\b(?:empty|blank|bare|ugly|wrong|mismatch|mismatched|clashing|random|messy|unfinished|stuck|no clue|dont know|do not know|where to start|too many|expensive|designer|xau|trong|trong tron|lech|sai|khong biet|boi roi|ket|chua biet)\b/;
  const appProofAnchor = /\b(?:take photo|upload|camera|photo|scan|choose|select|restyle|redecor|redesign|render|generate|compare|style card|style carousel|saved favorite|before render|app screen|chup anh|tai anh|chon|tao render|so sanh)\b/;
  const abstractHook = /\b(?:my style|own style|style coordination|style identity|fit three styles|every style|every option feels wrong|visualize)\b/;

  if (abstractHook.test(titleHookCopy)) {
    errors.push('AI Home hook/title is too abstract; rewrite around a visible room problem and app proof, not "my style/every style" language');
  }
  if (!roomAnchor.test(hookVisual) || !stuckAnchor.test(hookVisual)) {
    errors.push('AI Home hook visual must show the original room/space plus a visible stuck problem before the app appears');
  }
  if (!appProofAnchor.test(fullText)) {
    errors.push('AI Home idea must include clear app proof: take/upload photo, choose style, render/generate, or compare results');
  }

  return errors;
}

function normalizeAndValidateIdeas(
  items: unknown[],
  context: {
    duration: string;
    appName: string;
    category?: string;
    psp?: string;
    angle?: string;
    pillar: string;
    angleIndex: number;
    ideaStartIndex?: number;
    metricLock?: HealthMetricKey | null;
  }
) {
  const valid: Record<string, unknown>[] = [];
  const invalidReasons: string[] = [];

  items.forEach((item, ideaIndex) => {
    const normalized = repairIdeaTrackingFields(
      normalizeIdeaOutput(item, {
        duration: context.duration,
        appName: context.appName,
        pillar: context.pillar,
      }),
      { angleIndex: context.angleIndex, ideaIndex: (context.ideaStartIndex || 0) + ideaIndex, pillar: context.pillar }
    );
    const errors = [
      ...validateIdeaOutput(normalized),
      ...validateHealthMetricLockOutput(normalized, context.metricLock, context.appName),
      ...validateInteriorDecorClarityOutput(normalized, context),
    ];

    if (errors.length === 0) valid.push(normalized);
    else invalidReasons.push(`Idea ${ideaIndex + 1}: ${errors.join('; ')}`);
  });

  return { valid, invalidReasons };
}

// Detect language from Core User text
function detectLang(coreUsers: string[]): string {
  const joined = (coreUsers || []).join(' ').toLowerCase();

  // Use word boundary check to avoid false matches (e.g. "user" matching "se")
  const hasWord = (word: string) => new RegExp(`\\b${word}\\b`).test(joined);

  if (hasWord('spanish') || hasWord('tây ban nha') || hasWord('español') || hasWord('latina')) return 'ES (Tây Ban Nha)';
  if (hasWord('portuguese') || hasWord('brazil') || hasWord('brasil') || hasWord('bồ đào nha')) return 'PT (Bồ Đào Nha)';
  if (hasWord('japanese') || hasWord('japan') || hasWord('nhật') || hasWord('日本')) return 'JP (Nhật)';
  if (hasWord('vietnamese') || hasWord('việt') || hasWord('vietnam')) return 'VI (Việt Nam)';
  if (hasWord('swedish') || hasWord('thụy điển') || hasWord('sweden') || hasWord('svenska')) return 'SE (Thụy Điển)';
  if (hasWord('german') || hasWord('đức') || hasWord('germany') || hasWord('deutsch')) return 'DE (Đức)';
  if (hasWord('french') || hasWord('pháp') || hasWord('france') || hasWord('français')) return 'FR (Pháp)';
  if (hasWord('thai') || hasWord('thái') || hasWord('malay') || hasWord('indonesia') || hasWord('sea')) return 'SEA (Đa ngôn ngữ ĐNA)';
  if (hasWord('korean') || hasWord('hàn') || hasWord('korea')) return 'KO (Hàn Quốc)';
  return 'Vietnamese';
}

function detectMarketLang(targetMarkets: string[], coreUsers: string[]): string {
  const explicitMarketLanguage = detectTargetLanguageFromMarkets(targetMarkets, coreUsers);
  if (explicitMarketLanguage) return explicitMarketLanguage;

  const joined = `${targetMarkets.join(' ')} ${coreUsers.join(' ')}`.toLowerCase();
  const hasAny = (tokens: string[]) => tokens.some(token => joined.includes(token));

  if (hasAny(['us', 'usa', 'united states', 'mỹ', 'my', 'uk', 'united kingdom', 'canada', 'australia', 'english'])) return 'English';
  if (hasAny(['vietnam', 'việt', 'viet', 'vn'])) return 'Vietnamese';
  if (hasAny(['japan', 'jp', 'nhật', '日本', 'japanese'])) return 'Japanese';
  if (hasAny(['korea', 'kr', 'hàn', 'korean'])) return 'Korean';
  if (hasAny(['germany', 'deutsch', 'đức', 'german'])) return 'German';
  if (hasAny(['france', 'pháp', 'french', 'français'])) return 'French';
  if (hasAny(['spain', 'spanish', 'tây ban nha', 'español', 'latam', 'latin'])) return 'Spanish';
  if (hasAny(['brazil', 'brasil', 'portuguese', 'bồ đào nha'])) return 'Portuguese';
  if (hasAny(['thai', 'thái', 'thailand'])) return 'Thai';
  if (hasAny(['indonesia', 'indonesian'])) return 'Indonesian';
  if (hasAny(['malay', 'malaysia'])) return 'Malay';
  if (hasAny(['sea', 'đông nam á'])) return 'Local SEA language matching the selected country';

  return detectLang(coreUsers);
}

// Map frontend model names to gateway model identifiers
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
  return map[selected || ''] || 'openai/gpt-4.1';
}

function resolveIdeaModels(selected?: string): string[] {
  const primary = resolveModel(selected);
  const fallbackModels = primary.startsWith('gemini/')
    ? [
        primary,
        'openai/gpt-5.4-mini',
        'gemini/gemini-2.5-flash',
      ]
    : [
        primary,
        'openai/gpt-5.4',
        'openai/gpt-5.4-mini',
        'openai/gpt-4.1',
        'gemini/gemini-2.5-pro',
      ];
  return Array.from(new Set(fallbackModels));
}

function clampPromptContext(value: unknown, maxLength: number) {
  const text = asText(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n[...truncated]` : text;
}

function buildGenerateIdeasEmergencyFallback(payload: Record<string, unknown>) {
  const config = asRecord(payload.config);
  const quantity = Math.min(toPositiveInt(config.quantity, 3), MAX_IDEAS_PER_REQUEST);
  return buildFallbackIdeasForFilters({
    appName: asText(payload.appName) || 'App',
    filters: payload.filters,
    quantity,
    duration: asText(config.duration) || 'Short social-first runtime',
    startIndex: Math.max(0, Number(config.startIndex || 0) || 0),
    angleIndex: Math.max(1, Number(config.angleIndex || 1) || 1),
    ideaDescription: config.ideaDescription,
  });
}

function buildRefineEmergencyFallback(payload: Record<string, unknown>) {
  const originalIdea = asRecord(payload.originalIdea);
  const originalFramework = asRecord(originalIdea.framework);
  return normalizeIdeaOutput(originalIdea, {
    duration: asText(originalIdea.duration) || '30s',
    appName: asText(payload.appName) || 'App',
    pillar: asText(originalFramework.painpoint) || asText(asRecord(originalIdea.meta).pillar) || 'General user friction',
  });
}

function buildAngleEmergencyFallback(payload: Record<string, unknown>) {
  const painpoints = Array.isArray(payload.painpoints)
    ? payload.painpoints.map(asText).filter(Boolean)
    : [];
  const seeds = painpoints.length > 0 ? painpoints : ['pain point hiện tại'];
  return seeds.flatMap((pp: string) => [
    `${pp} nhưng bạn vẫn chưa biết bắt đầu từ đâu`,
    `${pp} và mỗi lần thử lại càng rối hơn`,
    `${pp} dù đã xem nhiều cách khác nhau`,
  ]);
}

// Build culture/market context based on selected target market
function buildMarketContext(targetMarket: string[]): string {
  const market = (targetMarket || []).join(', ').toLowerCase();

  if (!market || market.includes('us') || market.includes('mỹ')) {
    return `═══════════════════════════════════════
⚠️ THỊ TRƯỜNG MỤC TIÊU: US (Mỹ)
═══════════════════════════════════════
MỌI chi tiết phải PHÙ HỢP văn hóa Mỹ:

🏠 BỐI CẢNH: suburban house, apartment, kitchen, backyard/patio, garage
📱 CÔNG NGHỆ: iPhone/Samsung, Siri, Ring doorbell, Apple Pay, Chase/BoA
👥 HÀNH VI: gọi "Dad/Mom/honey/babe", dùng iMessage, tiếng lóng "literally/no way/oh my god"
🍔 ĐỜI SỐNG: Starbucks, Target, Walmart, Home Depot, Netflix, road trip, BBQ
💵 ĐƠN VỊ: USD, miles, °F, pounds, inches

❌ KHÔNG: Zalo, xe máy, VNĐ, chợ, Grab, MoMo, xưng hô bố/mẹ/con kiểu VN`;
  }

  if (market.includes('jp') || market.includes('nhật')) {
    return `═══════════════════════════════════════
⚠️ THỊ TRƯỜNG MỤC TIÊU: JP (Nhật Bản)
═══════════════════════════════════════
MỌI chi tiết phải PHÙ HỢP văn hóa Nhật:

🏠 BỐI CẢNH: mansion (apartment), 1LDK/2LDK, genkan (lối vào), tatami room, konbini (7-Eleven, Lawson, FamilyMart), eki (station)
📱 CÔNG NGHỆ: iPhone (chủ yếu), LINE app, PayPay, Suica/PASMO, Yahoo! Japan
👥 HÀNH VI: lịch sự, ít nói thẳng, review kỹ trước khi mua, xem YouTube/TikTok, dùng LINE thay SMS
🍱 ĐỜI SỐNG: bento, izakaya, daiso, Don Quijote, Uniqlo, shinkansen, cherry blossom
💴 ĐƠN VỊ: JPY (¥), cm/m, °C, kg

❌ KHÔNG: bối cảnh Mỹ/VN, Facebook (ít dùng ở JP), đơn vị miles/°F`;
  }

  if (market.includes('sea') || market.includes('đông nam á') || market.includes('vn') || market.includes('việt')) {
    return `═══════════════════════════════════════
⚠️ THỊ TRƯỜNG MỤC TIÊU: SEA (Đông Nam Á)
═══════════════════════════════════════
MỌI chi tiết phải PHÙ HỢP văn hóa Đông Nam Á:

🏠 BỐI CẢNH: chung cư, nhà phố, quán cà phê, chợ, trung tâm thương mại
📱 CÔNG NGHỆ: đa dạng Android/iPhone, Shopee, Grab, GoPay/Momo/GCash, TikTok Shop, Facebook Messenger, Zalo (VN), Line (TH)
👥 HÀNH VI: hay xem review TikTok, mua hàng qua livestream, chia sẻ qua group chat, giá cả quan trọng
🍜 ĐỜI SỐNG: xe máy, street food, trà sữa, karaoke, phở/pad thai/nasi goreng
💵 ĐƠN VỊ: VND/THB/PHP/IDR, km, °C, kg

❌ KHÔNG: bối cảnh Mỹ/Nhật, suburban house, Target/Walmart, miles/°F`;
  }

  if (market.includes('eu') || market.includes('châu âu') || market.includes('de') || market.includes('đức') || market.includes('fr') || market.includes('pháp')) {
    return `═══════════════════════════════════════
⚠️ THỊ TRƯỜNG MỤC TIÊU: EU (Châu Âu)
═══════════════════════════════════════
MỌI chi tiết phải PHÙ HỢP văn hóa Châu Âu:

🏠 BỐI CẢNH: flat/apartment, terraced house, city centre, public transport
📱 CÔNG NGHỆ: iPhone/Samsung, WhatsApp (chủ yếu), Apple Pay, Revolut, N26
👥 HÀNH VI: quan tâm privacy/GDPR, dùng WhatsApp thay SMS, cà phê/pub culture, football
🍕 ĐỜI SỐNG: IKEA, Zara, H&M, Lidl/Aldi, Tesco/Carrefour, train/metro
💶 ĐƠN VỊ: EUR (€)/GBP (£), km, °C, kg

❌ KHÔNG: bối cảnh Mỹ/châu Á, Target/Walmart, miles/°F, tipping culture`;
  }

  if (market.includes('kr') || market.includes('hàn') || market.includes('korea')) {
    return `═══════════════════════════════════════
⚠️ THỊ TRƯỜNG MỤC TIÊU: KR (Hàn Quốc)
═══════════════════════════════════════
MỌI chi tiết phải PHÙ HỢP văn hóa Hàn Quốc:

🏠 BỐI CẢNH: apartment (아파트), officetel, PC bang, cafe, subway station
📱 CÔNG NGHỆ: Samsung/iPhone, KakaoTalk, Naver, Toss (payment), Coupang
👥 HÀNH VI: aesthetics quan trọng, review trên Naver blog, xem YouTube, K-beauty, skincare
🍲 ĐỜI SỐNG: chicken + beer, convenience store (CU/GS25), Olive Young, Daiso, subway
💴 ĐƠN VỊ: KRW (₩), cm/m, °C, kg

❌ KHÔNG: bối cảnh Mỹ/VN, Facebook (ít phổ biến), miles/°F`;
  }

  if (market.includes('latam') || market.includes('mỹ latin') || market.includes('brazil') || market.includes('mexico')) {
    return `═══════════════════════════════════════
⚠️ THỊ TRƯỜNG MỤC TIÊU: LATAM (Mỹ Latin)
═══════════════════════════════════════
MỌI chi tiết phải PHÙ HỢP văn hóa Mỹ Latin:

🏠 BỐI CẢNH: casa/apartment, tienda, mercado, plaza, centro comercial
📱 CÔNG NGHỆ: Android phổ biến hơn iPhone, WhatsApp (chính), Mercado Pago, Pix (Brazil), TikTok
👥 HÀNH VI: gia đình quan trọng, nhóm WhatsApp gia đình, telenovela, football, giá rẻ = key
🌮 ĐỜI SỐNG: taco/empanada/açaí, Oxxo (Mexico), farmácia, transporte público
💵 ĐƠN VỊ: BRL/MXN/ARS, km, °C, kg

❌ KHÔNG: bối cảnh Mỹ/châu Á, Apple Pay (ít dùng), miles/°F`;
  }

  // Fallback: generic international
  return `═══════════════════════════════════════
⚠️ THỊ TRƯỜNG MỤC TIÊU: ${targetMarket.join(', ')}
═══════════════════════════════════════
Hãy điều chỉnh bối cảnh, văn hóa, công nghệ, hành vi, đơn vị đo lường cho PHÙ HỢP với thị trường "${targetMarket.join(', ')}".
KHÔNG mặc định dùng bối cảnh Mỹ nếu thị trường khác.`;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : [];
}

function formatStringList(value: unknown): string {
  const items = asStringList(value);
  return items.length ? items.join(', ') : 'Không có';
}

function buildSeasonalVisualBlock(context: unknown): string {
  if (!context || typeof context !== 'object') return '';

  const data = context as Record<string, unknown>;
  const readText = (key: string) => (typeof data[key] === 'string' ? data[key] as string : '');
  const seasonLabel = [readText('seasonIcon'), readText('seasonLabel')].filter(Boolean).join(' ');
  const monthLabel = readText('monthLabel');

  return `
[SEASONAL VISUAL CONTEXT — BẮT BUỘC ÁP VÀO HOOK VISUAL]
Mùa/tháng: ${seasonLabel || 'Không có'}${monthLabel ? ` / ${monthLabel}` : ''}
Khoảng tháng: ${readText('monthRange') || 'Không có'}
Sự kiện theo tháng/mùa: ${formatStringList(data.events)}
Trang phục phù hợp: ${formatStringList(data.costumes)}
Hành vi/bối cảnh đời thường: ${formatStringList(data.behaviors)}
Màu sắc/ánh sáng: ${formatStringList(data.colors)}
Props/set dressing: ${formatStringList(data.props)}
Mood: ${formatStringList(data.moods)}
Chi tiết user nhấn mạnh: ${formatStringList(data.emphasis)}

CÁCH DÙNG:
- Áp dụng trực tiếp vào hook.visual, nhất là 1-2 câu mở cảnh đầu tiên: trang phục, props, màu sắc, ánh sáng, hành vi, dấu hiệu sự kiện.
- Chọn 2-4 chi tiết tự nhiên nhất theo core user + target market; không cần nhồi toàn bộ list.
- Đây là VISUAL DIRECTION, KHÔNG phải mô tả bổ sung. Không viết thành note riêng, không lặp lại như "[Visual Insights]" trong output.
- Sự kiện/mùa chỉ làm hook nhìn đúng thời điểm; KHÔNG được thay thế painpoint đã chọn.
- Nếu thị trường mục tiêu không hợp với tuyết/lạnh/ngày lễ Mỹ, hãy localize chi tiết mùa/sự kiện cho hợp văn hóa.`;
}

function buildBatchDiversityBlock(quantity: number, angle: string, angleIndex: number, totalAngles: number): string {
  if (quantity <= 1) return '';

  const lanes = [
    'Idea 1: UGC handheld đời thường, mở bằng một hành động cá nhân đang bị kẹt giữa chừng.',
    'Idea 2: Reaction/social interruption, có người hoặc vật thứ hai làm tình huống đổi nhịp.',
    'Idea 3: Split Screen/reveal bất ngờ, mở bằng một blocking object hoặc không gian khác hẳn idea 1.',
    'Idea 4: ASMR/oddly satisfying, mở bằng texture, âm thanh hoặc chuyển động nhỏ gây dừng scroll.',
    'Idea 5: Comment-reply/Social Proof, mở bằng một câu hỏi hoặc phản ứng từ người khác.',
    'Idea 6: Challenge, biến painpoint thành một câu đố hoặc nhiệm vụ 1 nhịp.',
    'Idea 7: Interview/street-test, mở bằng một câu hỏi trực diện với người dùng.',
    'Idea 8: Trend Format, dùng format trend nhưng đổi scene family và first action.',
  ].slice(0, quantity).join('\n');

  return `
[BATCH DIVERSITY CONTRACT — BẮT BUỘC CHO LẦN GEN NÀY]
Bạn đang tạo ${quantity} ideas trong CÙNG MỘT batch${angle ? ` cho angle "${angle}"` : ''}${totalAngles > 1 ? ` (angle ${angleIndex}/${totalAngles})` : ''}.
Các ideas KHÔNG được là 3 biến thể của cùng một cảnh.

MỖI idea phải khác rõ ở ÍT NHẤT 4/6 trục:
1. creativeType
2. địa điểm/góc phòng/bối cảnh mở đầu
3. hành động đầu tiên của nhân vật
4. vật cản/props chính tạo painpoint
5. camera reveal hoặc transition
6. câu voice mở đầu + text overlay

Nếu painpoint bắt buộc xoay quanh cùng một object/vấn đề, vẫn phải đổi hoàn cảnh, lý do không thể xử lý, camera reveal và payoff. Không được chỉ đổi vài chữ như "sàn ướt" thành "tay bận".

Gán lane theo thứ tự:
${lanes}

TRƯỚC KHI OUTPUT, tự kiểm tra:
- Không có 2 title cùng cấu trúc.
- Không có 2 hook.visual cùng địa điểm + hành động mở đầu.
- Không có 2 hook.voice cùng ý nói.
- POV tối đa 1 idea trong batch này, trừ khi user chọn visualType bắt buộc chỉ POV.
- Nếu trùng scene family, viết lại idea sau thành scene family khác.`;
}

function buildSingleIdeaSlotBlock(
  slotNumber: number,
  totalVariations: number,
  context: { angle: string; painpoint: string; psp: string; visualType: string }
): string {
  if (totalVariations <= 1) return '';

  const lanes = [
    {
      name: 'UGC constraint reveal',
      creativeType: 'UGC',
      must: 'Open on the exact physical obstacle/state that makes the user hesitate, before any app UI appears.',
      sceneShift: 'personal, close handheld, one messy real-life object as the blocker',
    },
    {
      name: 'Reaction / second opinion',
      creativeType: 'Reaction',
      must: 'Open with another person interrupting or questioning the decision, forcing the user to prove the answer quickly.',
      sceneShift: 'two-person tension, reply line, social pressure',
    },
    {
      name: 'Split-screen decision test',
      creativeType: 'Split Screen',
      must: 'Open with two or three clearly different options/states competing on screen; reveal why guessing is risky.',
      sceneShift: 'multi-panel comparison, different corners/options, not one static phone shot',
    },
    {
      name: 'Proof object / receipt shock',
      creativeType: 'Social Proof',
      must: 'Open with a concrete proof object such as a quote, receipt, screenshot, checklist, calendar, or estimate gap.',
      sceneShift: 'paper/screenshot/number-driven proof, not just vibe checking',
    },
    {
      name: 'Comment reply',
      creativeType: 'Comment Reply',
      must: 'Open from a viewer comment or skeptical question and answer it through the selected pain point.',
      sceneShift: 'comment overlay, direct response framing, fast rebuttal',
    },
    {
      name: 'Challenge / timer',
      creativeType: 'Challenge',
      must: 'Open with a timed challenge or one-beat task that dramatizes how hard the decision is without the PSP.',
      sceneShift: 'countdown, task pressure, before/after logic without medical or misleading claims',
    },
    {
      name: 'Interview / street test',
      creativeType: 'Interview',
      must: 'Open with a direct question to the target user or a quick poll between two choices.',
      sceneShift: 'question-first, human answer, market-native language',
    },
    {
      name: 'ASMR / tactile detail',
      creativeType: 'ASMR',
      must: 'Open with a tactile texture, small repeated motion, sound cue, or object handling that embodies the pain.',
      sceneShift: 'texture/sound-led, satisfying reveal, no generic phone-only setup',
    },
    {
      name: 'Mistake teardown',
      creativeType: 'Teardown',
      must: 'Open by exposing a common wrong choice and explain the hidden cost/confusion through the selected angle.',
      sceneShift: 'red-flag annotation, mistake-first hook, practical correction',
    },
    {
      name: 'Trend remix',
      creativeType: 'Trend Format',
      must: 'Use a recognizable social format, but make the first action and payoff native to the pain point.',
      sceneShift: 'trend rhythm, unexpected first frame, not a generic demo',
    },
  ];
  const lane = lanes[(Math.max(1, slotNumber) - 1) % lanes.length];
  const plannedLanes = lanes
    .slice(0, Math.min(totalVariations, lanes.length))
    .map((item, index) => `${index + 1}. ${item.name} / ${item.creativeType}: ${item.sceneShift}`)
    .join('\n');

  return `
[SINGLE IDEA SLOT - PARALLEL GENERATION CONTRACT]
You are creating idea ${slotNumber}/${totalVariations} for this selected angle.
Selected pain point: "${context.painpoint || 'selected pain point'}"
Selected angle: "${context.angle || 'selected angle'}"
Selected PSP: "${context.psp || 'selected PSP'}"
Selected visual type: "${context.visualType || 'selected visual type'}"

ALL PARALLEL SLOTS ARE EXPECTED TO FOLLOW THIS PLAN:
${plannedLanes}

YOUR SLOT ${slotNumber} LANE:
- Name: ${lane.name}
- Required creativeType family: ${lane.creativeType}
- Must do: ${lane.must}
- Scene shift: ${lane.sceneShift}

Hard guardrails for this slot:
- Stay on the exact selected pain point and angle. Do not replace the angle with a generic benefit.
- Do not write a generic "user holds phone and checks the app" idea unless the lane adds a new conflict object, social pressure, proof object, timer, teardown, or tactile cue.
- The first frame must make this lane visibly different from the other slots.
- The title, hook.visual, hook voice, body proof, and CTA payoff must all reflect this lane.
- If the result sounds like a basic app demo, rewrite it into the assigned lane before output.`;
}

function ideaSignature(idea: Record<string, unknown>): string {
  const hook = asRecord(idea.hook);
  const body = asRecord(idea.body);

  return [
    asText(idea.title),
    asText(idea.creativeType),
    asText(hook.visual),
    asText(hook.characterSpeech),
    asText(hook.voiceover),
    asText(hook.voice),
    asText(hook.textOverlay),
    asText(body.visual),
    asText(body.characterSpeech),
    asText(body.voiceover),
    asText(body.voice),
  ].filter(Boolean).join(' ');
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
  return normalizeCompareText(left) === normalizeCompareText(right) || jaccardSimilarity(left, right) >= 0.72;
}

function creativeTypeKey(idea: Record<string, unknown>): string {
  const key = normalizeCompareText(asText(idea.creativeType) || asText(asRecord(idea.meta).angleType));
  if (!key) return 'creative';
  if (key.includes('pov')) return 'pov';
  if (key.includes('split')) return 'split-screen';
  if (key.includes('reaction')) return 'reaction';
  if (key.includes('asmr') || key.includes('satisfying')) return 'asmr';
  if (key.includes('social') || key.includes('proof') || key.includes('comment')) return 'social-proof';
  if (key.includes('challenge')) return 'challenge';
  if (key.includes('interview')) return 'interview';
  if (key.includes('trend')) return 'trend-format';
  if (key.includes('ugc')) return 'ugc';
  return key;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(word => word.length > 3)
  );
}

function jaccardSimilarity(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;

  let overlap = 0;
  left.forEach(word => {
    if (right.has(word)) overlap++;
  });

  return overlap / (left.size + right.size - overlap);
}

function hasNearDuplicateIdeas(ideas: Record<string, unknown>[]): boolean {
  for (let i = 0; i < ideas.length; i++) {
    for (let j = i + 1; j < ideas.length; j++) {
      if (
        hasSameHookFrame(ideas[i], ideas[j])
        || jaccardSimilarity(ideaSignature(ideas[i]), ideaSignature(ideas[j])) >= 0.82
      ) {
        return true;
      }
    }
  }

  return false;
}

function countCreativeTypes(ideas: Record<string, unknown>[]): Record<string, number> {
  return ideas.reduce<Record<string, number>>((counts, idea) => {
    const key = creativeTypeKey(idea);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function dedupeIdeas(candidates: Record<string, unknown>[], existing: Record<string, unknown>[] = []): Record<string, unknown>[] {
  const unique: Record<string, unknown>[] = [];
  const creativeCounts = countCreativeTypes(existing);
  const maxPovPerRequest = 1;

  for (const candidate of candidates) {
    const signature = ideaSignature(candidate);
    const creativeKey = creativeTypeKey(candidate);
    const isOverusedPov = creativeKey === 'pov' && (creativeCounts.pov || 0) >= maxPovPerRequest;
    const isUnique = [...existing, ...unique].every(item => (
      jaccardSimilarity(signature, ideaSignature(item)) < 0.82
    )) && ![...existing, ...unique].some(item => hasSameHookFrame(candidate, item));

    if (isUnique && !isOverusedPov) {
      unique.push(candidate);
      creativeCounts[creativeKey] = (creativeCounts[creativeKey] || 0) + 1;
    }
  }

  return unique;
}

function toPositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function buildIdeaBatchPlans(totalRequestedQuantity: number): IdeaBatchPlan[] {
  const plans: IdeaBatchPlan[] = [];
  for (let batchStartIndex = 0; batchStartIndex < totalRequestedQuantity; batchStartIndex += MAX_IDEAS_PER_AI_BATCH) {
    plans.push({
      batchQuantity: Math.min(MAX_IDEAS_PER_AI_BATCH, totalRequestedQuantity - batchStartIndex),
      batchStartIndex,
    });
  }
  return plans;
}

function getIdeaBatchTimeoutMs(model: string, batchQuantity: number) {
  if (model.includes('gemini-3-pro')) {
    return batchQuantity <= 3
      ? GENERATE_IDEAS_GEMINI3_SMALL_BATCH_TIMEOUT_MS
      : GENERATE_IDEAS_BATCH_TIMEOUT_MS;
  }

  return GENERATE_IDEAS_BATCH_TIMEOUT_MS;
}

function getIdeaResponseTokenBudget(batchQuantity: number) {
  return Math.max(3200, batchQuantity * 1800);
}

function trimPromptText(text: string, maxLength = 160) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildInRequestIdeaHistory(ideas: Record<string, unknown>[]) {
  if (ideas.length === 0) return '';

  return ideas
    .slice(-4)
    .map((idea, index) => {
      const hook = asRecord(idea.hook);
      const body = asRecord(idea.body);

      return `${index + 1}. "${trimPromptText(asText(idea.title), 90)}" | type="${trimPromptText(asText(idea.creativeType), 40)}"
   hookVisual="${trimPromptText(asText(hook.visual) || asText(hook.script), 140)}"
   hookVoice="${trimPromptText(asText(hook.voice), 110)}"
   bodyVisual="${trimPromptText(asText(body.visual) || asText(body.script), 140)}"`;
    })
    .join('\n');
}

function buildInteriorDecorPatternPack(context: {
  appName: string;
  category: string;
  psp: string;
  painpoint: string;
  angle: string;
}): string {
  const haystack = normalizeCompareText([
    context.appName,
    context.category,
    context.psp,
    context.painpoint,
    context.angle,
  ].join(' '));
  const isInteriorDecor = /\b(?:home|interior|decor|decorate|decoration|redesign|restyle|redecor|room|house|furniture|living room|bedroom|kitchen|garden|yard)\b/.test(haystack);
  if (!isInteriorDecor) return '';

  return `
AI HOME / INTERIOR DECOR CATEGORY DNA - MANDATORY WHEN THIS CONTEXT MATCHES
This pack is distilled from the user's winning AI Home and competitor interior videos. Use it even when no imported video is attached.

Winning structure:
1. 0-3s: show the real stuck space first. Do not open on app UI.
   - blank room, ugly room, mismatched decor, empty corner, renovation mess, style confusion, or "I do not know where to start" moment.
   - first_frame_asset must be a real room/garden/interior state plus one visible blocker: bare wall, random chair, clashing lamp, tape marks, boxes, missing rug, messy corner, or empty layout.
2. The viewer must understand the story without reading strategy notes.
   - Every idea must be explainable in one plain sentence: "This person is stuck with [specific room problem], then AI Home gives them [specific design starting point/result]."
   - The title, hook_primary, hook_voiceover/character_speech, and hook_text_overlay must all point to the same simple story. Do not make the title a vague concept statement.
   - Good plain story spines: "empty room -> no starting point -> AI gives first direction"; "ugly room -> years of delay -> AI restyles in seconds"; "mismatched decor -> friend/spouse calls it out -> AI compares better options"; "expensive designer fear -> AI gives first layout/style ideas"; "too many saved ideas -> no decision -> AI narrows options."
3. Hook copy: simple, specific, slightly uncomfortable.
   - Use one hook mechanism per idea: blank-room paralysis, style mismatch, years-vs-seconds contrast, too-many-styles confusion, no-designer/budget proof, or social comment about a bad room choice.
   - Good rhythm examples to learn from, not copy: "The room is not the problem." / "I had no first move for this room." / "AI gave me a starting point." / "You do not need a designer for this first decision."
   - Prefer concrete words: empty room, bare wall, ugly corner, wrong sofa, random lamp, saved ideas, first style, first layout, starting point, designer cost.
   - Avoid abstract hooks/titles: "my style", "style coordination", "style identity", "fit three styles", "every style looks wrong", "every option feels wrong", "visualize" by itself. If using "style", tie it to a visible room problem and the app result.
   - If the hook is a person speaking to camera, reacting to a friend/spouse, or answering a social comment, hook_character_speech must contain that exact spoken line. Do not leave character speech empty for talking-head, reaction, interview, or dialogue setups.
4. 3-6s: the app proof must appear fast.
   - show camera/photo upload/take photo -> choose room/style/restyle -> generate/compare. Name the exact tap and screen state.
5. 6s onward: payoff is comparison, not vague beauty.
   - show 3-5 style cards/renders, before-to-render in the same space, or saved favorites side by side.
   - proof_object should be style carousel, compare screen, render grid, before/render split, or saved favorite result.

Before outputting each AI Home/interior idea, run this internal clarity check:
- Can a non-marketer explain the idea after reading only the title + hook block?
- Is the original room problem visible before the app?
- Does the app proof answer the exact stuck moment?
- If any answer is no, rewrite the idea into a simpler room-problem -> AI-proof story.

Avoid:
- generic "home makeover" hooks that do not show the stuck decision.
- opening with only app UI before the room pain is visible.
- pretty renders without the real original room.
- repeating the same "my wife/mother-in-law could not decorate" line unless the setup creates a new social tension.
- visual_scene_2 that says only "use the app"; it must show take photo/upload + choose style + render/compare.
`;
}

function buildWinningPatternLibraryBlock(context: {
  appName: string;
  category: string;
  psp: string;
  painpoint: string;
  angle: string;
}) {
  const categoryPatternPack = buildInteriorDecorPatternPack(context);

  return `\n[REFERENCE VIDEO DNA - EXAMPLES ONLY, NOT A CLOSED TEMPLATE MENU]
These are distilled from the user's sample/winning content to show the expected level of specificity, pacing, proof, and first-frame thinking.
Do not force ideas into these exact formats. Use them as creative cues. If another structure fits the selected pain point better, create a new named pattern or a hybrid pattern.

1. Siri Bridge
- Hook: a real person asks Siri/phone a painfully specific question.
- Beat: Siri/assistant recommends the app as the shortcut.
- Demo: open app, perform one visible action, show result/proof screen.
- Best for: home design, phone utilities, habit/health tracking when the user feels stuck.

2. Shock Object / Visual Metaphor
- Hook: an odd, tactile, slightly uncomfortable macro visual stops scroll before explanation.
- Beat: overlay connects the object to the real user pain.
- Demo: cut hard to phone/app action.
- Best for: health/wellness anxiety, hidden risk, messy storage, ugly room/problem reveal.

3. Phone Demo Proof
- Hook: hand-held phone screen, finger already doing the action.
- Beat: one clear app action: scan, measure, compare, render, delete, save, track.
- Proof: result screen held long enough to read.
- Best for: any feature where the proof is in the UI.

4. Transformation Demo
- Hook: ugly/empty/confusing starting point.
- Beat: user performs one app action.
- Proof: visual before-to-render or messy-to-clean transformation. For health, use trend/logging proof only, not health outcome before/after.
- Best for: interior design, cleaner, photo, productivity.

5. Split-Screen Choice
- Hook: two/three possible paths or guesses shown side by side.
- Beat: force the viewer to choose before revealing the app action.
- Proof: app resolves uncertainty.
- Best for: cost estimate, design options, symptom tracking, duplicate cleanup.

${categoryPatternPack}

For this request:
- App: ${context.appName}
- Category: ${context.category}
- Selected pain point: ${context.painpoint}
- Selected angle: ${context.angle || 'No locked angle'}
- PSP/app action to prove: ${context.psp}

Mandatory adaptation:
- Each idea must output a reference_pattern name, but it can be a library cue, a hybrid, or a newly invented pattern that fits the pain point.
- Do not copy sample videos literally. Do not overuse Siri, shock objects, phone demos, or split-screen if they do not naturally fit the selected angle.
- first_frame_asset must be a concrete visual asset from the first 0.5 seconds.
- psp_bridge must connect the hook emotion/angle to the PSP before the Body/demo.
- proof_object must be a concrete screen/object visible in the proof section.
- app_demo_action must name the exact tap/scan/upload/render/track/compare action.
- overlay_sequence must read like real video captions, not strategy notes.\n`;
}

function buildVariationWindowBlock(batchStartIndex: number, batchQuantity: number, totalRequestedQuantity: number) {
  if (totalRequestedQuantity <= 1) return '';

  const rangeStart = batchStartIndex + 1;
  const rangeEnd = batchStartIndex + batchQuantity;
  const rangeLabel = rangeStart === rangeEnd
    ? `${rangeStart}/${totalRequestedQuantity}`
    : `${rangeStart}-${rangeEnd}/${totalRequestedQuantity}`;

  return `\n[VARIATION WINDOW TRONG LAN GEN HIEN TAI]
Batch nay phai tao dung cac idea trong cua so ${rangeLabel}.
- Khong duoc lap lai scene family da xuat hien o cac cua so truoc.
- Moi idea moi van phai giu dung core user, painpoint, emotion, PSP, target market va angle dang chon.
- Neu da co idea truoc do rat giong ve opening action, location, camera reveal, props hoac cau noi mo dau thi phai doi sang huong khac.\n`;
}

function firstFilterValue(filters: Record<string, unknown>, key: string, fallback: string): string {
  return asStringList(filters[key])[0] || fallback;
}

function buildFallbackIdeasForFilters(options: {
  appName: string;
  filters: unknown;
  quantity: number;
  duration: string;
  startIndex?: number;
  angleIndex: number;
  ideaDescription?: unknown;
}) {
  const filters = asRecord(options.filters);
  const coreUser = firstFilterValue(filters, 'coreUser', 'Selected viewer');
  const painpoint = firstFilterValue(filters, 'painPoint', 'General user friction');
  const emotion = firstFilterValue(filters, 'emotion', 'Curiosity');
  const psp = firstFilterValue(filters, 'solution', options.appName);
  const angleName = firstFilterValue(filters, 'angle', 'Core angle');
  const visualType = firstFilterValue(filters, 'visualType', 'UGC');
  const targetMarket = asStringList(filters.targetMarket).join(', ') || 'selected market';
  const direction = asText(options.ideaDescription) || angleName || painpoint;
  const isInteriorDecorFallback = isInteriorDecorContext({
    appName: options.appName,
    psp,
    pillar: painpoint,
    angle: angleName,
  });
  const normalizedAngleIndex = Math.max(options.angleIndex - 1, 0);
  const patterns = [
    {
      creativeType: 'UGC',
      hookPrimary: 'Why does this keep happening?',
      hookAlt1: 'The blocker is right here',
      hookAlt2: 'Do not miss this signal',
      hookVoice: 'Why does this keep happening every time?',
      bodyVoice: 'Show the exact blocker first, then open the app to capture the same moment in one clear action.',
      ctaVoice: `Track it in ${options.appName}.`,
      bodyOverlay: 'The blocker is visible now',
      ctaOverlay: `Try ${options.appName}`,
      scene: 'a handheld close-up on the exact object or action creating the friction',
    },
    {
      creativeType: 'Reaction',
      hookPrimary: 'One tap makes the problem obvious',
      hookAlt1: 'The reaction tells you everything',
      hookAlt2: 'One capture changes the read',
      hookVoice: 'Wait, one tap made the problem obvious.',
      bodyVoice: 'Cut to the reaction, then show the app action that helps them review the issue clearly.',
      ctaVoice: `Open ${options.appName} and test it.`,
      bodyOverlay: 'One tap, clearer answer',
      ctaOverlay: 'Try it now',
      scene: 'a reaction shot right as the important detail becomes visible on screen',
    },
    {
      creativeType: 'Split Screen',
      hookPrimary: 'Guessing keeps you stuck',
      hookAlt1: 'One side is still stuck',
      hookAlt2: 'The compare makes it clear',
      hookVoice: 'If you do not capture it, you keep guessing.',
      bodyVoice: 'Use a split screen to compare guessing by feeling versus using the app to capture the same issue.',
      ctaVoice: `Compare it in ${options.appName}.`,
      bodyOverlay: 'Guessing vs captured',
      ctaOverlay: 'Compare now',
      scene: 'a split-screen between manual guessing and opening the app to capture the issue',
    },
    {
      creativeType: 'Challenge',
      hookPrimary: 'Did you catch the signal?',
      hookAlt1: 'Most people miss this part',
      hookAlt2: 'Find the blocker first',
      hookVoice: 'Did you catch the signal before I pointed it out?',
      bodyVoice: 'Turn the pain point into a quick challenge, then show how the app captures the detail that was missed.',
      ctaVoice: `Check it in ${options.appName}.`,
      bodyOverlay: 'Spot the signal',
      ctaOverlay: 'Check it now',
      scene: 'a challenge-style opening where the signal is visible before it is explained',
    },
    {
      creativeType: 'Social Proof',
      hookPrimary: 'Everyone notices too late',
      hookAlt1: 'This comment got it right',
      hookAlt2: 'The late signal still matters',
      hookVoice: 'Most people only notice this after it repeats too many times.',
      bodyVoice: 'Frame it like a comment reply, then prove it with a simple demo of capturing the real situation.',
      ctaVoice: `Use ${options.appName} the next time it happens.`,
      bodyOverlay: 'The comment was right',
      ctaOverlay: 'Track the next one',
      scene: 'a comment-reply opening followed by a real-life proof moment',
    },
    {
      creativeType: 'ASMR',
      hookPrimary: 'This feels worse than it looks',
      hookAlt1: 'The feeling is finally visible',
      hookAlt2: 'You can hear the problem',
      hookVoice: 'This is why that feeling is more annoying than it looks.',
      bodyVoice: 'Use close texture or sound to make the pain point concrete, then pivot into the app action.',
      ctaVoice: `Make it clearer in ${options.appName}.`,
      bodyOverlay: 'The friction is visible',
      ctaOverlay: 'Make it clear',
      scene: 'a macro texture or close sound cue that makes the friction instantly noticeable',
    },
    {
      creativeType: 'Trend Format',
      hookPrimary: 'Do not miss this signal',
      hookAlt1: 'The signal shows up first',
      hookAlt2: 'One signal explains the rest',
      hookVoice: 'Do not miss this signal again.',
      bodyVoice: 'Use fast trend cuts to repeat the signal, then show how the app captures it.',
      ctaVoice: `Make the signal clear with ${options.appName}.`,
      bodyOverlay: 'Signal first, app next',
      ctaOverlay: 'Make it clear',
      scene: 'fast trend cuts around one repeated visual signal',
    },
    {
      creativeType: 'Interview',
      hookPrimary: 'Did you notice this first?',
      hookAlt1: 'This answer exposes the problem',
      hookAlt2: 'Ask this before guessing',
      hookVoice: 'Did you notice this before it became a problem?',
      bodyVoice: 'Use a quick interview-style question, then prove the answer with the app flow.',
      ctaVoice: `Check it again in ${options.appName}.`,
      bodyOverlay: 'Ask before guessing',
      ctaOverlay: 'Check again',
      scene: 'an interview-style opener where one person points directly at the blocker',
    },
    {
      creativeType: 'UGC',
      hookPrimary: 'The shortcut starts here',
      hookAlt1: 'The shortcut begins in this moment',
      hookAlt2: 'Stop guessing manually',
      hookVoice: 'The shortcut starts in the moment most people skip.',
      bodyVoice: 'Show the slow manual workaround first, then switch to the app to capture it more clearly.',
      ctaVoice: `Try this with ${options.appName}.`,
      bodyOverlay: 'Skip the guessing',
      ctaOverlay: 'Try this',
      scene: 'an over-the-shoulder UGC shot showing the slow manual workaround first',
    },
    {
      creativeType: 'POV',
      hookPrimary: 'Still stuck on this step?',
      hookAlt1: 'This step breaks the flow',
      hookAlt2: 'Here is how to unstick it',
      hookVoice: 'Are you still getting stuck on this step?',
      bodyVoice: 'Move from the stuck moment into a simple flow: notice it, capture it, then review the data.',
      ctaVoice: `Build your tracking flow in ${options.appName}.`,
      bodyOverlay: 'Unstick the step',
      ctaOverlay: 'Build your flow',
      scene: 'a clean POV frame where the viewer sees the blocker from the character perspective',
    },
  ];
  return Array.from({ length: options.quantity }, (_, index) => {
    const displayIndex = (options.startIndex || 0) + index;
    const pattern = patterns[displayIndex % patterns.length];
    const hookVisual = isInteriorDecorFallback
      ? `Mở bằng cảnh quay handheld trong một phòng/không gian thật đang bị kẹt: ${painpoint}. Nhân vật nhìn vào vật hoặc bố cục gây rối trước khi app UI xuất hiện.`
      : `Mở bằng cảnh quay handheld ở một tình huống thật đang bị kẹt: ${painpoint}. Khung hình đầu tiên cho thấy vật thể hoặc hành động gây friction trước khi app UI xuất hiện.`;
    const bodyVisual = isInteriorDecorFallback
      ? `Cho thấy người dùng chụp ảnh/tải ảnh phòng lên ${options.appName}, chọn restyle/design style, rồi hiện render hoặc màn hình so sánh kết quả.`
      : `Cho thấy tình huống bị kẹt trong hai nhịp ngắn, rồi chuyển sang ${options.appName}: mở đúng tính năng, thực hiện một thao tác rõ, và hiện kết quả/proof trên màn hình.`;
    const ctaVisual = isInteriorDecorFallback
      ? `Kết bằng màn hình ${options.appName} lưu style/render đã chọn, nhân vật nhìn lại căn phòng với một hướng decor rõ hơn.`
      : `Kết bằng màn hình ${options.appName} với hành động chính và kết quả rõ ràng, không chuyển sang feature phụ.`;
    const rawIdea = {
      id: `P0-A${normalizedAngleIndex}-I${displayIndex}`,
      title: `Idea ${displayIndex + 1}: ${pattern.hookPrimary}`,
      duration: options.duration,
      creativeType: pattern.creativeType,
      meta: {
        builderVersion: 'prompt_system_builder_v1',
        pillar: painpoint,
        pillarIndex: 0,
        angleName,
        angleType: 'Curiosity',
        angleDesc: direction,
        hookPrimary: pattern.hookPrimary,
        hookAlt1: pattern.hookAlt1,
        hookAlt2: pattern.hookAlt2,
        visualRefNotes: `${visualType} cho ${targetMarket}; mở bằng cảnh thật cho thấy "${painpoint}" trước khi demo app.`,
        talentProfile: coreUser,
        dontDo: 'Do not show a generic app screen without the selected pain-point object or moment.',
        track: visualType.toLowerCase().includes('motion') ? 'C' : 'B',
        trackReason: `Fallback pattern keeps angle "${angleName}" visible through ${pattern.scene}.`,
        priority: 'A',
      },
      framework: {
        coreUser,
        painpoint,
        emotion,
        psp,
      },
      explanation: `Structured fallback because the AI batch returned too few valid ideas. It keeps "${painpoint}" and angle "${angleName}" while changing the opening execution.`,
      hook: {
        durationSeconds: 3,
        visual: hookVisual,
        voice: pattern.hookVoice,
        textOverlay: pattern.hookPrimary,
        viTranslation: `Giữ đúng painpoint "${painpoint}" và mở bằng angle "${angleName}".`,
        viewerProfile: coreUser,
        viewerEmotion: `Người xem thấy ${emotion} vì điểm kẹt xuất hiện trước phần giải thích.`,
        painpointImpact: `Painpoint trở nên cụ thể qua vật thể hoặc hành động đầu tiên.`,
        whyTheyStopScrolling: `Hook đặt câu hỏi trực diện và làm điểm kẹt hiện ra ngay lập tức.`,
      },
      body: {
        visual: bodyVisual,
        voice: pattern.bodyVoice,
        textOverlay: pattern.bodyOverlay,
        viTranslation: `Demo ${psp} như cách giải quyết trực tiếp cho painpoint đã chọn.`,
      },
      cta: {
        visual: ctaVisual,
        voice: pattern.ctaVoice,
        textOverlay: pattern.ctaOverlay,
        viTranslation: `Kêu gọi người xem test đúng tình huống này trong app.`,
        endCard: `${options.appName} - ${psp}`,
      },
    };

    return repairIdeaTrackingFields(
      normalizeIdeaOutput(rawIdea, {
        duration: options.duration,
        appName: options.appName,
        pillar: painpoint,
      }),
      { angleIndex: normalizedAngleIndex, ideaIndex: displayIndex, pillar: painpoint }
    );
  });
}

export async function POST(request: NextRequest) {
  let requestBody: Record<string, unknown> = {};
  try {
    const guard = await guardApiRequest(request, { key: 'generate-ideas', max: 160, windowMs: 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    requestBody = asRecord(await request.json());
    const body = requestBody;
    const mode = asText(body.mode);

    // === MODE: REFINE (AI chỉnh sửa idea có sẵn) ===
    if (mode === 'refine') {
      const originalIdea = asRecord(body.originalIdea);
      const instruction = asText(body.instruction);
      const appName = asText(body.appName) || 'App';
      const appCategory = asText(body.appCategory) || 'General';
      const selectedModel = asText(body.selectedModel) || undefined;
      const originalFramework = asRecord(originalIdea.framework);
      const originalDuration = asText(originalIdea.duration) || '30s';
      const refineFramework = buildFrameworkInjection({
        appName,
        category: appCategory,
        coreUsers: [asText(originalFramework.coreUser)].filter(Boolean),
        primaryEmotion: asText(originalFramework.emotion) || 'Curiosity',
        visualTheme: asText(originalIdea.creativeType) || 'UGC',
        psp: asText(originalFramework.psp) || appName,
        pillars: [asText(originalFramework.painpoint)].filter(Boolean),
        anglesPerPillar: 1,
        ideasPerAngle: 1,
        language: 'User-facing copy must be English; internal visual and production notes can stay Vietnamese',
        priority: 'A',
        extraContext: [
          'Task type: refine an existing idea, do not rewrite unrelated parts.',
          'Preserve the current JSON field structure and keep meta coherent after edits.',
          'Hook must include or preserve meta.pspBridge: the short bridge from viewer emotion/angle to PSP before Body starts.',
        ],
      });
      const refinePrompt = `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

${refineFramework}

## TASK
Refine one existing production brief using the user instruction below.
- Apply only the requested changes.
- Preserve the same problem-solution chain unless the user explicitly changes it.
- Keep or add meta.pspBridge so Hook connects the pain/emotion to the PSP before Body.
- Body is only the demo/proof continuation; do not make Body the first place where PSP becomes relevant.
- Keep visual, voice, and textOverlay separated for hook, body, and CTA.
- Translate or rewrite title, character speech, voice/video voiceover, text overlay, script_vo, and CTA into natural English.
- Return exactly 1 JSON object, not an array.

[EXISTING IDEA JSON]
${JSON.stringify(originalIdea, null, 2)}

[USER REFINE BRIEF]
"${instruction}"

## OBJECT SCHEMA
Use the same field schema as one item from the standard idea output spec:
${buildIdeaOutputSpec({ quantity: 1, duration: originalDuration, appName, language: 'English' })}

For this refine task, return only the single object body, not the surrounding array.

${CREATIVE_PROMPT_RULES}
${TOOL_COMPATIBILITY_GUARDRAILS}`;

      const text = await askAI(refinePrompt, {
        model: resolveModel(selectedModel),
        temperature: 0.7,
        max_tokens: 8192,
        useCreativePersona: false,
        priority: 'high',
      });
      if (!text) {
        return NextResponse.json({
          success: true,
          data: buildRefineEmergencyFallback(body),
          meta: {
            warnings: ['Refine AI returned null; backend returned a schema-safe fallback using the current idea.'],
            fallbackCount: 1,
          },
        });
      }
      const parsed = parseJson(text);
      if (!parsed) {
        return NextResponse.json({
          success: true,
          data: buildRefineEmergencyFallback(body),
          meta: {
            warnings: ['Refine AI returned non-JSON output; backend returned a schema-safe fallback using the current idea.'],
            fallbackCount: 1,
          },
        });
      }
      return NextResponse.json({
        success: true,
        data: normalizeIdeaOutput(parsed, {
          duration: originalDuration,
          appName,
          pillar: asText(originalFramework.painpoint),
        }),
      });
    }

    // === MODE: GENERATE ANGLES (tạo angle từ painpoint) ===
    if (mode === 'generate-angles') {
      const appName = asText(body.appName) || 'App';
      const appCategory = asText(body.appCategory) || 'App';
      const painpoints = asStringList(body.painpoints);
      const coreUsers = asStringList(body.coreUsers);
      const emotions = asStringList(body.emotions);
      const pps = painpoints.join('; ');
      const anglePrompt = `Tạo angle quảng cáo cho app "${appName}" (${appCategory}).
Painpoints: ${pps}
Core Users: ${coreUsers.join('; ')}
Emotions: ${emotions.join('; ')}

Yêu cầu:
1. Mỗi angle PHẢI bám trực tiếp vào painpoint đã chọn, không được trượt sang painpoint khác.
2. Emotion chỉ là cảm xúc cần trigger cho viewer, KHÔNG dùng emotion làm nhãn prefix cho angle.
3. KHÔNG viết kiểu "Fear:", "FOMO:", "Challenge:", "Social Proof:" ở đầu angle.
4. Output phải ngắn, thực tế, nghe như một góc mở video UGC đời thường, không quảng cáo hóa sớm.
5. Không viết CTA, không khoe app, không nói "ai cũng đang dùng", không slogan.
6. Mỗi angle 8-14 từ, khác nhau về tình huống mở đầu nhưng vẫn cùng painpoint.

Ví dụ đúng:
["Lưu cả trăm ảnh đẹp mà bathroom nhà mình vẫn bí ý tưởng", "Muốn sửa bathroom nhưng chẳng biết style nào hợp nhà mình"]

Trả JSON array of strings. KHÔNG markdown.`;

      try {
        // Use fast model with short timeout (3-7s instead of 20-30s)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(getAIChatCompletionsUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAIApiKey()}`,
          },
          body: JSON.stringify({
            model: 'openai/gpt-5.4',
            messages: [{ role: 'user', content: anglePrompt }],
            temperature: 0.7,
            max_tokens: 1024,
            stream: false,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content;
          if (text) {
            const parsed = parseJson(text);
            if (Array.isArray(parsed) && parsed.length > 0) {
              return NextResponse.json({ success: true, angles: parsed });
            }
          }
        }
      } catch (e) {
        console.error('[generate-angles] AI error:', e);
      }
      // Fallback: generate locally
      const fallback = painpoints.flatMap((pp) => [
        `${pp} nhưng bạn vẫn chưa biết bắt đầu từ đâu`,
        `${pp} và mỗi lần nhìn vào nhà lại càng rối hơn`,
        `${pp} dù đã xem rất nhiều ý tưởng đẹp trên mạng`,
      ]);
      return NextResponse.json({ success: true, angles: fallback });
    }

    if (mode !== 'refine' && mode !== 'generate-angles') {
      const appName = asText(body.appName) || 'App';
      const appCategory = asText(body.appCategory) || 'General';
      const filters = asRecord(body.filters);
      const config = asRecord(body.config);
      const previousIdeas = asText(body.previousIdeas);
      const appKnowledge = asText(body.appKnowledge);
      const useCreativeRulesV7 = shouldUseCreativeRulesV7(appName, appKnowledge);
      const usePromptSystemBuilderHtml = !useCreativeRulesV7 && shouldUsePromptSystemBuilderHtml(appKnowledge);
      const creativeRuleset: 'default' | 'v7' | 'builder' = useCreativeRulesV7
        ? 'v7'
        : usePromptSystemBuilderHtml
          ? 'builder'
          : 'default';
      const selectedModel = asText(body.selectedModel) || undefined;
      const trendingTopics = asStringList(body.trendingTopics);
      const trendingStructures = asStringList(body.trendingStructures);
      const solutionValues = asStringList(filters.solution);
      const coreUserValues = asStringList(filters.coreUser);
      const emotionValues = asStringList(filters.emotion);
      const targetMarketValues = asStringList(filters.targetMarket);
      const angleValues = asStringList(filters.angle);
      const painPointValues = asStringList(filters.painPoint);
      const featureContext = solutionValues.length ? solutionValues.join(', ') : 'General App Features';
      const requestedQuantity = Math.min(toPositiveInt(config.quantity, 3), MAX_IDEAS_PER_REQUEST);
      const duration = asText(config.duration) || 'Short social-first runtime';
      const visualType = asText(config.visualType) || 'UGC (Người thật)';
      const targetLang = detectMarketLang(targetMarketValues, coreUserValues);
      const outputLanguage = useCreativeRulesV7 ? 'Vietnamese' : 'English';
      const marketContext = buildMarketContext(targetMarketValues);
      const angleContext = angleValues.length ? angleValues.join(', ') : '';
      const primaryPillar = painPointValues[0] || 'General user friction';
      const angleIndex = Number(config.angleIndex || 1);
      const totalAngles = Number(config.totalAngles || 1);
      const requestStartIndex = Math.max(0, Number(config.startIndex || 0) || 0);
      const totalVariations = Math.max(requestedQuantity, Number(config.totalVariations || requestedQuantity) || requestedQuantity);
      const modelCandidates = resolveIdeaModels(selectedModel).slice(0, MAX_IDEA_MODEL_CANDIDATES);
      const ideaDescription = asText(config.ideaDescription) || undefined;
      const batchPlans = buildIdeaBatchPlans(requestedQuantity);
      const aiBudgetStartedAt = Date.now();
      const getRemainingAiBudgetMs = () => GENERATE_IDEAS_REQUEST_AI_BUDGET_MS - (Date.now() - aiBudgetStartedAt);
      const hasAiBudget = () => getRemainingAiBudgetMs() >= GENERATE_IDEAS_MIN_CALL_TIMEOUT_MS;
      const getBudgetedTimeoutMs = (timeoutMs: number) => Math.max(
        GENERATE_IDEAS_MIN_CALL_TIMEOUT_MS,
        Math.min(timeoutMs, getRemainingAiBudgetMs())
      );
      const metricLock = getPrimarySolutionMetric(solutionValues);
      const filterConsistencyBlock = buildFilterConsistencyPromptBlock({
        solutionValues,
        angleValues,
        painPointValues,
      });

      const truncatedKnowledge = clampPromptContext(appKnowledge, GENERATE_IDEAS_CONTEXT_CHAR_LIMIT);
      const truncatedPreviousIdeas = clampPromptContext(previousIdeas, GENERATE_IDEAS_HISTORY_CHAR_LIMIT);
      const knowledgeBlock = truncatedKnowledge
        ? `\n[APP BRAIN - learned context for "${appName}"]\n${truncatedKnowledge}\n`
        : '';
      const recentIdeasBlock = truncatedPreviousIdeas
        ? `\n[RECENT SAVED IDEAS - learn style, do not repeat]\n${truncatedPreviousIdeas}\n`
        : '';
      const trendingBlock = trendingTopics.length
        ? `\n[TRENDING CONTEXT]\n${trendingTopics.join(', ')}\nUse trends only when they naturally fit the selected pain point and emotion.\n`
        : '';
      const structuredTrendNotes = trendingStructures.slice(0, 4);
      const importedTrendBlock = structuredTrendNotes.length
        ? `\n[IMPORTED VIDEO STRUCTURE]\n${structuredTrendNotes.join('\n')}\nLearn pacing and treatment, but do not copy the source structure verbatim.\n`
        : '';
      const seasonalVisualBlock = buildSeasonalVisualBlock(config.seasonalVisualContext);
      const winningPatternBlock = buildWinningPatternLibraryBlock({
        appName,
        category: appCategory,
        psp: featureContext,
        painpoint: primaryPillar,
        angle: angleContext,
      });

      const refillIdeasOneByOne = async (
        missingCount: number,
        batchStartIndex: number,
        priorGeneratedIdeas: Record<string, unknown>[],
        reasonLabel: string
      ) => {
        const recovered: Record<string, unknown>[] = [];

        for (let offset = 0; offset < missingCount; offset += 1) {
          const recoveryPlan: IdeaBatchPlan = {
            batchQuantity: 1,
            batchStartIndex: batchStartIndex + offset,
          };

          try {
            const recoveredBatch = await runGenerationBatch(
              recoveryPlan,
              [...priorGeneratedIdeas, ...recovered]
            );
            if (recoveredBatch.length > 0) {
              recovered.push(recoveredBatch[0]);
            }
          } catch (recoveryError) {
            const slotLabel = requestStartIndex + recoveryPlan.batchStartIndex + 1;
            console.error(`[generate-ideas] Recovery slot ${slotLabel}/${requestedQuantity} failed:`, recoveryError);
            batchErrors.push(
              recoveryError instanceof Error
                ? `Recovery ${slotLabel}/${requestedQuantity} after ${reasonLabel} failed: ${recoveryError.message}`
                : `Recovery ${slotLabel}/${requestedQuantity} after ${reasonLabel} failed: Unknown recovery error`
            );
          }
        }

        return recovered;
      };

      const runGenerationBatch = async (
        plan: IdeaBatchPlan,
        priorGeneratedIdeas: Record<string, unknown>[]
      ) => {
        const inRequestHistory = buildInRequestIdeaHistory(priorGeneratedIdeas);
        const inRequestHistoryBlock = inRequestHistory
          ? `\n[IDEAS ALREADY GENERATED IN THIS SAME REQUEST]\n${inRequestHistory}\nAvoid repeating these scene families, hook reveals, and voice openings.\n`
          : '';
        const slotStartIndex = requestStartIndex + plan.batchStartIndex;
        const variationBlock = buildVariationWindowBlock(
          slotStartIndex,
          plan.batchQuantity,
          totalVariations
        );
        const diversityBlock = buildBatchDiversityBlock(
          plan.batchQuantity,
          angleContext,
          angleIndex,
          totalAngles
        );
        const singleIdeaSlotBlock = buildSingleIdeaSlotBlock(
          slotStartIndex + 1,
          totalVariations,
          {
            angle: angleContext,
            painpoint: primaryPillar,
            psp: featureContext,
            visualType,
          }
        );

        const painpointPrecisionBlock = useCreativeRulesV7
          ? buildV7ExecutionContract({
              appName,
              coreUserValues,
              primaryPillar,
              angleContext,
              featureContext,
              targetMarketValues,
              targetLang,
              copyLanguage: outputLanguage,
              visualType,
              ideaDescription,
            })
          : `
## PAINPOINT PRECISION CONTRACT
- Exact core user: ${coreUserValues.join('; ') || 'General viewer'}
- Exact pain point pillar: ${primaryPillar}
- Exact angle focus: ${angleContext || 'No locked angle'}
- Exact PSP/app action: ${featureContext}
- User direction: ${ideaDescription || 'None'}

Hard requirements:
- Do not reduce the pain point to a broad symptom. The hook and visual_scene_1 must include at least 2 concrete anchors from the selected pain point/angle, such as trigger moment, body signal, suspected cause, location, object, or user fear.
- The first 3 seconds must show WHY this user cares now, not just that the symptom exists.
- visual_scene_2 must show the selected PSP/app action solving or organizing the same problem. Do not jump to a generic app demo.
- If this is a health/wellness app, position the app as tracking/logging/understanding trends only. Never diagnose, treat, detect disease, promise prevention, or imply before/after health improvement.
- If the PSP is a health tracker, hook_primary may be human/emotional, but visual_scene_1 or hook_alt must name the actual tracked concern/metric from the selected PSP/pain point. Do not stop at a generic symptom like "dizzy", "tired", or "worried".
- Avoid search-query hooks like "Huyết áp thấp có làm tôi choáng khi đứng dậy không?" Make hook_primary feel like a lived moment, confession, or tension line.
- Better lived-moment health hook style examples in ${outputLanguage}: "I thought it was just my age." / "The dizzy moment was not the scariest part." / "My morning started with a sudden pause."
- Hook execution must not be a copy-paste stack: hook_primary is the headline, hook_text_overlay is the readable screen text, and hook_voiceover or hook_character_speech must add a different lived detail. If nobody visibly speaks, hook_character_speech must be an empty string.
- Hook must sell through to PSP: include psp_bridge so the viewer understands why the app/action is the next natural step before the Body section starts.
- Body is only a suggested demo/proof continuation. Do not rely on Body alone to explain why the PSP matters.
- For multiple ideas, every hook_primary must be meaningfully different. Do not reuse "Why do I..." or the same sentence frame across the batch.`;

        const frameworkInjection = buildFrameworkInjection({
          appName,
          category: appCategory,
          coreUsers: coreUserValues,
          primaryEmotion: emotionValues[0] || 'Curiosity',
          visualTheme: `${visualType}. Keep the scenes native to ${targetMarketValues.join(', ') || 'the selected market'}.`,
          psp: featureContext,
          pillars: painPointValues.length ? painPointValues : ['General user friction'],
          trendingHooks: trendingTopics,
          performanceData: [
            truncatedKnowledge ? 'AI Brain memory block attached below in supporting context.' : 'No AI Brain memory yet',
            truncatedPreviousIdeas ? 'Recent idea history block attached below in supporting context.' : 'No recent saved ideas',
            inRequestHistory ? 'Earlier ideas in this request are attached below in supporting context.' : 'No earlier ideas inside this request',
            structuredTrendNotes.length ? 'Imported video structure examples are attached below in supporting context.' : 'No imported video structure',
            'Reference video DNA is attached below as examples only. Ideas may use, hybridize, or invent a better structure cue.',
            angleContext ? `Angle focus: ${angleContext}` : 'No locked angle',
          ],
          doList: [
            'Keep every idea production-ready and executable today',
            'Stay social-first, UGC-friendly, and market-native',
            'Differentiate opening action, blocker, reveal, and voice opening across ideas',
            'Use a mixed creativeType spread; POV is allowed only once per selected angle unless the user explicitly selected POV-only visual type',
          ],
          dontList: [
            'Do not drift away from the selected pain point',
            'Do not output cinematic brand-film copy',
            'Do not repeat the same scene family with new wording',
            'Do not label several ideas as POV just because they are shot handheld',
          ],
          anglesPerPillar: 1,
          ideasPerAngle: plan.batchQuantity,
          trackRule: 'A = no real person needed | B = real person / UGC | C = motion / animation',
          language: useCreativeRulesV7
            ? `User-facing copy in ${outputLanguage}. Internal visual and production notes in Vietnamese.`
            : usePromptSystemBuilderHtml
              ? `Prompt System Builder HTML V1. User-facing copy in ${outputLanguage}; internal visual and production notes in Vietnamese.`
              : `User-facing copy in ${outputLanguage}; internal visual and production notes in Vietnamese.`,
          priority: 'A',
          extraContext: [
            `Selected angle: ${angleContext || 'Creative freedom'}`,
            `Idea description: ${ideaDescription || 'Creative freedom'}`,
            `Target market: ${targetMarketValues.join(', ') || 'Default market'}`,
            `Batch window: ${requestStartIndex + plan.batchStartIndex + 1}-${requestStartIndex + plan.batchStartIndex + plan.batchQuantity}/${totalVariations}`,
          ],
        });

        const outputSpec = buildCreativeBriefOutputSpec({
          quantity: plan.batchQuantity,
          duration,
          appName,
          language: outputLanguage,
          ruleset: creativeRuleset,
        });
        const rulesBlock = useCreativeRulesV7
          ? `${CREATIVE_ADS_GENERATION_RULES_V7}

${buildV7TaskDirectives(plan.batchQuantity, outputLanguage)}`
          : usePromptSystemBuilderHtml
            ? `${PROMPT_SYSTEM_BUILDER_RULES}
${PROMPT_SYSTEM_BUILDER_COMPATIBILITY_GUARDRAILS}`
          : `${CREATIVE_PROMPT_RULES}
${TOOL_COMPATIBILITY_GUARDRAILS}`;

        const taskDirectives = useCreativeRulesV7
          ? buildV7TaskDirectives(plan.batchQuantity, outputLanguage)
          : usePromptSystemBuilderHtml
            ? `Generate ${plan.batchQuantity} production-ready full ideas for the selected filter combination.
- Follow PROMPT_SYSTEM_BUILDER_HTML_V1 exactly.
- Return exactly 1 top-level pillar object, exactly 1 angle object, and exactly ${plan.batchQuantity} ideas.
- Keep hook_primary under 12 words.
- Every idea must include visual_scene_1, visual_scene_2, visual_scene_3, script_vo, cta_text, visual_ref_notes, talent_profile, dont_do, track, track_reason, priority.
- User-facing copy must be ${outputLanguage}; visual scenes and production notes must be Vietnamese. Target market affects local setting and vibe only.
- Each idea must stay inside the selected pain point, selected PSP, selected angle, and selected visual type.`
          : `Generate ${plan.batchQuantity} production-ready full ideas for the selected filter combination.
- Duration: ${duration}
- The final target for this selected angle is ${totalVariations} ideas. This API call only covers items ${requestStartIndex + plan.batchStartIndex + 1}-${requestStartIndex + plan.batchStartIndex + plan.batchQuantity}.
- Each idea must stay inside the selected pillar and selected angle focus.
- Treat the selected angle as one narrow manifestation of the selected pain point, not a replacement for it.
- If an angle is selected, the hook must make that angle visible immediately through the first action, first spoken line, or first contrast.
- Hook must include psp_bridge so the pain/emotion connects to the PSP before the Body section.
- Hook, body, and CTA must follow one continuous problem-solution chain.
- Body is a suggested demo/proof continuation; do not rely on Body alone to explain why the PSP matters.
- If multiple ideas are requested, diversify them aggressively while keeping the same strategic inputs.
- Creative type cap: output at most 1 POV idea in this batch. Use UGC, Reaction, Split Screen, Challenge, Social Proof, ASMR, Interview, or Trend Format for the rest.
- Production blueprint: each idea must include reference_pattern, interrupt_mechanism, first_frame_asset, psp_bridge, proof_object, app_demo_action, overlay_sequence, and edit_notes. reference_pattern can be custom/hybrid. psp_bridge belongs to Hook and must connect the emotion/angle to the PSP. The remaining fields must be concrete enough for a creator to edit the video without asking follow-up questions.`;

        const prompt = `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

${frameworkInjection}

## SUPPORTING CONTEXT
${knowledgeBlock || '- No AI Brain memory yet.'}
${recentIdeasBlock || '- No recent saved ideas.'}
${inRequestHistoryBlock || '- No earlier ideas in this request.'}
${trendingBlock || '- No trending hooks injected.'}
${importedTrendBlock || ''}
${winningPatternBlock}
${marketContext}
${seasonalVisualBlock || ''}
${variationBlock || ''}
${diversityBlock || ''}
${singleIdeaSlotBlock || ''}
${painpointPrecisionBlock}
${filterConsistencyBlock || ''}

## TASK
${taskDirectives}

${outputSpec}

${rulesBlock}`;

        console.log(
          '[generate-ideas] Batch prompt:',
          `${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity}/${requestedQuantity}`,
          'chars:',
          prompt.length,
          'model:',
          modelCandidates[0]
        );

        const responseTokenBudget = getIdeaResponseTokenBudget(plan.batchQuantity);
        let text: string | null = null;
        let parsed: unknown = null;
        let modelUsed = modelCandidates[0];
        let modelUsedIndex = 0;

        for (const [candidateIndex, model] of modelCandidates.entries()) {
          if (!hasAiBudget()) break;
          const candidateTimeoutMs = candidateIndex === 0
            ? getIdeaBatchTimeoutMs(model, plan.batchQuantity)
            : GENERATE_IDEAS_RETRY_TIMEOUT_MS;
          const candidateText = await askAI(prompt, {
            model,
            temperature: plan.batchQuantity > 1 ? 0.82 : 0.75,
            max_tokens: responseTokenBudget,
            useCreativePersona: false,
            priority: 'high',
            timeoutMs: getBudgetedTimeoutMs(candidateTimeoutMs),
          });

          if (!candidateText) {
            const aiError = getAIGenerationErrorMessage();
            if (isNonRecoverableAIGenerationError(aiError)) break;
            continue;
          }

          const candidateParsed = parseJson(candidateText);
          if (candidateParsed !== null) {
            text = candidateText;
            parsed = candidateParsed;
            modelUsed = model;
            modelUsedIndex = candidateIndex;
            break;
          }

          console.warn('[generate-ideas] Parse failed for model candidate:', model);
        }

        if (!text) {
          throw new Error(getAIGenerationErrorMessage());
        }

        if (!parsed) {
          console.error('[generate-ideas] Failed to parse:', text.substring(0, 300));
          throw new Error('Không parse được response. Thử lại.');
        }

        let parsedPreview: unknown = parsed;
        let briefOutput = normalizeCreativeBriefOutput(parsed, {
          duration,
          appName,
          pillar: primaryPillar,
          coreUser: coreUserValues.join('; ') || 'General viewer',
          emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
          psp: featureContext,
          angle: angleContext,
          ideaDescription,
          language: outputLanguage,
          ruleset: creativeRuleset,
        });
        let validation = normalizeAndValidateIdeas(briefOutput.items, {
          duration,
          appName,
          category: appCategory,
          psp: featureContext,
          angle: angleContext,
          pillar: primaryPillar,
          angleIndex: Math.max(angleIndex - 1, 0),
          ideaStartIndex: requestStartIndex + plan.batchStartIndex,
          metricLock,
        });
        validation.invalidReasons.unshift(...briefOutput.invalidReasons);
        let valid = dedupeIdeas(validation.valid, priorGeneratedIdeas).slice(0, plan.batchQuantity);
        const duplicateDetected = valid.length > 1 && hasNearDuplicateIdeas(valid);
        const needsValidationRetry = validation.invalidReasons.length > 0 || valid.length < plan.batchQuantity;

        if ((needsValidationRetry || duplicateDetected) && hasAiBudget()) {
          if (validation.invalidReasons.length > 0) {
            console.warn('[generate-ideas] Invalid ideas detected:', validation.invalidReasons);
          }
          if (duplicateDetected) {
            console.warn('[generate-ideas] Near-duplicate batch detected; retrying with stricter diversity prompt');
          }

          const retryNotes: string[] = [];
          if (validation.invalidReasons.length > 0) {
            retryNotes.push(`Fix these rule violations:\n- ${validation.invalidReasons.slice(0, 5).join('\n- ')}`);
          }
          if (duplicateDetected) {
            retryNotes.push(`The previous batch contains ideas that are too similar. Regenerate all ${plan.batchQuantity} ideas with clearly different scene families, opening actions, props, camera reveals, voice openings, and creative types.`);
          }
          if (valid.length < plan.batchQuantity) {
            retryNotes.push('Too many ideas reused the same creativeType or POV. Keep POV to max 1 and fill the rest with non-POV formats.');
          }

          const retryText = await askAI(`${prompt}

[RETRY - INVALID OR TOO WEAK]
Regenerate all ${plan.batchQuantity} ideas and obey the hard rules strictly.
${retryNotes.join('\n\n')}`, {
            model: modelUsed,
            temperature: 0.9,
            max_tokens: responseTokenBudget,
            useCreativePersona: false,
            priority: 'high',
            timeoutMs: getBudgetedTimeoutMs(GENERATE_IDEAS_RETRY_TIMEOUT_MS),
          });

          if (retryText) {
            const retryParsed = parseJson(retryText);
            const retryBriefOutput = normalizeCreativeBriefOutput(retryParsed, {
              duration,
              appName,
              pillar: primaryPillar,
              coreUser: coreUserValues.join('; ') || 'General viewer',
              emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
              psp: featureContext,
              angle: angleContext,
              ideaDescription,
              language: outputLanguage,
              ruleset: creativeRuleset,
            });
            const retryValidation = normalizeAndValidateIdeas(retryBriefOutput.items, {
              duration,
              appName,
              category: appCategory,
              psp: featureContext,
              angle: angleContext,
              pillar: primaryPillar,
              angleIndex: Math.max(angleIndex - 1, 0),
              ideaStartIndex: requestStartIndex + plan.batchStartIndex,
              metricLock,
            });
            retryValidation.invalidReasons.unshift(...retryBriefOutput.invalidReasons);
            const retryValid = dedupeIdeas(retryValidation.valid, priorGeneratedIdeas).slice(0, plan.batchQuantity);
            const retryHasDuplicates = retryValid.length > 1 && hasNearDuplicateIdeas(retryValid);

            const shouldUseRetry = retryValid.length > valid.length
              || (valid.length === 0 && retryValid.length > 0)
              || (duplicateDetected && retryValid.length > 0 && !retryHasDuplicates);

            if (shouldUseRetry && (retryValid.length > 0 || retryValidation.invalidReasons.length === 0)) {
              parsedPreview = retryParsed;
              briefOutput = retryBriefOutput;
              validation = retryValidation;
              valid = retryValid;
            }
          }
        }

        if (valid.length < plan.batchQuantity && modelCandidates.length > modelUsedIndex + 1 && hasAiBudget()) {
          for (const [fallbackOffset, fallbackModel] of modelCandidates.slice(modelUsedIndex + 1).entries()) {
            if (!hasAiBudget()) break;
            const fallbackText = await askAI(`${prompt}

[MODEL FALLBACK - PREVIOUS MODEL OUTPUT WAS INVALID OR SHORT]
Return exactly ${plan.batchQuantity} ideas. Keep the selected pain point and angle visible in the first scene.
Do not output local fallback/template ideas. Do not make health claims.`, {
              model: fallbackModel,
              temperature: plan.batchQuantity > 1 ? 0.84 : 0.76,
              max_tokens: responseTokenBudget,
              useCreativePersona: false,
              priority: 'high',
              timeoutMs: getBudgetedTimeoutMs(GENERATE_IDEAS_RETRY_TIMEOUT_MS),
            });

            if (!fallbackText) {
              const aiError = getAIGenerationErrorMessage();
              if (isNonRecoverableAIGenerationError(aiError)) break;
              continue;
            }

            const fallbackParsed = parseJson(fallbackText);
            if (!fallbackParsed) {
              console.warn('[generate-ideas] Parse failed for fallback model candidate:', fallbackModel);
              continue;
            }

            const fallbackBriefOutput = normalizeCreativeBriefOutput(fallbackParsed, {
              duration,
              appName,
              pillar: primaryPillar,
              coreUser: coreUserValues.join('; ') || 'General viewer',
              emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
              psp: featureContext,
              angle: angleContext,
              ideaDescription,
              language: outputLanguage,
              ruleset: creativeRuleset,
            });
            const fallbackValidation = normalizeAndValidateIdeas(fallbackBriefOutput.items, {
              duration,
              appName,
              category: appCategory,
              psp: featureContext,
              angle: angleContext,
              pillar: primaryPillar,
              angleIndex: Math.max(angleIndex - 1, 0),
              ideaStartIndex: requestStartIndex + plan.batchStartIndex,
              metricLock,
            });
            fallbackValidation.invalidReasons.unshift(...fallbackBriefOutput.invalidReasons);
            const fallbackValid = dedupeIdeas(fallbackValidation.valid, priorGeneratedIdeas).slice(0, plan.batchQuantity);
            const fallbackHasDuplicates = fallbackValid.length > 1 && hasNearDuplicateIdeas(fallbackValid);

            if (
              fallbackValid.length > valid.length
              || (fallbackValid.length === valid.length && valid.length > 0 && !fallbackHasDuplicates)
            ) {
              parsedPreview = fallbackParsed;
              briefOutput = fallbackBriefOutput;
              validation = fallbackValidation;
              valid = fallbackValid;
              modelUsed = fallbackModel;
              modelUsedIndex = modelUsedIndex + 1 + fallbackOffset;
            }

            if (valid.length >= plan.batchQuantity && !fallbackHasDuplicates) break;
          }
        }

        if (valid.length === 0) {
          console.error('[generate-ideas] No valid ideas:', JSON.stringify(briefOutput.items[0] || parsedPreview).substring(0, 200));
          if (validation.invalidReasons.length > 0) {
            console.error('[generate-ideas] Validation failures:', validation.invalidReasons);
          }
          throw new Error('AI trả về format sai. Thử lại.');
        }

        return valid.slice(0, plan.batchQuantity).map((idea, localIndex) => repairIdeaTrackingFields(
          idea,
          {
            angleIndex: Math.max(angleIndex - 1, 0),
            ideaIndex: requestStartIndex + plan.batchStartIndex + localIndex,
            pillar: primaryPillar,
          }
        ));
      };

      const aggregatedIdeas: Record<string, unknown>[] = [];
      const batchErrors: string[] = [];
      let fallbackCount = 0;
      const shouldUseAiRefill = ENABLE_AI_RECOVERY_REFILL;
      const shouldUseLocalFallback = ENABLE_LOCAL_FALLBACK_TOPUP;

      for (const plan of batchPlans) {
        try {
          if (!hasAiBudget()) {
            throw new Error('AI request time budget was exhausted before this batch.');
          }
          const batchIdeas = await runGenerationBatch(plan, aggregatedIdeas);
          if (batchIdeas.length < plan.batchQuantity) {
            const missingCount = plan.batchQuantity - batchIdeas.length;
            const shouldRecoverShortBatch = shouldUseAiRefill && !batchErrors.some(isNonRecoverableAIGenerationError);
            const recoveredIdeas = shouldRecoverShortBatch
              ? await refillIdeasOneByOne(
                  missingCount,
                  plan.batchStartIndex + batchIdeas.length,
                  [...aggregatedIdeas, ...batchIdeas],
                  `batch ${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity} returned too few ideas`
                )
              : [];
            batchIdeas.push(...recoveredIdeas);

            const stillMissing = plan.batchQuantity - batchIdeas.length;
            let fallbackAdded = 0;
            if (shouldUseLocalFallback && stillMissing > 0) {
              const fallbackIdeas = buildFallbackIdeasForFilters({
                appName,
                filters,
                quantity: stillMissing,
                duration,
                startIndex: requestStartIndex + plan.batchStartIndex + batchIdeas.length,
                angleIndex,
                ideaDescription,
              });
              batchIdeas.push(...fallbackIdeas);
              fallbackAdded = fallbackIdeas.length;
              fallbackCount += fallbackIdeas.length;
            }

            batchErrors.push(
              `Batch ${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity} was short; AI refill added ${recoveredIdeas.length}, fallback added ${fallbackAdded}.`
            );
          }
          aggregatedIdeas.push(...batchIdeas.slice(0, plan.batchQuantity));
        } catch (batchError) {
          const rangeLabel = `${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity}/${requestedQuantity}`;
          console.error(`[generate-ideas] Batch ${rangeLabel} failed:`, batchError);
          const batchErrorMessage = batchError instanceof Error
            ? batchError.message
            : 'Unknown batch error';
          const shouldRecoverBatch = shouldUseAiRefill && !isNonRecoverableAIGenerationError(batchErrorMessage);
          const recoveredIdeas = shouldRecoverBatch
            ? await refillIdeasOneByOne(
                plan.batchQuantity,
                plan.batchStartIndex,
                aggregatedIdeas,
                rangeLabel
              )
            : [];
          aggregatedIdeas.push(...recoveredIdeas);

          const stillMissing = plan.batchQuantity - recoveredIdeas.length;
          let fallbackAdded = 0;
          if (shouldUseLocalFallback && stillMissing > 0) {
            const fallbackIdeas = buildFallbackIdeasForFilters({
              appName,
              filters,
              quantity: stillMissing,
              duration,
              startIndex: requestStartIndex + plan.batchStartIndex + recoveredIdeas.length,
              angleIndex,
              ideaDescription,
            });
            aggregatedIdeas.push(...fallbackIdeas);
            fallbackAdded = fallbackIdeas.length;
            fallbackCount += fallbackIdeas.length;
          }

          batchErrors.push(
            `${rangeLabel}: ${batchErrorMessage}. AI refill added ${recoveredIdeas.length}, fallback added ${fallbackAdded}.`
          );
        }
      }

      if (aggregatedIdeas.length < requestedQuantity) {
        const missingCount = requestedQuantity - aggregatedIdeas.length;
        const shouldRecoverFinalTopUp = shouldUseAiRefill && !batchErrors.some(isNonRecoverableAIGenerationError);
        const recoveredIdeas = shouldRecoverFinalTopUp
          ? await refillIdeasOneByOne(
              missingCount,
              aggregatedIdeas.length,
              aggregatedIdeas,
              'final top-up'
            )
          : [];
        aggregatedIdeas.push(...recoveredIdeas);

        const stillMissing = requestedQuantity - aggregatedIdeas.length;
        let fallbackAdded = 0;
        if (shouldUseLocalFallback && stillMissing > 0) {
          const finalTopUp = buildFallbackIdeasForFilters({
            appName,
            filters,
            quantity: stillMissing,
            duration,
            startIndex: requestStartIndex + aggregatedIdeas.length,
            angleIndex,
            ideaDescription,
          });
          aggregatedIdeas.push(...finalTopUp);
          fallbackAdded = finalTopUp.length;
          fallbackCount += finalTopUp.length;
        }

        batchErrors.push(
          `Backend final top-up: AI refill added ${recoveredIdeas.length}, fallback added ${fallbackAdded}.`
        );
      }

      if (aggregatedIdeas.length === 0) {
        const terminalError = batchErrors.find(isNonRecoverableAIGenerationError)
          || 'AI chưa tạo được idea hợp lệ. Vui lòng thử lại hoặc đổi model.';
        return NextResponse.json({
          success: false,
          error: terminalError,
          meta: {
            requestedQuantity,
            generatedQuantity: 0,
            batchCount: batchPlans.length,
            partial: true,
            fallbackCount,
            warnings: batchErrors.length > 0 ? batchErrors : undefined,
          },
        }, { status: 502 });
      }

      const finalIdeas = aggregatedIdeas.slice(0, requestedQuantity).map((idea, index) => repairIdeaTrackingFields(
        idea,
        {
          angleIndex: Math.max(angleIndex - 1, 0),
          ideaIndex: requestStartIndex + index,
          pillar: primaryPillar,
        }
      ));
      return NextResponse.json({
        success: true,
        data: finalIdeas,
        meta: {
          requestedQuantity,
          generatedQuantity: finalIdeas.length,
          batchCount: batchPlans.length,
          partial: finalIdeas.length < requestedQuantity,
          fallbackCount,
          warnings: batchErrors.length > 0 ? batchErrors : undefined,
        },
      });
    }

    // === MODE: GENERATE (tạo idea mới) ===
    const appName = asText(body.appName) || 'App';
    const appCategory = asText(body.appCategory) || 'General';
    const filters = asRecord(body.filters);
    const config = asRecord(body.config);
    const previousIdeas = asText(body.previousIdeas);
    const appKnowledge = asText(body.appKnowledge);
    const useCreativeRulesV7 = shouldUseCreativeRulesV7(appName, appKnowledge);
    const usePromptSystemBuilderHtml = !useCreativeRulesV7 && shouldUsePromptSystemBuilderHtml(appKnowledge);
    const creativeRuleset: 'default' | 'v7' | 'builder' = useCreativeRulesV7
      ? 'v7'
      : usePromptSystemBuilderHtml
        ? 'builder'
        : 'default';
    const selectedModel = asText(body.selectedModel) || undefined;
    const trendingTopics = asStringList(body.trendingTopics);
    const trendingStructures = asStringList(body.trendingStructures);
    const solutionValues = asStringList(filters.solution);
    const coreUserValues = asStringList(filters.coreUser);
    const emotionValues = asStringList(filters.emotion);
    const targetMarketValues = asStringList(filters.targetMarket);
    const angleValues = asStringList(filters.angle);
    const painPointValues = asStringList(filters.painPoint);
    const featureContext = solutionValues.length ? solutionValues.join(', ') : "General App Features";
    const quantity = Math.min(toPositiveInt(config.quantity, 3), 5); // Cap at 5 to avoid gateway timeout
    const duration = asText(config.duration) || 'Short social-first runtime';
    const visualType = asText(config.visualType) || 'UGC (Người thật)';
    const targetLang = detectMarketLang(targetMarketValues, coreUserValues);
    const outputLanguage = useCreativeRulesV7 ? 'Vietnamese' : 'English';
    const marketContext = buildMarketContext(targetMarketValues);
    const angleContext = angleValues.length ? angleValues.join(', ') : '';
    const primaryPillar = painPointValues[0] || 'General user friction';

    // Truncate knowledge to avoid prompt overflow
    const rawKnowledge = appKnowledge;
    const truncatedKnowledge = rawKnowledge.length > 3000 ? rawKnowledge.substring(0, 3000) + '\n[...truncated]' : rawKnowledge;

    const knowledgeBlock = truncatedKnowledge
      ? `\n[APP BRAIN — Kiến thức AI đã học cho app "${appName}". NGUỒN THAM KHẢO #1.]\n${truncatedKnowledge}\n`
      : '';

    const ideasBlock = previousIdeas
      ? `\n[IDEAS GẦN ĐÂY — Học phong cách, nâng cấp, KHÔNG lặp lại]\n${previousIdeas}\n`
      : '';

    const trendingBlock = trendingTopics.length
      ? `\n[TRENDING HIỆN TẠI — KẾT HỢP NẾU PHÙ HỢP]\n${trendingTopics.join(', ')}\n→ Kết hợp trend vào tình huống/hook nếu tự nhiên. KHÔNG ép trend vào nếu không phù hợp với painpoint/emotion đã chọn.\n`
      : '';
    const structuredTrendNotes = trendingStructures.slice(0, 6);
    const importedTrendBlock = structuredTrendNotes.length
      ? `\n[IMPORTED VIDEO STRUCTURE — ƯU TIÊN HỌC CẤU TRÚC, KHÔNG COPY NGUYÊN XI]\n${structuredTrendNotes.join('\n')}\n→ Học nhịp hook/body/CTA, camera treatment, audio pattern và text overlay style. Vẫn phải bám đúng painpoint/emotion/filter của app.\n`
      : '';
    const winningPatternBlock = buildWinningPatternLibraryBlock({
      appName,
      category: appCategory,
      psp: featureContext,
      painpoint: primaryPillar,
      angle: angleContext,
    });
    const seasonalVisualBlock = buildSeasonalVisualBlock(config.seasonalVisualContext);
    const variationIndex = Number(config.variationIndex || 0);
    const totalVariations = Number(config.totalVariations || quantity);
    const angleIndex = Number(config.angleIndex || 1);
    const totalAngles = Number(config.totalAngles || 1);
    const ideaDescription = asText(config.ideaDescription) || undefined;
    const metricLock = getPrimarySolutionMetric(solutionValues);
    const filterConsistencyBlock = buildFilterConsistencyPromptBlock({
      solutionValues,
      angleValues,
      painPointValues,
    });
    const variationBlock = variationIndex > 0
      ? `\n[VARIATION TRONG LẦN GEN HIỆN TẠI]\nĐây là idea ${variationIndex}/${totalVariations}. Phải khác các idea còn lại về tình huống mở đầu, hành động đầu tiên, creative type hoặc nhân vật phụ. Vẫn giữ ĐÚNG core user, painpoint, emotion, PSP, target market, month/season/event và output schema.\n`
      : '';
    const diversityBlock = buildBatchDiversityBlock(quantity, angleContext, angleIndex, totalAngles);

    const painpointPrecisionBlock = useCreativeRulesV7
      ? buildV7ExecutionContract({
          appName,
          coreUserValues,
          primaryPillar,
          angleContext,
          featureContext,
          targetMarketValues,
          targetLang,
          copyLanguage: outputLanguage,
          visualType,
          ideaDescription,
        })
      : `
## PAINPOINT PRECISION CONTRACT
- Exact core user: ${coreUserValues.join('; ') || 'General viewer'}
- Exact pain point pillar: ${primaryPillar}
- Exact angle focus: ${angleContext || 'No locked angle'}
- Exact PSP/app action: ${featureContext}
- User direction: ${ideaDescription || 'None'}

Hard requirements:
- Do not reduce the pain point to a broad symptom. The hook and visual_scene_1 must include at least 2 concrete anchors from the selected pain point/angle, such as trigger moment, body signal, suspected cause, location, object, or user fear.
- The first 3 seconds must show WHY this user cares now, not just that the symptom exists.
- visual_scene_2 must show the selected PSP/app action solving or organizing the same problem. Do not jump to a generic app demo.
- If this is a health/wellness app, position the app as tracking/logging/understanding trends only. Never diagnose, treat, detect disease, promise prevention, or imply before/after health improvement.
- If the PSP is a health tracker, hook_primary may be human/emotional, but visual_scene_1 or hook_alt must name the actual tracked concern/metric from the selected PSP/pain point. Do not stop at a generic symptom like "dizzy", "tired", or "worried".
- Avoid search-query hooks like "Huyết áp thấp có làm tôi choáng khi đứng dậy không?" Make hook_primary feel like a lived moment, confession, or tension line.
- Better lived-moment health hook style examples in ${outputLanguage}: "I thought it was just my age." / "The dizzy moment was not the scariest part." / "My morning started with a sudden pause."
- Hook execution must not be a copy-paste stack: hook_primary is the headline, hook_text_overlay is the readable screen text, and hook_voiceover or hook_character_speech must add a different lived detail. If nobody visibly speaks, hook_character_speech must be an empty string.
- Hook must sell through to PSP: include psp_bridge so the viewer understands why the app/action is the next natural step before the Body section starts.
- Body is only a suggested demo/proof continuation. Do not rely on Body alone to explain why the PSP matters.
- For multiple ideas, every hook_primary must be meaningfully different. Do not reuse "Why do I..." or the same sentence frame across the batch.`;

    const outputSpec = buildCreativeBriefOutputSpec({
      quantity,
      duration,
      appName,
      language: outputLanguage,
      ruleset: creativeRuleset,
    });
    const rulesBlock = useCreativeRulesV7
      ? `${CREATIVE_ADS_GENERATION_RULES_V7}

${buildV7TaskDirectives(quantity, outputLanguage)}`
      : usePromptSystemBuilderHtml
        ? `${PROMPT_SYSTEM_BUILDER_RULES}
${PROMPT_SYSTEM_BUILDER_COMPATIBILITY_GUARDRAILS}`
      : `${CREATIVE_PROMPT_RULES}
${TOOL_COMPATIBILITY_GUARDRAILS}`;
    const taskDirectives = useCreativeRulesV7
      ? buildV7TaskDirectives(quantity, outputLanguage)
      : usePromptSystemBuilderHtml
        ? `Generate ${quantity} production-ready full ideas for the selected filter combination.
- Follow PROMPT_SYSTEM_BUILDER_HTML_V1 exactly.
- Return exactly 1 top-level pillar object, exactly 1 angle object, and exactly ${quantity} ideas.
- Keep hook_primary under 12 words.
- Every idea must include visual_scene_1, visual_scene_2, visual_scene_3, script_vo, cta_text, visual_ref_notes, talent_profile, dont_do, track, track_reason, priority.
- User-facing copy must be ${outputLanguage}; visual scenes and production notes must be Vietnamese. Target market affects local setting and vibe only.
- Each idea must stay inside the selected pain point, selected PSP, selected angle, and selected visual type.`
      : `Generate ${quantity} production-ready full ideas for the selected filter combination.
- Keep the runtime social-first and flexible. Do not lock the concept to a fixed 15s/30s/60s format.
- Each idea must stay inside the selected pillar and selected angle focus.
- Treat the selected angle as one narrow manifestation of the selected pain point, not a replacement for it.
- If an angle is selected, the hook must make that angle visible immediately through the first action, first spoken line, or first contrast.
- Hook, body, and CTA must follow one continuous problem-solution chain.
- If multiple ideas are requested, diversify them aggressively while keeping the same strategic inputs.`;

    const frameworkInjection = buildFrameworkInjection({
      appName,
      category: appCategory,
      coreUsers: coreUserValues,
      primaryEmotion: emotionValues[0] || 'Curiosity',
      visualTheme: `${visualType}. Keep the scenes native to ${targetMarketValues.join(', ') || 'the selected market'}.`,
      psp: featureContext,
      pillars: painPointValues.length ? painPointValues : ['General user friction'],
      trendingHooks: trendingTopics,
      performanceData: [
        rawKnowledge ? `AI Brain memory: ${truncatedKnowledge}` : 'No AI Brain memory yet',
        previousIdeas ? `Recent idea history for anti-repeat:\n${previousIdeas}` : 'No recent idea history',
        structuredTrendNotes.length ? `Imported video structure:\n${structuredTrendNotes.join('\n')}` : 'No imported video structure',
        angleContext ? `Angle focus: ${angleContext}` : 'No locked angle',
      ],
      doList: [
        'Keep every idea production-ready and executable today',
        'Stay social-first, UGC-friendly, and market-native',
        'Differentiate opening action, blocker, reveal, and voice opening across ideas',
      ],
      dontList: [
        'Do not drift away from the selected pain point',
        'Do not output cinematic brand-film copy',
        'Do not repeat the same scene family with new wording',
      ],
      anglesPerPillar: 1,
      ideasPerAngle: quantity,
      trackRule: 'A = no real person needed | B = real person / UGC | C = motion / animation',
          language: useCreativeRulesV7
            ? `User-facing copy in ${outputLanguage}. Internal visual and production notes in Vietnamese.`
            : usePromptSystemBuilderHtml
              ? `Prompt System Builder HTML V1. User-facing copy in ${outputLanguage}; internal visual and production notes in Vietnamese.`
              : `User-facing copy in ${outputLanguage}; internal visual and production notes in Vietnamese.`,
      priority: 'A',
      extraContext: [
        `Selected angle: ${angleContext || 'Creative freedom'}`,
        `Idea description: ${ideaDescription || 'Creative freedom'}`,
        `Target market: ${targetMarketValues.join(', ') || 'Default market'}`,
      ],
    });

    const prompt = `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

${frameworkInjection}

## SUPPORTING CONTEXT
${knowledgeBlock || '- No AI Brain memory yet.'}
${ideasBlock || '- No recent saved ideas.'}
${trendingBlock || '- No trending hooks injected.'}
${importedTrendBlock || ''}
${winningPatternBlock}
${marketContext}
${seasonalVisualBlock || ''}
${variationBlock || ''}
${diversityBlock || ''}
${painpointPrecisionBlock}
${filterConsistencyBlock || ''}

## TASK
${taskDirectives}

${outputSpec}

${rulesBlock}`;

    console.log('[generate-ideas] Prompt length:', prompt.length, 'chars, model:', selectedModel || 'gemini-2.5-pro');
    let text = await askAI(prompt, {
      model: resolveModel(selectedModel),
      temperature: quantity > 1 ? 0.9 : 0.8,
      max_tokens: 16384,
      useCreativePersona: false
    });
    if (!text) {
      console.error('[generate-ideas] AI returned null');
      const fallbackIdeas = buildGenerateIdeasEmergencyFallback(body);
      return NextResponse.json({
        success: true,
        data: fallbackIdeas,
        meta: {
          requestedQuantity: fallbackIdeas.length,
          generatedQuantity: fallbackIdeas.length,
          batchCount: 0,
          partial: false,
          fallbackCount: fallbackIdeas.length,
          warnings: ['Legacy generate path received null from AI; backend returned schema-safe fallback ideas.'],
        },
      });
    }
    console.log('[generate-ideas] AI response length:', text.length, 'chars');

    let parsed = parseJson(text);
    if (!parsed) {
      console.error('[generate-ideas] Failed to parse:', text.substring(0, 300));
      const fallbackIdeas = buildGenerateIdeasEmergencyFallback(body);
      return NextResponse.json({
        success: true,
        data: fallbackIdeas,
        meta: {
          requestedQuantity: fallbackIdeas.length,
          generatedQuantity: fallbackIdeas.length,
          batchCount: 0,
          partial: false,
          fallbackCount: fallbackIdeas.length,
          warnings: ['Legacy generate path could not parse AI output; backend returned schema-safe fallback ideas.'],
        },
      });
    }

    let parsedPreview: unknown = parsed;
    let briefOutput = normalizeCreativeBriefOutput(parsed, {
      duration,
      appName,
      pillar: primaryPillar,
      coreUser: coreUserValues.join('; ') || 'General viewer',
      emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
      psp: featureContext,
      angle: angleContext,
      ideaDescription,
      language: outputLanguage,
      ruleset: creativeRuleset,
    });
    let validation = normalizeAndValidateIdeas(briefOutput.items, {
      duration,
      appName,
      category: appCategory,
      psp: featureContext,
      angle: angleContext,
      pillar: primaryPillar,
      angleIndex: Math.max(angleIndex - 1, 0),
      metricLock,
    });
    validation.invalidReasons.unshift(...briefOutput.invalidReasons);
    let valid = validation.valid.slice(0, quantity);
    const duplicateDetected = quantity > 1 && valid.length > 1 && hasNearDuplicateIdeas(valid);
    const needsValidationRetry = validation.invalidReasons.length > 0 || valid.length < quantity;

    if (needsValidationRetry || duplicateDetected) {
      if (validation.invalidReasons.length > 0) {
        console.warn('[generate-ideas] Invalid ideas detected:', validation.invalidReasons);
      }
      if (duplicateDetected) {
        console.warn('[generate-ideas] Near-duplicate batch detected; retrying with stricter diversity prompt');
      }

      const retryNotes: string[] = [];
      if (validation.invalidReasons.length > 0) {
        retryNotes.push(`Fix these rule violations:\n- ${validation.invalidReasons.slice(0, 5).join('\n- ')}`);
      }
      if (duplicateDetected) {
        retryNotes.push(`The previous batch has hooks that are too similar. Regenerate all ${quantity} ideas.
Each idea must use a different scene family: change the location, supporting character, blocker object, opening action, camera reveal, voice opening, and creativeType.
Do not keep the same scene and only change small details.`);
      }

      const retryText = await askAI(`${prompt}

[RETRY - INVALID OR TOO WEAK]
Regenerate all ${quantity} ideas and obey the hard rules strictly.
${retryNotes.join('\n\n')}`, {
        model: resolveModel(selectedModel),
        temperature: 0.95,
        max_tokens: 16384,
        useCreativePersona: false
      });

      if (retryText) {
        const retryParsed = parseJson(retryText);
        const retryBriefOutput = normalizeCreativeBriefOutput(retryParsed, {
          duration,
          appName,
          pillar: primaryPillar,
          coreUser: coreUserValues.join('; ') || 'General viewer',
          emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
          psp: featureContext,
          angle: angleContext,
          ideaDescription,
          language: outputLanguage,
          ruleset: creativeRuleset,
        });
        const retryValidation = normalizeAndValidateIdeas(retryBriefOutput.items, {
          duration,
          appName,
          category: appCategory,
          psp: featureContext,
          angle: angleContext,
          pillar: primaryPillar,
          angleIndex: Math.max(angleIndex - 1, 0),
          metricLock,
        });
        retryValidation.invalidReasons.unshift(...retryBriefOutput.invalidReasons);
        const retryValid = retryValidation.valid.slice(0, quantity);
        const retryHasDuplicates = retryValid.length > 1 && hasNearDuplicateIdeas(retryValid);

        const shouldUseRetry = retryValid.length > valid.length
          || (valid.length === 0 && retryValid.length > 0)
          || (duplicateDetected && retryValid.length > 0 && !retryHasDuplicates);

        if (shouldUseRetry && (retryValid.length > 0 || retryValidation.invalidReasons.length === 0)) {
          text = retryText;
          parsed = retryParsed;
          parsedPreview = retryParsed;
          briefOutput = retryBriefOutput;
          validation = retryValidation;
          valid = retryValid;
        }
      }
    }

    /* Legacy duplicate retry block retained during transition.
      console.warn('[generate-ideas] Near-duplicate batch detected; retrying with stricter diversity prompt');
      const retryText = await askAI(`${prompt}

[RETRY — BATCH BỊ TRÙNG Ý]
Batch trước có các hook quá giống nhau. Hãy tạo lại TOÀN BỘ ${quantity} ideas.
Bắt buộc mỗi idea khác scene family: đổi địa điểm, nhân vật phụ, object blocker, opening action, camera reveal, voice mở đầu và creativeType.
Không giữ lại cùng một cảnh rồi chỉ đổi vài chi tiết nhỏ.`, {
        model: resolveModel(selectedModel),
        temperature: 0.95,
        max_tokens: 16384,
        useCreativePersona: false
      });

      if (retryText) {
        const retryParsed = parseJson(retryText);
        const retryArr = Array.isArray(retryParsed) ? retryParsed : retryParsed ? [retryParsed] : [];
        const retryValid = retryArr
          .map(item => normalizeIdeaOutput(item, { duration, appName, pillar: primaryPillar }))
          .filter(item => {
            const hook = (item?.hook || {}) as Record<string, unknown>;
            return String(hook.visual || hook.script || '').trim().length > 0;
          })
          .slice(0, quantity);
        if (retryValid.length > 0 && !hasNearDuplicateIdeas(retryValid)) {
          text = retryText;
          parsed = retryParsed;
          arr = retryArr;
          valid = retryValid;
        }
      }
    */

    if (valid.length === 0) {
      console.error('[generate-ideas] No valid ideas:', JSON.stringify(briefOutput.items[0] || parsedPreview).substring(0, 200));
      if (validation.invalidReasons.length > 0) {
        console.error('[generate-ideas] Validation failures:', validation.invalidReasons);
      }
      const fallbackIdeas = buildGenerateIdeasEmergencyFallback(body);
      return NextResponse.json({
        success: true,
        data: fallbackIdeas,
        meta: {
          requestedQuantity: fallbackIdeas.length,
          generatedQuantity: fallbackIdeas.length,
          batchCount: 0,
          partial: false,
          fallbackCount: fallbackIdeas.length,
          warnings: ['Legacy generate path produced no valid ideas; backend returned schema-safe fallback ideas.'],
        },
      });
    }

    return NextResponse.json({ success: true, data: valid });
  } catch (err) {
    console.error('[generate-ideas] Exception:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    const mode = asText(requestBody.mode);

    if (mode === 'refine' && Object.keys(asRecord(requestBody.originalIdea)).length > 0) {
      return NextResponse.json({
        success: true,
        data: buildRefineEmergencyFallback(requestBody),
        meta: {
          warnings: [`Refine route exception: ${message}. Backend returned the current idea as a schema-safe fallback.`],
          fallbackCount: 1,
        },
      });
    }

    if (mode === 'generate-angles') {
      return NextResponse.json({
        success: true,
        angles: buildAngleEmergencyFallback(requestBody),
        meta: {
          warnings: [`Angle route exception: ${message}. Backend returned local fallback angles.`],
          fallbackCount: 1,
        },
      });
    }

    const fallbackIdeas = buildGenerateIdeasEmergencyFallback(requestBody);
    return NextResponse.json({
      success: true,
      data: fallbackIdeas,
      meta: {
        requestedQuantity: fallbackIdeas.length,
        generatedQuantity: fallbackIdeas.length,
        batchCount: 0,
        partial: false,
        fallbackCount: fallbackIdeas.length,
        warnings: [`Generate ideas exception: ${message}. Backend returned schema-safe fallback ideas.`],
      },
    });
  }
}
