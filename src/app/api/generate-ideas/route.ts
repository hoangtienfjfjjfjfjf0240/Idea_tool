import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { askAI, callAI, getAIApiKey, getAIChatCompletionsUrl, getLastAIErrorMessage } from '@/lib/aiClient';
import {
  BULLETPROOF_VISUAL_ANCHOR_RULES,
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
  PACING_LIMIT_RULES,
  parseJsonLoose,
  TOOL_COMPATIBILITY_GUARDRAILS,
} from '@/lib/creativePromptSystem';
import { guardApiRequest } from '@/lib/apiGuards';
import { createServerClient } from '@/lib/supabase';
import { SYSTEM_RULE_CATEGORY, compactSystemRule } from '@/lib/systemRule';
import { GLOBAL_EMOTION_PROMPT_GUIDE } from '@/lib/emotionOptions';
import {
  buildFilterConsistencyPromptBlock,
  detectTargetLanguageFromMarkets,
  getHealthMetricPromptLabel,
  getHealthMetricsInText,
  getPrimarySolutionMetric,
  type HealthMetricKey,
} from '@/lib/filterConsistency';

export const runtime = 'nodejs';
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
const SAFE_HEALTH_BEFORE_AFTER_PATTERN = /\b(?:before\s+(?:checking|measuring|opening|using|logging|tracking)|after\s+(?:checking|measuring|opening|using|logging|tracking)|app\s+(?:screen|ui)|data|chart|graph|trend|history|log|reading|number|reference|wellness|check|tracking|monitoring|camera|phone|bpm|heart\s+rate|blood\s+pressure|ui|screen|trước\s+khi\s+(?:kiểm tra|do|đo|mở|ghi)|sau\s+khi\s+(?:kiểm tra|do|đo|mở|ghi)|màn hình|biểu đồ|dữ liệu|du lieu|chỉ số|chi so|tham chiếu|tham chieu|nhật ký|nhat ky)\b/i;
const SEVERE_UNSAFE_HEALTH_BEFORE_AFTER_PATTERN = /\b(?:body|face|skin|belly|weight|fat|disease|illness|patient|recovered|recovery|cured|treated|medical\s+outcome|health\s+outcome|symptom\s+(?:improvement|improved|gone|relief|reduced)|normal\s+again|healthy\s+again|cơ thể|co the|khuôn mặt|khuon mat|bụng|bung|cân nặng|can nang|mỡ|mo|khỏi bệnh|khoi benh|hồi phục|hoi phuc|cải thiện|cai thien|kết quả bệnh|ket qua benh)\b/i;
function hasUnsafeHealthBeforeAfter(text: string): boolean {
  if (!BEFORE_AFTER_PATTERN.test(text) || !HEALTH_CONTEXT_PATTERN.test(text)) return false;

  const beforeAfterMatches = text.matchAll(new RegExp(BEFORE_AFTER_PATTERN.source, 'gi'));
  const beforeAfterSnippets = Array.from(beforeAfterMatches).map(match => {
    const start = Math.max(0, match.index ? match.index - 160 : 0);
    const end = Math.min(text.length, (match.index || 0) + match[0].length + 220);
    return text.slice(start, end);
  });

  if (beforeAfterSnippets.some(snippet => SAFE_HEALTH_BEFORE_AFTER_PATTERN.test(snippet) && !SEVERE_UNSAFE_HEALTH_BEFORE_AFTER_PATTERN.test(snippet))) {
    return false;
  }

  if (beforeAfterSnippets.some(snippet => SEVERE_UNSAFE_HEALTH_BEFORE_AFTER_PATTERN.test(snippet))) {
    return true;
  }

  return false;
}

function positiveIntEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function booleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

const MAX_IDEAS_PER_AI_BATCH = 5;
const MAX_IDEAS_PER_REQUEST = 10;
const GENERATE_IDEAS_BATCH_TIMEOUT_MS = positiveIntEnv('IDEA_GATEWAY_TIMEOUT_MS', 60000);
const GENERATE_IDEAS_GEMINI3_SMALL_BATCH_TIMEOUT_MS = positiveIntEnv('IDEA_GEMINI3_TIMEOUT_MS', 180000);
const GENERATE_IDEAS_RETRY_TIMEOUT_MS = positiveIntEnv('IDEA_RETRY_TIMEOUT_MS', 30000);
const GENERATE_IDEAS_REQUEST_AI_BUDGET_MS = positiveIntEnv('IDEA_REQUEST_BUDGET_MS', 90000);
const QUICK_IDEA_BATCH_TIMEOUT_MS = positiveIntEnv('IDEA_QUICK_BATCH_TIMEOUT_MS', 60000);
const QUICK_IDEA_REQUEST_BUDGET_MS = positiveIntEnv('IDEA_QUICK_REQUEST_BUDGET_MS', 130000);
const QUICK_IDEA_MAX_BATCH_SIZE = Math.min(positiveIntEnv('IDEA_QUICK_MAX_BATCH_SIZE', 2), MAX_IDEAS_PER_AI_BATCH);
const QUICK_IDEA_BATCH_CONCURRENCY = positiveIntEnv('IDEA_QUICK_BATCH_CONCURRENCY', 3);
const GENERATE_IDEAS_MIN_CALL_TIMEOUT_MS = 5000;
const MAX_IDEA_MODEL_CANDIDATES = positiveIntEnv('IDEA_MODEL_CANDIDATES', 2);
const GEMINI3_IDEA_MAX_BATCH_SIZE = Math.min(positiveIntEnv('IDEA_GEMINI3_MAX_BATCH_SIZE', 3), MAX_IDEAS_PER_AI_BATCH);
const GEMINI3_IDEA_BATCH_CONCURRENCY = positiveIntEnv('IDEA_GEMINI3_BATCH_CONCURRENCY', 2);
const GEMINI3_IDEA_REQUEST_BUDGET_MS = positiveIntEnv('IDEA_GEMINI3_REQUEST_BUDGET_MS', 285000);
const ENABLE_AI_RECOVERY_REFILL = booleanEnv('IDEA_ENABLE_AI_RECOVERY_REFILL', true);
const ENABLE_LOCAL_FALLBACK_TOPUP = booleanEnv('IDEA_ENABLE_LOCAL_FALLBACK_TOPUP', false);
const GENERATE_IDEAS_CONTEXT_CHAR_LIMIT = 5000;
const GENERATE_IDEAS_HISTORY_CHAR_LIMIT = 1600;
const FRAMEWORK_VISUAL_FORMATS = ['2D Animation', '3D Animation', 'UGC', 'POV', 'Motion Graphic'] as const;
const CREATIVE_RULESET_V7_MARKER = 'CREATIVE_RULESET_V7_TEST';
const PROMPT_SYSTEM_BUILDER_HTML_MARKER = 'PROMPT_SYSTEM_BUILDER_HTML_V1';
const USE_DIRECT_GEMINI = booleanEnv('IDEA_USE_DIRECT_GEMINI', false);
const DIRECT_GEMINI_API_KEY = USE_DIRECT_GEMINI ? (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '') : '';
let directGeminiClient: GoogleGenAI | null = null;

const FAST_CREATIVE_IDEA_SYSTEM_PROMPT = `You are a fast Creative Idea Engine for mobile app Meta ads.
Return JSON only. Follow the saved system_rule and user brief, keep the current idea output schema, and avoid unsupported claims.`;

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
- Aspirational: Cho người xem thấy phiên bản tốt hơn của chính họ sau khi giải quyết được painpoint.
- Social Proof: Cho thấy người giống họ đã dùng, đã hiểu, hoặc đã thành công.
- Bất ngờ / Nhẹ nhõm: Mở bằng pain kéo dài rồi reveal giải pháp tạo cảm giác "cuối cùng cũng tìm ra".
- FOMO: Tạo cảm giác mọi người đã biết/đang dùng/đang bàn, chỉ mình người xem chưa kịp.
- Educational: Khẳng định kiến thức mới một cách quyết đoán, không dạy đời.

Emotion drivers chuẩn dùng cho mọi app:
${GLOBAL_EMOTION_PROMPT_GUIDE}

V. LANGUAGE RULES
- Script title/name, visual descriptions, and production notes must be Vietnamese for the internal Idea tool UI.
- On-video text fields (hook text/text overlay, text on screen, CTA text) must include BOTH Vietnamese and the requested output language when they differ, e.g. "Lỗi đầy bộ nhớ khi đang vội? / ¿Sin espacio justo cuando tienes prisa?". If the requested output language is Vietnamese, one Vietnamese line is enough.
- Only character speech, voice-over/video voice, and script_vo must use the requested output language.
- hook_voice_vi/viTranslation must be Vietnamese with full diacritics, translating only the requested-language voice/speech lines.
- Target market controls setting, behavior, props, culture, vibe, voice/speech language, and the second language in bilingual on-video text; it must not switch Vietnamese visual/internal production fields into the market language.

V-B. BULLETPROOF VISUAL ANCHORS
- Every visual_scene_1, visual_scene_2, and visual_scene_3 must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- Position anchor locks people/objects/UI to left/right/foreground/background/top/bottom/screen region. Split-screen ideas must name left pane and right pane.
- Contact anchor states the exact hand/finger/cursor/tap point/eye line/body part interacting with the prop or UI.
- Physical action anchor replaces vague verbs with visible actions such as tap, press, swipe, drag, lift, scan, upload, shoot, error icon appears, chart moves, or result renders.

V-C. PACING LIMIT
- One scene/camera angle must last at least 2.5 seconds.
- 5-second hooks/videos use max 2 scenes/camera angles total. Prefer 0-2.5s and 2.5-5s. Do not use 3 rows like 0-1.5s / 1.5-3.5s / 3.5-5s.
- 8-10 second hooks/videos use max 3-4 scenes/camera angles, each around 2.5-3s.
- These are maximums, not targets. Fewer scenes are allowed.
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

async function loadGenerationAppContext(appId: string): Promise<{
  appName?: string;
  appCategory?: string;
  appKnowledge?: string;
  systemRule?: string;
}> {
  if (!appId) return {};

  try {
    const supabase = createServerClient();
    const [appResult, ruleResult] = await Promise.all([
      supabase
        .from('apps')
        .select('name, category, app_knowledge')
        .eq('id', appId)
        .maybeSingle(),
      supabase
        .from('filter_options')
        .select('value')
        .eq('app_id', appId)
        .eq('category', SYSTEM_RULE_CATEGORY)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (appResult.error) {
      console.warn('[generate-ideas] App context load failed:', appResult.error.message);
    }
    if (ruleResult.error) {
      console.warn('[generate-ideas] System rule load failed:', ruleResult.error.message);
    }

    const appRow = asRecord(appResult.data);
    const ruleRow = asRecord(ruleResult.data);
    return {
      appName: asText(appRow.name),
      appCategory: asText(appRow.category),
      appKnowledge: asText(appRow.app_knowledge),
      systemRule: asText(ruleRow.value),
    };
  } catch (error) {
    console.warn('[generate-ideas] Could not load app generation context:', error instanceof Error ? error.message : error);
    return {};
  }
}

function sanitizeMedicalClaimText(text: string): string {
  return text
    .replace(/\bdiagnos(?:e|is|ing)\b/gi, 'check')
    .replace(/\bclinical diagnosis\b/gi, 'wellness reference')
    .replace(/\bmedical results?\b/gi, 'wellness reference')
    .replace(/\bdetect disease\b/gi, 'notice patterns')
    .replace(/\breplace doctor\b/gi, 'support your notes')
    .replace(/\b(?:cure|treat(?:ment|ing)?|heal(?:ed|ing)?)\b/gi, 'track')
    .replace(/chẩn đoán/gi, 'tham khảo')
    .replace(/điều trị/gi, 'theo dõi')
    .replace(/chữa(?: khỏi)?/gi, 'theo dõi')
    .replace(/phát hiện bệnh/gi, 'nhận ra xu hướng')
    .replace(/thay thế bác sĩ/gi, 'hỗ trợ ghi chú sức khỏe')
    .replace(/kết quả y tế chính xác/gi, 'chỉ số tham khảo');
}

function sanitizeMedicalClaimsInValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeMedicalClaimText(value);
  if (Array.isArray(value)) return value.map(sanitizeMedicalClaimsInValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        sanitizeMedicalClaimsInValue(child),
      ])
    );
  }
  return value;
}

function sanitizeMedicalClaimsInIdea(item: Record<string, unknown>): Record<string, unknown> {
  return asRecord(sanitizeMedicalClaimsInValue(item));
}

const HEALTH_METRIC_TEXT_PATTERNS: Record<HealthMetricKey, RegExp[]> = {
  heartRate: [
    /\bheart\s*rate\b/gi,
    /\bpulse\b/gi,
    /\bbpm\b/gi,
    /\bheartbeat\b/gi,
    /\bnhip\s*tim\b/gi,
    /nhịp\s*tim/gi,
    /\btim\s*mach\b/gi,
    /tim\s*mạch/gi,
  ],
  bloodPressure: [
    /\bblood\s*pressure\b/gi,
    /\bhuyet\s*ap\b/gi,
    /huyết\s*áp/gi,
    /\bdo\s*huyet\s*ap\b/gi,
    /đo\s*huyết\s*áp/gi,
  ],
  bloodGlucose: [
    /\bblood\s*glucose\b/gi,
    /\bglucose\b/gi,
    /\bdiabetes\b/gi,
    /\bduong\s*huyet\b/gi,
    /đường\s*huyết/gi,
    /tiểu\s*đường/gi,
  ],
};

function getMetricReplacementText(metric: HealthMetricKey): string {
  if (metric === 'bloodPressure') return 'blood pressure / huyết áp';
  if (metric === 'bloodGlucose') return 'blood glucose / đường huyết';
  return 'heart rate / nhịp tim';
}

function repairHealthMetricLockText(text: string, metricLock: HealthMetricKey | null | undefined): string {
  if (!metricLock || !text.trim()) return text;
  const replacement = getMetricReplacementText(metricLock);
  return (Object.keys(HEALTH_METRIC_TEXT_PATTERNS) as HealthMetricKey[])
    .filter(metric => metric !== metricLock)
    .flatMap(metric => HEALTH_METRIC_TEXT_PATTERNS[metric])
    .reduce((next, pattern) => next.replace(pattern, replacement), text);
}

function trimWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

function stripInlineSpeechLabels(text: string): string {
  return text
    .replace(/\s*(?:\||\/)?\s*(?:Voiceover|Voice over|VO|Character speech|CHARACTER SPEECH|VOICEOVER|Text\s+(?:hien|hiện))\s*:\s*"[^"]*"/gi, '')
    .replace(/\s*(?:\||\/)?\s*(?:Voiceover|Voice over|VO|Character speech|CHARACTER SPEECH|VOICEOVER|Text\s+(?:hien|hiện))\s*:\s*[^|.\n;]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function repairGeneratedIdeaValue(
  value: unknown,
  context: { metricLock?: HealthMetricKey | null; parentKey?: string; inHook?: boolean }
): unknown {
  const key = (context.parentKey || '').toLowerCase();
  if (key === 'id' || key === 'duration' || key === 'endcard') return value;

  if (typeof value === 'string') {
    let next = repairHealthMetricLockText(value, context.metricLock);
    if (key === 'script_vo' || key === 'scriptvo') next = trimWords(next, 60);
    if (key === 'hook_character_speech' || key === 'hookcharacterspeech' || key === 'character_speech' || key === 'characterspeech') {
      next = trimWords(next, 36);
    }
    if (context.inHook && (key === 'visual' || key === 'script')) {
      next = stripInlineSpeechLabels(next);
    }
    return next;
  }

  if (Array.isArray(value)) {
    return value.map(item => repairGeneratedIdeaValue(item, context));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        repairGeneratedIdeaValue(childValue, {
          metricLock: context.metricLock,
          parentKey: childKey,
          inHook: context.inHook || key === 'hook',
        }),
      ])
    );
  }

  return value;
}

function repairGeneratedIdeaForValidation(
  item: Record<string, unknown>,
  metricLock?: HealthMetricKey | null
): Record<string, unknown> {
  return asRecord(repairGeneratedIdeaValue(item, { metricLock }));
}

function normalizeFrameworkVisualFormat(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('motion') || normalized.includes('graphic') || normalized.includes('data visual')) return 'Motion Graphic';
  if (normalized.includes('2d')) return '2D Animation';
  if (normalized.includes('3d')) return '3D Animation';
  if (normalized.includes('pov') || normalized.includes('screen recording') || normalized.includes('demo app')) return 'POV';
  if (normalized.includes('ugc') || normalized.includes('người thật') || normalized.includes('nguoi that')) return 'UGC';
  return FRAMEWORK_VISUAL_FORMATS.includes(value as typeof FRAMEWORK_VISUAL_FORMATS[number]) ? value : 'UGC';
}

function enforceSelectedVisualFormatInScene(text: string, visualType?: string): string {
  const scene = text.trim();
  if (!scene || !visualType?.trim()) return scene;
  const lockedVisualType = normalizeFrameworkVisualFormat(visualType || '');
  const normalizedScene = normalizeCompareText(scene);
  if (!lockedVisualType) return scene;

  if (lockedVisualType === 'Motion Graphic') {
    const hasOffFormatCue = /\b(?:podcast|interview|talk show|host|guest|speaker\s*[12]|two people|2 people|two men|two women|living room|sofa|armchair|camera iphone|eye line|doi thoai|tro chuyen|phong van|hai nguoi|2 nguoi|nguoi that|dien vien|nhan vat)\b/.test(normalizedScene);
    if (hasOffFormatCue) {
      return 'Motion Graphic 2D thuần: khung app UI/phone screen, typography lớn, icon flat, arrows, waveform/heart-rate line và animated chart/data callout chuyển động theo beat. Không có podcast, host/speaker, người thật, sofa hay phòng ghi hình.';
    }
  }

  if (lockedVisualType === '2D Animation' && !/\b(?:2d|animation|animated|minh hoa|hoat hinh|vector|cartoon)\b/.test(normalizedScene)) {
    return `Trong khung 2D animation minh họa, ${scene}`;
  }
  if (lockedVisualType === '3D Animation' && !/\b(?:3d|cgi|render|animated|animation)\b/.test(normalizedScene)) {
    return `Trong khung 3D animation/render, ${scene}`;
  }
  if (lockedVisualType === 'Motion Graphic' && !/\b(?:motion graphic|2d motion|kinetic typography|animated ui|ui motion|shape animation|icon animation|infographic|typography|data visual|animated chart|bieu do)\b/.test(normalizedScene)) {
    return `Theo phong cách Motion Graphic 2D: typography/shape/icon/UI chuyển động, ${scene}`;
  }
  if (lockedVisualType === 'POV' && !/\b(?:pov|goc nhin|screen recording|man hinh|over the shoulder)\b/.test(normalizedScene)) {
    return `Theo góc POV/screen-perspective, ${scene}`;
  }
  if (lockedVisualType === 'UGC' && !/\b(?:ugc|nguoi that|doi thuong|cam tay|handheld|selfie)\b/.test(normalizedScene)) {
    return `Theo phong cách UGC đời thường, ${scene}`;
  }
  return scene;
}

function isMotionGraphicVisual(visualType?: string) {
  return normalizeFrameworkVisualFormat(visualType || '') === 'Motion Graphic';
}

function stripRoleLabelsForVoiceover(text: string) {
  return text
    .replace(/\bSpeaker\s*\d+\s*:\s*/gi, '')
    .replace(/\b(?:Host|Guest)\s*:\s*/gi, '')
    .replace(/\s*\/\s*/g, ' ')
    .trim();
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
- Voice language: ${input.copyLanguage} for dialogue, character speech, voice-over, and script_vo. Script title/name and production prose stay Vietnamese. On-screen text, hook text lines, and CTA must include BOTH Vietnamese and ${input.copyLanguage} when ${input.copyLanguage} is not Vietnamese, separated with " / ".
- Visual descriptions and production notes must be Vietnamese for the internal team.
- Core user: ${input.coreUserValues.join('; ') || 'General viewer'}
- Painpoint to attack: ${input.primaryPillar}
- Angle focus: ${input.angleContext || 'Creative freedom'}
- Feature/Pivot tool: ${input.featureContext}
- Visual style: ${input.visualType}
- User direction: ${input.ideaDescription || 'None'}

Hard V7 requirements:
- First, silently digest the selected Core User, Emotion Trigger, Visual/Theme, PSP, and Painpoint into a shootable brief. Core User means target viewer/audience, not automatically the on-screen talent age. Emotion Trigger means the emotion to create in the viewer, not merely the character's emotion. Do not output the brief.
- Ignore old rules about hook word count, hook 3-5s, 12-word hooks, and short one-line hook templates.
- The direct opening is the first stop-scroll beat: show consequence, shock, or an unusual visual at second 0.1.
- The solution pivot must happen immediately after: show the app/feature action with a specific finger movement and clear UI/number/chart change.
- Directness rule: if the feature/painpoint contains a concrete metric or feature (blood pressure, heart rate, storage, calories, etc.), that exact metric/feature must appear in hook_text_overlay or hook_vo within the first 0-3 seconds. Do not hide it behind vague lines like "a weird number", "this matters", or "something felt off".
- Use the selected painpoint as the target of attack. Convert it into a concrete first-3-second situation, but do not soften it into a generic symptom.
- Voice/character speech must be written in ${input.copyLanguage}. On-screen text, CTA, hook text lines, and visual descriptions stay Vietnamese while preserving native setting, props, and vibe for the selected market.
- If a visible character speaks, keep the structured hook_character_speech field and also embed the same exact spoken line inside the matching visual_scene timing row as "và [nhân vật] nói \"...\"". Keep Text hiện in hook_text_overlay/text_overlays.
- Every visual_scene_1/2/3 must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- Obey Rule 4 pacing: 0-3s direct opening is one scene/camera angle; 3-6s pivot is one scene/camera angle; no split-screen or extra cut unless each beat gets at least 2.5s.
- If a visible person speaks, asks, replies, reacts to camera, or is asked a question in the hook, hook_character_speech is required with time + speaker and hook_voiceover must be empty. If the idea relies on 2+ people communicating, keep the exchange simple and include only the necessary dialogue. If nobody visibly speaks, keep hook_character_speech empty.
- No rhetorical questions. Use direct statements.
- Keep production simple, but make every action, face, prop, environment, and screen state specific enough to shoot.`;
}

function buildV7TaskDirectives(quantity: number, copyLanguage = 'the requested output language') {
  return `Generate ${quantity} V7 production-ready short-form ad ideas for the selected filter combination.
- Before writing JSON, silently convert the selected Core User, Emotion Trigger, Visual/Theme, PSP, and Pain Point into one shootable creative brief. Core User is the target viewer; Emotion Trigger is the viewer response to provoke. Do not treat them as literal facts about every on-screen character. Do not output that brief.
- The selected Pain Point must appear as a specific first-3-second situation, not a label.
- Each idea must follow: Concept Name -> Market & User Adaptation -> Direct Opening (0-3s) -> Solution Pivot (3-6s) -> Proof/CTA continuation.
- The first frame must be a pattern interruption, not setup.
- The solution pivot must use the selected Feature/PSP as the tool that handles the problem.
- The selected metric/feature must be named early. For example, if the app/PSP is blood pressure, use direct copy like "Your iPhone can check blood pressure" or "Blood pressure on iPhone" in the first hook beat, while staying compliant.
- If the hook situation has a visible person talking to camera, replying, asking, or being questioned, fill hook_character_speech with that exact on-camera line. Use hook_voiceover only for off-camera narration/video voice.
- Script title/name, visual descriptions, and production notes must be Vietnamese. Hook lines/text overlay, text on screen, and CTA must be bilingual Vietnamese / ${copyLanguage} when ${copyLanguage} is not Vietnamese. Only character dialogue, voice-over, and script_vo use ${copyLanguage}.
- For visual_scene rows, write scene/action/camera prose in Vietnamese. If a visible character speaks, include the quoted spoken line in the same timing row as "và [nhân vật] nói \"...\""; keep Text hiện in hook_text_overlay/text_overlays.
- Every visual_scene_1/2/3 must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- Obey Rule 4 pacing: 5s outputs max 2 scenes/camera angles; 8-10s outputs max 3-4 scenes/camera angles; fewer scenes are allowed.
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
  const hookCharacterSpeech = asText(hook.characterSpeech);
  const hookVoiceover = asText(hook.voiceover);
  const hookVoice = [hookCharacterSpeech, hookVoiceover, asText(hook.voice)].filter(Boolean).join(' ');
  const hookTextOverlay = asText(hook.textOverlay) || asText(hook.text);
  const hookVoiceVi = asText(hook.viTranslation)
    || asText(hook.vi_translation)
    || asText(hook.hookVoiceVi)
    || asText(hook.hook_voice_vi);
  const dontDo = asText(meta.dontDo);

  const errors: string[] = [];

  if (!TRACKING_ID_PATTERN.test(id)) errors.push('id must follow P{pillar}-A{angle}-I{idea}');
  if (!hookPrimary) errors.push('meta.hookPrimary is required');
  if (!hookVisual) errors.push('hook.visual is required');
  if (!hookVoice && !hookTextOverlay) errors.push('hook needs voice or text overlay');
  if (hookCharacterSpeech && hookVoiceover) {
    errors.push('hook must use either characterSpeech or voiceover, not both');
  }
  if (hookCharacterSpeech && !/^\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\s*s\s*[-:]\s*[^:]{2,80}:/m.test(hookCharacterSpeech)) {
    errors.push('hook characterSpeech must include time + speaker label');
  }
  if (/\b(?:Voiceover|Voice over|VO|Character speech|CHARACTER SPEECH|VOICEOVER|VOICE|Text\s+(?:hien|hi[eệ]n))\s*:/i.test(hookVisual)) {
    errors.push('hook visual must not contain inline Voiceover, Character speech, or Text hien labels');
  }
  if (!hookVoiceVi) {
    errors.push('hook_voice_vi is required for Vietnamese hook voice translation');
  } else if (
    !hasVietnameseDiacritics(hookVoiceVi)
    || !hasVietnameseCopyCue(hookVoiceVi)
    || hasUntranslatedAudienceCopyCue(hookVoiceVi)
    || looksLikeHookVoiceExplanation(hookVoiceVi)
  ) {
    errors.push('hook_voice_vi must be Vietnamese with full diacritics, not the original market copy');
  }
  if (hookVisual) errors.push(...validateHookPacingOutput(hookVisual));

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

  if (hasUnsafeHealthBeforeAfter(complianceText)) {
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

function validateHealthMetricDirectHookOutput(
  item: Record<string, unknown>,
  metricLock: HealthMetricKey | null | undefined
): string[] {
  if (!metricLock) return [];

  const hook = asRecord(item.hook);
  const meta = asRecord(item.meta);
  const hookText = [
    asText(meta.hookPrimary),
    asText(meta.hook_primary),
    asText(hook.textOverlay),
    asText(hook.text_overlay),
    asText(hook.text),
    asText(hook.voiceover),
    asText(hook.voice),
    asText(hook.characterSpeech),
  ].join(' ');

  return getHealthMetricsInText(hookText).includes(metricLock)
    ? []
    : [`hook copy must name ${getHealthMetricPromptLabel(metricLock)} directly in the first beat`];
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

function inferHookDurationFromTimelineText(text: string): number | null {
  const ranges = Array.from(text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-|\u2010|\u2011|\u2012|\u2013|\u2014|\u2212)\s*(\d+(?:[.,]\d+)?)\s*s?/gi))
    .map(match => Number(match[2].replace(',', '.')))
    .filter(value => Number.isFinite(value));
  if (ranges.length === 0) return null;
  const duration = Math.max(...ranges);
  return duration >= 3 && duration <= 30 ? Math.round(duration * 10) / 10 : null;
}

function extractHookTimeRanges(text: string): Array<{ start: number; end: number }> {
  return Array.from(text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-|\u2010|\u2011|\u2012|\u2013|\u2014|\u2212)\s*(\d+(?:[.,]\d+)?)\s*s?/gi))
    .map(match => {
      const start = Number(match[1].replace(',', '.'));
      const end = Number(match[2].replace(',', '.'));
      return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
    })
    .filter((range): range is { start: number; end: number } => Boolean(range));
}

function getRule4MaxSceneCount(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1;
  return Math.max(1, Math.min(4, Math.floor(durationSeconds / 2.5)));
}

function validateHookPacingOutput(text: string): string[] {
  const errors: string[] = [];
  const ranges = extractHookTimeRanges(text);
  if (ranges.length === 0) {
    errors.push('hook visual must include explicit timing rows such as 0-2.5s and obey Rule 4 pacing');
    return errors;
  }

  const hookRanges = ranges.filter(range => range.start < 10.5);
  if (hookRanges.length === 0) {
    errors.push('hook visual must include timing rows inside the first 10 seconds');
    return errors;
  }

  const hookDuration = Math.max(...hookRanges.map(range => range.end));
  if (hookDuration > 10.25) {
    errors.push('hook duration must stay at or under 10s unless the user explicitly asks for a longer full video');
  }

  const maxScenes = getRule4MaxSceneCount(hookDuration);
  if (hookRanges.length > maxScenes) {
    errors.push(`Rule 4 pacing violation: ${hookDuration}s hook allows max ${maxScenes} scene/camera rows, got ${hookRanges.length}`);
  }

  const tooShortRange = hookRanges.find(range => hookRanges.length > 1 && range.end - range.start < 2.35);
  if (tooShortRange) {
    errors.push('Rule 4 pacing violation: every hook scene/camera row must last at least 2.5s');
  }

  const splitScreenCue = /\b(?:split[-\s]?screen|chia\s+doi\s+man\s+hinh|chia\s+doi|side[-\s]?by[-\s]?side)\b/i.test(text);
  if (splitScreenCue && hookDuration < 6) {
    errors.push('split-screen hook needs at least 6s so each side can stay visible for about 3s');
  }

  return errors;
}

function readHookDurationNumber(hook: Record<string, unknown>): number | null {
  const value = Number(hook.durationSeconds ?? hook.duration_seconds);
  return Number.isFinite(value) && value >= 3 && value <= 10 ? Math.round(value * 10) / 10 : null;
}

function syncHookDurationFromTimeline(item: Record<string, unknown>, fallbackDurationSeconds?: number): Record<string, unknown> {
  const hook = asRecord(item.hook);
  const visual = [asText(hook.visual), asText(hook.script)].filter(Boolean).join('\n');
  const duration = inferHookDurationFromTimelineText(visual)
    || readHookDurationNumber(hook)
    || (Number.isFinite(fallbackDurationSeconds) ? Math.round(Number(fallbackDurationSeconds) * 10) / 10 : null)
    || estimateHookDurationSeconds({
      characterSpeech: hook.characterSpeech,
      voiceover: hook.voiceover,
      voice: hook.voice,
      textOverlay: hook.textOverlay,
      text: hook.text,
      visual,
    });

  return {
    ...item,
    hook: {
      ...hook,
      durationSeconds: duration,
      duration_seconds: duration,
    },
  };
}

function normalizeAndValidateIdeas(
  items: unknown[],
  context: {
    duration: string;
    appName: string;
    category?: string;
    psp?: string;
    coreUser?: string;
    emotion?: string;
    angle?: string;
    pillar: string;
    angleIndex: number;
    ideaStartIndex?: number;
    hookDurationSeconds?: number;
    metricLock?: HealthMetricKey | null;
    visualType?: string;
  }
) {
  const valid: Record<string, unknown>[] = [];
  const invalidReasons: string[] = [];

  items.forEach((item, ideaIndex) => {
    const normalized = repairGeneratedIdeaForValidation(syncHookDurationFromTimeline(repairIdeaTrackingFields(
      normalizeIdeaOutput(item, {
        duration: context.duration,
        appName: context.appName,
        pillar: context.pillar,
        visualType: context.visualType,
        coreUser: asText(context.coreUser),
        emotion: asText(context.emotion),
        psp: asText(context.psp),
      }),
      { angleIndex: context.angleIndex, ideaIndex: (context.ideaStartIndex || 0) + ideaIndex, pillar: context.pillar }
    ), context.hookDurationSeconds), context.metricLock);
    const errors = [
      ...validateIdeaOutput(normalized),
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
  return 'English';
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

function readCoreUserDimensionLabel(value: string): string {
  const normalized = normalizeCompareText(value);
  const prefix = 'core user - ';
  if (!normalized.startsWith(prefix) || !normalized.includes(':')) return '';
  return normalized.slice(prefix.length, normalized.indexOf(':')).trim();
}

function readCoreUserDimensionValue(value: string): string {
  const marker = ':';
  return value.includes(marker) ? value.slice(value.indexOf(marker) + marker.length).trim() : value.trim();
}

function isCoreUserLanguageValue(value: string): boolean {
  const label = readCoreUserDimensionLabel(value);
  if (/\b(?:ngon ngu|language)\b/.test(label)) return true;
  const normalizedValue = normalizeCompareText(readCoreUserDimensionValue(value));
  return /^(?:english|spanish|vietnamese|japanese|korean|german|french|portuguese|thai|indonesian|malay|tieng anh|tieng tay ban nha|tieng viet|tieng nhat|tieng han|tieng duc|tieng phap|tieng bo dao nha)$/.test(normalizedValue);
}

function isCoreUserMarketValue(value: string): boolean {
  const label = readCoreUserDimensionLabel(value);
  if (!label) return false;
  return /\b(?:quoc gia|market|country)\b/.test(label);
}

function getCoreUserLanguageValues(coreUsers: string[]): string[] {
  return coreUsers
    .filter(isCoreUserLanguageValue)
    .map(readCoreUserDimensionValue)
    .filter(Boolean);
}

function getCoreUserMarketValues(coreUsers: string[]): string[] {
  return coreUsers
    .filter(value => isCoreUserMarketValue(value) || (!readCoreUserDimensionLabel(value) && !isCoreUserLanguageValue(value)))
    .map(readCoreUserDimensionValue)
    .filter(Boolean);
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

function getDirectGeminiClient() {
  if (!DIRECT_GEMINI_API_KEY) return null;
  if (!directGeminiClient) {
    directGeminiClient = new GoogleGenAI({ apiKey: DIRECT_GEMINI_API_KEY.trim() });
  }
  return directGeminiClient;
}

function toDirectGeminiModel(model: string) {
  return model.replace(/^gemini\//, '');
}

async function callDirectGemini(
  model: string,
  prompt: string,
  options: { systemInstruction: string; temperature: number; maxOutputTokens: number; timeoutMs: number }
): Promise<string | null> {
  const client = getDirectGeminiClient();
  if (!client || !model.startsWith('gemini/')) return null;

  try {
    const response = await Promise.race([
      client.models.generateContent({
        model: toDirectGeminiModel(model),
        contents: prompt,
        config: {
          systemInstruction: options.systemInstruction,
          temperature: options.temperature,
          maxOutputTokens: options.maxOutputTokens,
        },
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Direct Gemini request timed out after ${Math.round(options.timeoutMs / 1000)} seconds`)), options.timeoutMs);
      }),
    ]);

    return response.text || null;
  } catch (error) {
    console.warn('[generate-ideas] Direct Gemini failed; falling back to gateway:', error instanceof Error ? error.message : error);
    return null;
  }
}

function resolveIdeaModels(selected?: string): string[] {
  const primary = resolveModel(selected || 'gemini-3-pro');
  if (primary.includes('gemini-3-pro')) {
    return [primary, 'gemini/gemini-2.5-flash'];
  }
  return [primary];
}

function clampPromptContext(value: unknown, maxLength: number) {
  const text = asText(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n[...truncated]` : text;
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

const REFINE_LOCKED_META_KEYS = [
  'strategyCode',
  'strategyCodes',
  'strategyCodeMap',
  'isFavorite',
  'favoriteKeys',
  'favoriteMarkedAt',
  'sourceHookId',
  'sourceHookTitle',
  'sessionType',
];

function pickExistingMetaFields(meta: Record<string, unknown>) {
  return Object.fromEntries(
    REFINE_LOCKED_META_KEYS
      .filter(key => meta[key] !== undefined && meta[key] !== null && meta[key] !== '')
      .map(key => [key, meta[key]])
  );
}

function mergeRefinedIdeaWithOriginal(
  refinedInput: unknown,
  originalIdea: Record<string, unknown>,
  options: { duration: string; appName: string; pillar: string }
) {
  const refined = asRecord(normalizeIdeaOutput(refinedInput, options));
  const originalMeta = asRecord(originalIdea.meta);
  const refinedMeta = asRecord(refined.meta);
  const mergeSection = (sectionKey: 'hook' | 'body' | 'cta') => {
    const originalSection = asRecord(originalIdea[sectionKey]);
    const refinedSection = asRecord(refined[sectionKey]);
    const originalVisual = asText(originalSection.visual) || asText(originalSection.script);
    const refinedVisual = asText(refinedSection.visual) || asText(refinedSection.script);
    const merged = {
      ...originalSection,
      ...refinedSection,
    };

    if (!refinedVisual && originalVisual) {
      merged.visual = asText(originalSection.visual) || originalVisual;
      merged.script = asText(originalSection.script) || originalVisual;
    }

    ['textOverlay', 'text', 'characterSpeech', 'voiceover', 'voice', 'viTranslation', 'endCard'].forEach(key => {
      if (!asText(merged[key]) && asText(originalSection[key])) {
        merged[key] = originalSection[key];
      }
    });

    if (sectionKey === 'hook' && !merged.durationSeconds && originalSection.durationSeconds) {
      merged.durationSeconds = originalSection.durationSeconds;
    }

    return merged;
  };

  return {
    ...refined,
    creativeType: asText(refined.creativeType) || asText(originalIdea.creativeType),
    framework: {
      ...asRecord(originalIdea.framework),
      ...asRecord(refined.framework),
    },
    meta: {
      ...originalMeta,
      ...refinedMeta,
      ...pickExistingMetaFields(originalMeta),
    },
    hook: mergeSection('hook'),
    body: mergeSection('body'),
    cta: mergeSection('cta'),
  };
}

function applyExplicitRefineDirectives(ideaInput: unknown, instruction: string) {
  const normalizedInstruction = normalizeCompareText(instruction);
  const wants2dVisual = /\b(?:2d|2-d|2 chieu|hai chieu)\b/.test(normalizedInstruction);
  if (!wants2dVisual) return ideaInput;

  const rewriteVisualStyle = (value: string) => value
    .replace(/\b3D\s+Soft[- ]?clay\b/gi, '2D animation')
    .replace(/\bSoft[- ]?clay\s+3D\b/gi, '2D animation')
    .replace(/\b3D\s+Animation\b/gi, '2D Animation')
    .replace(/\b3D\b/g, '2D');

  const rewriteValue = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') {
      if (/^(?:strategyCode|strategyCodes|strategyCodeMap|favoriteKeys|sourceHookId|sourceHookTitle)$/i.test(key)) {
        return value;
      }
      return rewriteVisualStyle(value);
    }
    if (Array.isArray(value)) {
      if (/^(?:strategyCodes|favoriteKeys)$/i.test(key)) return value;
      return value.map(item => rewriteValue(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
          entryKey,
          rewriteValue(entryValue, entryKey),
        ])
      );
    }
    return value;
  };

  const rewritten = asRecord(rewriteValue(ideaInput));
  rewritten.creativeType = '2D Animation';
  return rewritten;
}

function buildRefineDirectiveBlock(instruction: string) {
  const normalizedInstruction = normalizeCompareText(instruction);
  const lines = [
    'The user instruction is the winning requirement. Change the idea to match it, even when the old creativeType, labels, or scene wording disagree.',
    'Do not do a light synonym pass. Rewrite the affected title, creativeType, hook, body, CTA, voice, and text overlays so the edit is obvious and production-ready.',
    'Keep tracking metadata exactly, but never treat strategy codes as creative instructions.',
  ];

  if (/\b(?:2d|2-d|2 chieu|hai chieu)\b/.test(normalizedInstruction)) {
    lines.push('Hard directive: final creative space is 2D. Set creativeType to "2D Animation" and rewrite all visual/script fields as flat 2D animation, illustrated panels, layered 2D motion, or vector-style scenes. Forbidden visible wording: 3D, 3D Animation, 3D Soft-clay, soft-clay 3D.');
  }
  if (/\b(?:3d|3-d|3 chieu|ba chieu)\b/.test(normalizedInstruction)) {
    lines.push('Hard directive: final creative space is 3D. Make the visual/script fields clearly describe a 3D scene, dimensional objects, camera depth, and 3D motion.');
  }
  if (/\b(?:ugc|user generated|nguoi that|real person|quay that|live action)\b/.test(normalizedInstruction)) {
    lines.push('Hard directive: final creative style is real-person UGC/live action. Use a human-shot vertical scene, natural phone camera, real props, and avoid animation-only wording unless the user asks for it.');
  }

  return lines.map(line => `- ${line}`).join('\n');
}

function getRefineInstructionViolations(ideaInput: unknown, instruction: string) {
  const normalizedInstruction = normalizeCompareText(instruction);
  const outputText = normalizeCompareText(JSON.stringify(ideaInput));
  const violations: string[] = [];

  if (/\b(?:2d|2-d|2 chieu|hai chieu)\b/.test(normalizedInstruction)) {
    if (/\b3d\b|3-d|soft clay|soft-clay/.test(outputText)) {
      violations.push('User asked for 2D, but output still contains 3D/soft-clay wording.');
    }
    if (!/\b2d\b|2-d|2 chieu|hai chieu|flat|vector|illustrat|animation/.test(outputText)) {
      violations.push('User asked for 2D, but output does not clearly describe a 2D visual style.');
    }
  }

  if (/\b(?:ugc|user generated|nguoi that|real person|quay that|live action)\b/.test(normalizedInstruction)) {
    if (!/\bugc\b|real person|live action|handheld|phone camera|selfie|nguoi that|quay that/.test(outputText)) {
      violations.push('User asked for UGC/live action, but output does not clearly switch to live footage.');
    }
  }

  return violations;
}

function comparableRefineText(ideaInput: unknown) {
  const idea = asRecord(ideaInput);
  const keep = {
    title: idea.title,
    creativeType: idea.creativeType,
    framework: idea.framework,
    explanation: idea.explanation,
    hook: idea.hook,
    body: idea.body,
    cta: idea.cta,
  };
  return normalizeCompareText(JSON.stringify(keep));
}

function isRefineMeaningfullyUnchanged(originalIdea: Record<string, unknown>, refinedIdea: unknown) {
  return comparableRefineText(originalIdea) === comparableRefineText(refinedIdea);
}

function buildAngleEmergencyFallback(payload: Record<string, unknown>) {
  const painpoints = Array.isArray(payload.painpoints)
    ? payload.painpoints.map(asText).filter(Boolean)
    : [];
  return buildLocalizedAngleFallback(painpoints, 'Vietnamese');
}

function vietnamesePainpointCue(value: string) {
  const normalized = normalizeCompareText(value);
  if (/\b(?:chest|nguc|symptom|trieu chung|scare|panic|hoang)\b/.test(normalized)) {
    return 'lo lắng khi dấu hiệu ở ngực xuất hiện bất ngờ';
  }
  if (/\b(?:warning|sign|alert|understood|understand|canh bao|hieu)\b/.test(normalized)) {
    return 'không hiểu rõ các dấu hiệu cảnh báo sức khỏe tim';
  }
  if (/\b(?:pulse|heartbeat|heart rate|nhip tim|felt off|different)\b/.test(normalized)) {
    return 'nhịp tim thay đổi nhưng không biết ý nghĩa là gì';
  }
  if (/\b(?:night|late|search|learn|fact|knowledge|dem|tra cuu|kien thuc)\b/.test(normalized)) {
    return 'phải tra cứu kiến thức tim mạch trong lúc đang lo';
  }
  if (/\b(?:family|talk|question|answer|conversation|gia dinh|cau hoi)\b/.test(normalized)) {
    return 'không trả lời được những câu hỏi đơn giản về sức khỏe tim';
  }
  if (/\b(?:dizzy|dizziness|chong mat|regret|learning)\b/.test(normalized)) {
    return 'chóng mặt rồi mới nhận ra mình biết quá ít về sức khỏe tim';
  }
  if (/\b(?:blood|pressure|huyet ap)\b/.test(normalized)) {
    return 'muốn kiểm tra huyết áp nhưng cách cũ quá bất tiện';
  }
  if (/\b(?:bulky|device|monitor|old|traditional|messgerat|gerat|may do)\b/.test(normalized)) {
    return 'thiết bị theo dõi cũ cồng kềnh làm mỗi lần kiểm tra đều ngại';
  }
  return 'nỗi đau đã chọn vẫn chưa có cách xử lý rõ ràng';
}

function buildLocalizedAngleFallback(painpoints: string[], outputLanguage = 'English') {
  const language = normalizeOutputLanguageLabel(outputLanguage) || 'English';
  if (language === 'Vietnamese') {
    const seeds = painpoints.length > 0 ? painpoints : ['nỗi đau đã chọn'];
    return seeds.flatMap((pp: string) => {
      const cue = vietnamesePainpointCue(pp);
      return [
        `Người xem ${cue} trong một khoảnh khắc đời thường`,
        `Tình huống ${cue} khiến cách cũ trở nên quá chậm`,
        `Góc nhìn ${cue} và cần một cách theo dõi rõ ràng hơn`,
      ];
    });
  }
  const seeds = painpoints.length > 0 ? painpoints : ['nỗi đau đã chọn'];

  if (language === 'Japanese') {
    return seeds.flatMap((pp: string) => [
      `${pp}のせいで、大事な瞬間をまた逃しそう`,
      `${pp}が続いて、何から直せばいいかわからない`,
      `${pp}を後回しにしていたら、また困ることになった`,
    ]);
  }

  if (language === 'Vietnamese') {
    return seeds.flatMap((pp: string) => {
      const seed = hasGermanCopyCue(pp) ? 'nỗi đau đã chọn' : pp;
      return [
        `${seed} nhưng bạn vẫn chưa biết bắt đầu từ đâu`,
        `${seed} và mỗi lần thử lại càng rối hơn`,
        `${seed} dù đã xem nhiều cách khác nhau`,
      ];
    });
  }
  return seeds.flatMap((pp: string) => [
    `I keep running into ${pp} at the worst time`,
    `${pp} is starting to cost me more than I expected`,
    `I thought I fixed ${pp}, but it came back again`,
  ]);
}

// Build culture/market context based on selected target market
function buildMarketContext(targetMarket: string[]): string {
  const market = (targetMarket || []).join(', ').toLowerCase();
  const normalizedMarket = normalizeCompareText(market);
  const hasMarketToken = (tokens: string[]) => tokens.some(token => (
    new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(normalizedMarket)
  ));

  if (!normalizedMarket) {
    return `TARGET MARKET: Global / no specific country selected
- Use globally understandable English-language social ad situations.
- Keep settings, names, props, currency, and cultural references broadly neutral unless the selected filters say otherwise.
- Do not force US-only, JP-only, VN-only, or local-country details when no country/market is selected.`;
  }

  if (hasMarketToken(['us', 'usa', 'united states', 'my'])) {
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

  if (market.includes('eu') || market.includes('châu âu') || market.includes('de') || market.includes('đức') || market.includes('fr') || market.includes('pháp') || market.includes('spain') || market.includes('españa')) {
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

function buildMarketVisualProfile(values: string[]): string {
  const normalized = normalizeCompareText((values || []).join(' '));
  const hasAny = (tokens: string[]) => tokens.some(token => new RegExp(`\\b${token}\\b`).test(normalized));

  if (hasAny(['latam', 'latin', 'mexico', 'brazil', 'brasil', 'argentina', 'colombia', 'spanish', 'tay ban nha'])) {
    return 'Market Visual Profile LATAM: mô tả bằng tiếng Việt một nhân vật Latin/Hispanic phù hợp bối cảnh, thường da nâu sáng/olive đến nâu trung bình, tóc đen hoặc nâu đậm, trang phục đời thường. Bối cảnh nên là căn hộ/casa, bếp gia đình, phòng khách, farmacia/tienda hoặc không gian đô thị Mỹ Latin. Tránh biến toàn bộ visual_scene sang tiếng Tây Ban Nha; Voice/Speech dùng Spanish, còn Text hiện phải song ngữ Việt / Spanish.';
  }
  if (hasAny(['us', 'usa', 'united states', 'america', 'american', 'my', 'english'])) {
    return 'Market Visual Profile US: mô tả bằng tiếng Việt một người Mỹ đa sắc tộc phù hợp core user, có thể là White/Black/Latino/Asian American tùy ý tưởng; tóc, da, trang phục casual và bối cảnh apartment/suburban house/clinic/waiting room kiểu Mỹ. Voice/Speech dùng English; Text hiện phải song ngữ Việt / English, còn visual_scene prose vẫn tiếng Việt.';
  }
  if (hasAny(['jp', 'japan', 'japanese', 'nhat'])) {
    return 'Market Visual Profile JP: mô tả bằng tiếng Việt một người Nhật/Đông Á, tóc đen hoặc nâu đậm, trang phục gọn tối giản; bối cảnh mansion/apartment nhỏ, phòng khám, ga tàu, konbini hoặc phòng khách Nhật. Voice/Speech dùng Japanese; Text hiện phải song ngữ Việt / Japanese, còn visual_scene prose vẫn tiếng Việt.';
  }
  if (hasAny(['kr', 'korea', 'korean', 'han'])) {
    return 'Market Visual Profile KR: mô tả bằng tiếng Việt một người Hàn/Đông Á, tóc đen hoặc nâu đậm, style gọn hiện đại; bối cảnh apartment/officetel, cafe, phòng khám, subway hoặc phòng khách Hàn. Voice/Speech dùng Korean; Text hiện phải song ngữ Việt / Korean, còn visual_scene prose vẫn tiếng Việt.';
  }
  if (hasAny(['de', 'germany', 'german', 'duc', 'eu', 'france', 'french', 'phap', 'spain', 'italy', 'europe'])) {
    return 'Market Visual Profile EU: mô tả bằng tiếng Việt nhân vật và bối cảnh châu Âu phù hợp quốc gia đã chọn, ưu tiên flat/apartment, phòng khám, phương tiện công cộng, phố nội đô; ngoại hình, tóc, trang phục đời thường phải hợp thị trường nhưng không rập khuôn. Voice/Speech dùng ngôn ngữ quốc gia; Text hiện phải song ngữ Việt / ngôn ngữ quốc gia, còn visual_scene prose vẫn tiếng Việt.';
  }
  if (hasAny(['vn', 'vietnam', 'viet', 'sea', 'thai', 'thailand', 'indonesia', 'malaysia', 'philippines'])) {
    return 'Market Visual Profile SEA/VN: mô tả bằng tiếng Việt nhân vật Đông Nam Á phù hợp quốc gia, tóc đen/nâu đậm, trang phục đời thường; bối cảnh chung cư, nhà phố, phòng khám, quán cà phê, xe máy hoặc trung tâm thương mại. Voice/Speech dùng ngôn ngữ thị trường nếu có; Text hiện phải song ngữ Việt / ngôn ngữ thị trường nếu ngôn ngữ thị trường không phải tiếng Việt, còn visual_scene prose vẫn tiếng Việt.';
  }
  return 'Market Visual Profile Global: mô tả bằng tiếng Việt ngoại hình nhân vật, màu da/tóc, trang phục và bối cảnh phổ biến theo core user đã chọn. Không rập khuôn; dùng chi tiết vừa đủ để creator/AI video dựng đúng thị trường. Voice/Speech dùng copy language; Text hiện phải song ngữ Việt / copy language nếu copy language không phải tiếng Việt, còn visual_scene prose vẫn tiếng Việt.';
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

function buildBatchDiversityBlock(quantity: number, angle: string, angleIndex: number, totalAngles: number, visualType?: string): string {
  if (quantity <= 1) return '';

  const lockedVisualType = normalizeFrameworkVisualFormat(visualType || '') || 'selected Visual/Theme';
  const motionGraphicLanes = [
    `Idea 1: ${lockedVisualType}, mo bang typography/data number bat thuong phong to tren app UI.`,
    `Idea 2: ${lockedVisualType}, mo bang icon/shape interruption lam chart bi giat nhip.`,
    `Idea 3: ${lockedVisualType}, mo bang split data cards hoac before-after chart reveal.`,
    `Idea 4: ${lockedVisualType}, texture/oddly satisfying line graph motion tao cam giac dung scroll.`,
    `Idea 5: ${lockedVisualType}, social proof bang comment bubble/data badge, khong co nguoi that hay podcast.`,
    `Idea 6: ${lockedVisualType}, challenge/cau do 1 nhip bang typography va UI tap target.`,
    `Idea 7: ${lockedVisualType}, myth-vs-fact infographic beat bang icon, labels va arrows.`,
    `Idea 8: ${lockedVisualType}, trend structure nhung bien thanh UI/data motion, khong dung interview/podcast.`,
  ];
  const generalLanes = [
    `Idea 1: ${lockedVisualType}, mở bằng một hành động cá nhân đang bị kẹt giữa chừng trong bối cảnh đúng angle.`,
    `Idea 2: ${lockedVisualType}, phản ứng/social interruption có người hoặc vật thứ hai làm tình huống đổi nhịp trong bối cảnh khác idea 1.`,
    `Idea 3: ${lockedVisualType}, reveal bất ngờ bằng blocking object hoặc không gian khác hẳn idea 1 và 2.`,
    `Idea 4: ${lockedVisualType}, texture/oddly satisfying motion tạo cảm giác dừng scroll.`,
    `Idea 5: ${lockedVisualType}, comment-reply/social proof nhưng vẫn giữ đúng production format đã chọn.`,
    `Idea 6: ${lockedVisualType}, challenge/câu đố 1 nhịp trong cùng format visual.`,
    `Idea 7: ${lockedVisualType}, myth-vs-fact hoặc expert-proof beat nhưng vẫn đúng format visual, không tự đổi sang interview/podcast.`,
    `Idea 8: ${lockedVisualType}, trend structure nhưng đổi scene family và first action trong cùng format visual.`,
  ];
  const lanes = (lockedVisualType === 'Motion Graphic' ? motionGraphicLanes : generalLanes).slice(0, quantity).join('\n');

  return `
[BATCH DIVERSITY CONTRACT — BẮT BUỘC CHO LẦN GEN NÀY]
Bạn đang tạo ${quantity} ideas trong CÙNG MỘT batch${angle ? ` cho angle "${angle}"` : ''}${totalAngles > 1 ? ` (angle ${angleIndex}/${totalAngles})` : ''}.
Các ideas KHÔNG được là 3 biến thể của cùng một cảnh.
Visual/Theme đang chọn là "${lockedVisualType}" và bị KHÓA cho toàn batch. Không được đổi creativeType sang UGC, POV, Motion Graphic, 3D Animation hoặc 2D Animation khác với lựa chọn này.

MỖI idea phải khác rõ ở ÍT NHẤT 4/6 trục:
1. hook/story pattern hoặc angle_type, nhưng creativeType vẫn giữ "${lockedVisualType}"
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
- Không dùng POV/UGC/Motion Graphic như creativeType nếu khác "${lockedVisualType}"; chỉ dùng như hook/story pattern nếu phù hợp.
- Nếu Visual/Theme là Motion Graphic, không được dùng podcast/interview/host/guest/Speaker 1/Speaker 2/người thật/phòng khách/sofa; phải là 2D typography, icon, UI panel, chart, data callout.
- Không default về bếp/phòng khách/sofa/căn hộ nếu angle/visual không yêu cầu. Với style truyền hình/biên tập viên, dùng studio/newsroom/desk/panel/infographic set; với Fact/Comparison/Demo, dùng chart/UI/desk/clinic waiting/office/outdoor errand theo logic.
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

function ideaSceneFamilyKey(idea: Record<string, unknown>): string {
  const meta = asRecord(idea.meta);
  return normalizeCompareText(asText(meta.sceneFamily));
}

function hasSameSceneFamily(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const left = ideaSceneFamilyKey(a);
  const right = ideaSceneFamilyKey(b);
  return Boolean(left && right && left === right);
}

function hasSameHookFrame(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const left = ideaHookLine(a);
  const right = ideaHookLine(b);
  if (!left || !right) return false;
  return normalizeCompareText(left) === normalizeCompareText(right) || jaccardSimilarity(left, right) >= 0.66;
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
        || hasSameSceneFamily(ideas[i], ideas[j])
        || jaccardSimilarity(ideaSignature(ideas[i]), ideaSignature(ideas[j])) >= 0.76
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
      jaccardSimilarity(signature, ideaSignature(item)) < 0.76
    )) && ![...existing, ...unique].some(item => (
      hasSameHookFrame(candidate, item) || hasSameSceneFamily(candidate, item)
    ));

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

function buildIdeaBatchPlans(totalRequestedQuantity: number, maxBatchSize = MAX_IDEAS_PER_AI_BATCH): IdeaBatchPlan[] {
  const plans: IdeaBatchPlan[] = [];
  const batchSize = Math.max(1, Math.min(maxBatchSize, MAX_IDEAS_PER_AI_BATCH));
  for (let batchStartIndex = 0; batchStartIndex < totalRequestedQuantity; batchStartIndex += batchSize) {
    plans.push({
      batchQuantity: Math.min(batchSize, totalRequestedQuantity - batchStartIndex),
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
  return Math.max(5500, batchQuantity * 2200);
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
  hookDurationSeconds?: number;
}) {
  const filters = asRecord(options.filters);
  const coreUser = firstFilterValue(filters, 'coreUser', 'Selected viewer');
  const painpoint = firstFilterValue(filters, 'painPoint', 'General user friction');
  const emotion = firstFilterValue(filters, 'emotion', 'Curiosity');
  const psp = firstFilterValue(filters, 'solution', options.appName);
  const angleName = firstFilterValue(filters, 'angle', 'Core angle');
  const visualType = firstFilterValue(filters, 'visualType', 'UGC');
  const selectedVisualFormat = normalizeFrameworkVisualFormat(visualType);
  const targetMarket = asStringList(filters.targetMarket).join(', ') || 'selected market';
  const direction = asText(options.ideaDescription) || angleName || painpoint;
  const hookDurationSeconds = options.hookDurationSeconds || inferRequestedHookDurationSeconds(asText(options.ideaDescription), 5);
  const hookTimeline = buildHookTimelineRows(hookDurationSeconds);
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
    const fallbackHookRows = hookTimeline.rows.map((row, rowIndex) => {
      if (rowIndex === 0) return row.replace('[visual shock / first frame]', hookVisual);
      if (rowIndex === 1) return row.replace('[context or pivot]', `mo ${options.appName} nhung chua reveal ket qua de tao curiosity gap`);
      return row
        .replace('[supporting visual beat]', `giu cung boi canh va dua mat ve man hinh ${options.appName}`)
        .replace('[curiosity gap / bridge to body]', `giu curiosity gap truoc khi sang Body`);
    }).join(' ');
    const rawIdea = {
      id: `P0-A${normalizedAngleIndex}-I${displayIndex}`,
      title: `Idea ${displayIndex + 1}: ${pattern.hookPrimary}`,
      duration: options.duration,
      creativeType: selectedVisualFormat,
      meta: {
        builderVersion: 'creative_idea_engine_v2_1_local_backup',
        pillar: painpoint,
        pillarIndex: 0,
        angleName,
        angleType: 'Curiosity',
        angleDesc: direction,
        hookPrimary: pattern.hookPrimary,
        hookAlt1: pattern.hookAlt1,
        hookAlt2: pattern.hookAlt2,
        hookArchetype: 'POV Narrative',
        hookAlt1Archetype: 'Before After Demo',
        hookAlt2Archetype: 'Demo-Magic',
        emotionJourney: `${emotion} -> Hope -> Satisfaction`,
        bodyMotivationPattern: 'Demo-Story',
        ctaFrictionReducer: '1 tap',
        estimatedThumbStop: 'Medium',
        ideaReasoning: `Fallback giu dung painpoint "${painpoint}" va bien no thanh canh co the quay ngay.`,
        visualRefNotes: `${selectedVisualFormat} cho ${targetMarket}; mở bằng cảnh thật cho thấy "${painpoint}" trước khi demo app.`,
        talentProfile: coreUser,
        dontDo: 'Do not show a generic app screen without the selected pain-point object or moment.',
        track: visualType.toLowerCase().includes('motion') ? 'C' : 'B',
        trackReason: `Fallback pattern "${pattern.creativeType}" keeps angle "${angleName}" visible inside ${selectedVisualFormat}.`,
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
        durationSeconds: hookDurationSeconds,
        visual: `Sec 0-${formatTimelineSecond(hookDurationSeconds)} (THE HOOK - max ${getRule4MaxSceneCount(hookDurationSeconds)} scenes): ${fallbackHookRows}`,
        voice: pattern.hookVoice,
        textOverlay: pattern.hookPrimary,
        viTranslation: translateKnownHookVoiceToVietnamese(pattern.hookVoice, { painpoint, appName: options.appName }),
        viewerProfile: coreUser,
        viewerEmotion: `Người xem thấy ${emotion} vì điểm kẹt xuất hiện trước phần giải thích.`,
        painpointImpact: `Painpoint trở nên cụ thể qua vật thể hoặc hành động đầu tiên.`,
        whyTheyStopScrolling: `Hook đặt câu hỏi trực diện và làm điểm kẹt hiện ra ngay lập tức.`,
      },
      body: {
        visual: `Sec 5-18 (THE BODY): Demo-Story. ${bodyVisual}`,
        voice: pattern.bodyVoice,
        textOverlay: pattern.bodyOverlay,
        viTranslation: `Demo ${psp} như cách giải quyết trực tiếp cho painpoint đã chọn.`,
      },
      cta: {
        visual: `Sec 18-25 (THE CTA): ${ctaVisual}`,
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
        visualType: selectedVisualFormat,
      }),
      { angleIndex: normalizedAngleIndex, ideaIndex: displayIndex, pillar: painpoint }
    );
  });
}

function hasVietnameseCopyCue(text: string): boolean {
  const normalized = normalizeCompareText(text);
  return hasVietnameseDiacritics(text)
    || /\b(?:nguoi|khong|phong|nha|thiet|ke|noi|that|can|muon|nhung|dang|nhin|thay|choang|huyet|tim|nhip|suc|khoe|dien|thoai|anh|video|mien|phi|thu|ngay)\b/.test(normalized);
}

function hasVietnameseDiacritics(text: string): boolean {
  return /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text);
}

function translateKnownHookVoiceToVietnamese(sourceVoice: string, context: { painpoint?: string; appName?: string }) {
  const voice = sourceVoice.trim();
  if (!voice) return '';
  if (hasVietnameseDiacritics(voice)) return voice;

  const normalized = normalizeCompareText(voice);
  const painpoint = context.painpoint?.trim() || 'điểm kẹt này';
  const appName = context.appName?.trim() || 'app';

  if (/one\b.*tap\b.*problem\b.*obvious/.test(normalized)) {
    return 'Chỉ một lần chạm đã làm vấn đề hiện ra rõ ràng.';
  }
  if (/do\s+not\b.*capture\b.*keep\b.*guessing/.test(normalized)) {
    return 'Nếu không ghi lại khoảnh khắc đó, bạn sẽ cứ phải đoán.';
  }
  if (/catch\b.*signal\b.*pointed\b.*out/.test(normalized)) {
    return 'Bạn có kịp nhận ra tín hiệu đó trước khi tôi chỉ ra không?';
  }
  if (/only\b.*notice\b.*after\b.*repeats/.test(normalized)) {
    return 'Nhiều người chỉ nhận ra điều này sau khi nó lặp lại quá nhiều lần.';
  }
  if (/feeling\b.*more\b.*annoying\b.*looks/.test(normalized)) {
    return 'Đó là lý do cảm giác này khó chịu hơn vẻ ngoài của nó.';
  }
  if (/miss\b.*signal\b.*again/.test(normalized)) {
    return 'Đừng bỏ lỡ tín hiệu này thêm lần nữa.';
  }
  if (/notice\b.*before\b.*became\b.*problem/.test(normalized)) {
    return 'Bạn có nhận ra điều này trước khi nó thành vấn đề không?';
  }
  if (/shortcut\b.*starts\b.*moment\b.*skip/.test(normalized)) {
    return 'Lối tắt bắt đầu ngay ở khoảnh khắc mà hầu hết mọi người bỏ qua.';
  }
  if (/still\b.*getting\b.*stuck\b.*step/.test(normalized)) {
    return 'Bạn vẫn đang bị kẹt ở bước này à?';
  }
  if (/open\b.*test/.test(normalized)) {
    return `Mở ${appName} và thử ngay.`;
  }

  return `Câu hook nhấn thẳng vào "${painpoint}" để người xem chú ý ngay.`;
}

function looksLikeHookVoiceExplanation(text: string): boolean {
  const normalized = normalizeCompareText(text);
  return /^(?:giu dung|van giu|cho thay|demo|keu goi|mo bang angle)\b/.test(normalized)
    || /\b(?:painpoint|pain point|noi dau)\b.*\b(?:angle|demo|giai quyet|nguoi xem|mo bang)\b/.test(normalized);
}

function hasUntranslatedAudienceCopyCue(text: string): boolean {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;
  const foreignTokens = normalized.match(/\b(?:speaker|perdeu|foto|viagem|memoria|cheia|camara|telemovel|espaco|proxima|duplicados|desfocados|lixo|limpa|quando|espera|travou|ficheiros|recupera|fotografar|sem|para|comecar|esta|estao|voce|uma|the|you|your|camera|storage|photo|video|clean|duplicate|blurred|trash|cuando|llena|viaje|espacio|siguiente|basura)\b/g) || [];
  const vietnameseTokens = normalized.match(/\b(?:nguoi|ban|toi|minh|bo|lo|anh|chuyen|di|du|lich|nho|day|don|dep|trung|mo|rac|may|dien|thoai|neu|khi|hay|da|dang|vua|roi|sach|nhanh)\b/g) || [];
  return foreignTokens.length >= 2 && foreignTokens.length > vietnameseTokens.length;
}

function hasGermanCopyCue(text: string): boolean {
  const normalized = normalizeCompareText(text);
  return /\b(?:ich|mich|mir|mein|meine|nach|beim|warum|wollte|dachte|merkte|brauchte|nicht|ohne|aber|alte|geraet|gerat|blutdruck|messen|klassische|arztgespraech|schlafengehen|treppensteigen|wartezimmer|spaziergang)\b/.test(normalized);
}

function hasVietnameseAngleCue(text: string): boolean {
  return hasVietnameseDiacritics(text)
    || /\b(?:toi|ban|nguoi|khong|nhung|van|can|muon|khi|luc|moi|cu|may|do|kiem|tra|theo|doi|nhip|tim|huyet|ap|suc|khoe|lo|lang|roi|ro|rang|tinh|huong|khoanh|khac|cuoc|song|du|da|chon|goc)\b/.test(normalizeCompareText(text));
}

function inferGenerationCopyLanguage(input: {
  coreUserValues: string[];
  explicitLanguageValues?: string[];
  painPointValues: string[];
  emotionValues: string[];
  angleValues: string[];
  ideaDescription?: string;
  targetLang: string;
}) {
  for (const languageValue of input.explicitLanguageValues || []) {
    const explicitLanguage = normalizeOutputLanguageLabel(languageValue);
    if (explicitLanguage) return explicitLanguage;
  }

  const targetLanguage = normalizeOutputLanguageLabel(input.targetLang);
  if (targetLanguage) return targetLanguage;

  const briefText = [
    ...input.coreUserValues,
    ...input.painPointValues,
    ...input.emotionValues,
    ...input.angleValues,
    input.ideaDescription || '',
  ].join(' ');

  const audienceLanguage = normalizeOutputLanguageLabel(briefText);
  if (audienceLanguage) return audienceLanguage;
  if (hasVietnameseCopyCue(briefText) && /\b(?:vietnamese|tieng viet|viet nam|vietnam|vn|nguoi viet)\b/.test(normalizeCompareText(briefText))) return 'Vietnamese';
  return 'English';
}

function normalizeOutputLanguageLabel(value: string): string {
  const normalized = normalizeCompareText(value);
  if (!normalized) return '';
  if (/\b(?:english|en|us|usa|united states|america|american|my|nguoi my|uk|canada|australia)\b/.test(normalized)) return 'English';
  if (/\b(?:vietnamese|vi|viet|vietnam|viet nam|nguoi viet)\b/.test(normalized)) return 'Vietnamese';
  if (/\b(?:japanese|jp|japan|nhat|nguoi nhat)\b/.test(normalized)) return 'Japanese';
  if (/\b(?:korean|ko|korea|han|nguoi han)\b/.test(normalized)) return 'Korean';
  if (/\b(?:spanish|es|spain|latam|latin|tay ban nha)\b/.test(normalized)) return 'Spanish';
  if (/\b(?:portuguese|pt|brazil|brasil|bo dao nha)\b/.test(normalized)) return 'Portuguese';
  if (/\b(?:german|de|germany|deutsch|duc|nguoi duc)\b/.test(normalized)) return 'German';
  if (/\b(?:french|fr|france|phap|nguoi phap)\b/.test(normalized)) return 'French';
  if (/\b(?:thai|thailand|thai lan)\b/.test(normalized)) return 'Thai';
  if (/\b(?:indonesian|indonesia)\b/.test(normalized)) return 'Indonesian';
  if (/\b(?:malay|malaysia)\b/.test(normalized)) return 'Malay';
  return '';
}

function formatTimelineSecond(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',').replace(',', '.');
}

type HookDurationPlan = {
  seconds: number;
  explicit: boolean;
  reason: string;
  maxScenes: number;
};

function clampHookDurationSeconds(value: number, explicit: boolean): number {
  const upperLimit = explicit ? 10 : 8;
  return Math.round(Math.min(upperLimit, Math.max(3, value)) * 10) / 10;
}

function extractExplicitHookDurationSeconds(text?: string): number | null {
  const raw = text || '';
  const normalized = normalizeCompareText(raw);
  const hasHookCue = /\b(?:hook|opening|video|clip|mo dau|dau video|first seconds?|giay dau)\b/i.test(raw)
    || /\b(?:hook|opening|video|clip|mo dau|dau video|first seconds?|giay dau)\b/.test(normalized);
  if (!hasHookCue) return null;

  const patterns = [
    /(?:hook|opening|video|clip|mo dau|dau video|first seconds?)\D{0,24}(\d+(?:[.,]\d+)?)\s*(?:s|sec|second|seconds|giay)/i,
    /(\d+(?:[.,]\d+)?)\s*(?:s|sec|second|seconds|giay)\D{0,24}(?:hook|opening|video|clip|mo dau|dau video|first seconds?)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern) || normalized.match(pattern);
    if (!match) continue;
    const parsed = Number(match[1].replace(',', '.'));
    if (Number.isFinite(parsed) && parsed >= 3 && parsed <= 15) {
      return clampHookDurationSeconds(parsed, true);
    }
  }

  return null;
}

function inferHookDurationFromBriefText(text?: string, fallback = 5): number {
  const raw = text || '';
  const normalized = normalizeCompareText(raw);
  if (!normalized) return fallback;

  const actionHits = normalized.match(/\b(?:show|open|tap|scan|measure|check|compare|reveal|zoom|switch|cut|turn|ask|reply|hold|touch|look|mo|bam|cham|do|kiem tra|so sanh|lat|quay|cat|chuyen|hoi|tra loi|cam|nhin|dat)\b/g) || [];
  const sentenceCount = raw.split(/[\n.!?;]+/).map(part => part.trim()).filter(Boolean).length;
  const hasTwoPersonCue = /\b(?:two people|2 people|dialogue|conversation|interview|podcast|doctor|patient|couple|husband|wife|friend|hai nguoi|2 nguoi|bac si|benh nhan|vo chong|ban be)\b/.test(normalized);
  const hasDemoCue = /\b(?:demo|proof|screen recording|app|iphone|camera|measure|scan|tap|chart|number|before after|compare|split|voiceover|text|podcast|do bang|kiem tra|man hinh|bieu do|chi so)\b/.test(normalized);
  const hasComplexCue = /\b(?:split screen|side by side|trend|reference|transition|montage|ugc plus demo|motion graphic|chia doi|chuyen canh|so sanh)\b/.test(normalized);
  const hasTwoBeatCue = /\b(?:then|after|sau do|roi|->|=>|pivot|chuyen sang|nhung)\b/.test(normalized);

  if (hasComplexCue || actionHits.length >= 4 || sentenceCount >= 4) return 8;
  if (hasTwoPersonCue || hasDemoCue || actionHits.length >= 3 || sentenceCount >= 3) return 6;
  if (hasTwoBeatCue || actionHits.length >= 2 || sentenceCount >= 2) return 5;
  return 3;
}

function inferRequestedHookDurationSeconds(text?: string, fallback = 5): number {
  const explicit = extractExplicitHookDurationSeconds(text);
  if (explicit) return explicit;
  return clampHookDurationSeconds(inferHookDurationFromBriefText(text, fallback), false);
}

function resolveHookDurationPlan(input: {
  ideaDescription?: string;
  painPointValues?: string[];
  featureContext?: string;
  visualType?: string;
  angleContext?: string;
  coreUserValues?: string[];
  trendingStructures?: string[];
  fallback?: number;
}): HookDurationPlan {
  const explicit = extractExplicitHookDurationSeconds(input.ideaDescription);
  const contextText = [
    input.ideaDescription,
    ...(input.painPointValues || []),
    input.featureContext,
    input.visualType,
    input.angleContext,
    ...(input.coreUserValues || []),
    ...(input.trendingStructures || []),
  ].filter(Boolean).join('\n');
  const rawSeconds = explicit || inferHookDurationFromBriefText(contextText, input.fallback || 5);
  const seconds = clampHookDurationSeconds(rawSeconds, Boolean(explicit));
  return {
    seconds,
    explicit: Boolean(explicit),
    reason: explicit ? 'explicit operator hook length' : 'inferred from idea description and selected chips',
    maxScenes: getRule4MaxSceneCount(seconds),
  };
}

function buildHookTimelineRows(durationSeconds: number) {
  const normalizedDuration = clampHookDurationSeconds(durationSeconds, durationSeconds > 8);
  const maxScenes = getRule4MaxSceneCount(normalizedDuration);
  const ranges: Array<{ start: number; end: number }> = [];

  if (maxScenes === 1) {
    ranges.push({ start: 0, end: normalizedDuration });
  } else if (maxScenes === 2) {
    const split = Math.round((normalizedDuration / 2) * 2) / 2;
    ranges.push({ start: 0, end: split }, { start: split, end: normalizedDuration });
  } else if (maxScenes === 3) {
    const firstEnd = 2.5;
    const lastStart = Math.max(firstEnd + 2.5, normalizedDuration - 2.5);
    ranges.push({ start: 0, end: firstEnd }, { start: firstEnd, end: lastStart }, { start: lastStart, end: normalizedDuration });
  } else {
    ranges.push({ start: 0, end: 2.5 }, { start: 2.5, end: 5 }, { start: 5, end: 7.5 }, { start: 7.5, end: normalizedDuration });
  }

  const labels = ranges.map(range => `${formatTimelineSecond(range.start)}-${formatTimelineSecond(range.end)}s`);
  const rows = labels.map((label, index) => {
    if (index === 0) return `${label}: [visual shock / first frame]`;
    if (index === 1) return `${label}: Text hien: "[hook_text_overlay]" | Character speech: "[hook_character_speech]" if a visible person talks, otherwise Voiceover: "[hook_vo]" | [context or pivot]`;
    if (index === labels.length - 1) return `${label}: [curiosity gap / bridge to body]`;
    return `${label}: [supporting visual beat]`;
  });

  return {
    phase1End: ranges[0]?.end || normalizedDuration,
    phase2End: ranges[1]?.end || normalizedDuration,
    finalEnd: normalizedDuration,
    row1: rows[0] || '',
    row2: rows[1] || '',
    row3: rows[2] || '',
    rows,
    textWindow: labels[Math.min(1, labels.length - 1)] || `0-${formatTimelineSecond(normalizedDuration)}s`,
    example: rows
      .map((row, index) => (
        index === 0
          ? row.replace('[visual shock / first frame]', 'Vietnamese visual shock with Position anchor, Contact anchor, and Physical action anchor')
          : row
              .replace('[context or pivot]', 'Vietnamese context/pivot')
              .replace('[curiosity gap / bridge to body]', 'Vietnamese curiosity gap / bridge to body')
              .replace('[supporting visual beat]', 'Vietnamese supporting visual beat')
      ))
      .join('\\n'),
  };
}

function buildHookTimingRule(plan: HookDurationPlan, timeline: ReturnType<typeof buildHookTimelineRows>): string {
  return `- Hook duration decision: ${formatTimelineSecond(plan.seconds)}s (${plan.reason}); keep hooks usually under 8s unless the operator explicitly wrote a longer hook.
- visual_scene_1 MUST cover 0-${formatTimelineSecond(plan.seconds)}s and render as HOOK (${formatTimelineSecond(plan.seconds)}s).
- Use at most ${plan.maxScenes} timestamp row(s)/camera angle(s), based on floor(${formatTimelineSecond(plan.seconds)} / 2.5). Each row must last at least 2.5s.
- Recommended timing rows:
  ${timeline.rows.join('\n  ')}
- Text overlay, voiceover, and on-camera speech may happen inside an existing row; they do not create a new camera angle.
- If a visible person talks, that line is character speech, not voiceover. In 2-person dialogue/podcast/interview hooks, use role-labelled hook_character_speech such as "Speaker 1: ... / Speaker 2: ..." and keep hook_vo empty unless there is a true off-camera narrator.
- Split-screen, side-by-side, or complex transition is allowed only when every pane/beat stays visible for about 3s.`;
}

function buildOperatorInteractionDirective(ideaDescription?: string): string {
  const normalized = normalizeCompareText(ideaDescription || '');
  if (!normalized) return '';

  const hasPodcastCue = /\b(?:podcast|talk show|interview|phong van|tro chuyen|doi thoai|hoi dap|toa dam)\b/.test(normalized);
  const hasTwoPersonCue = /\b(?:two people|2 people|two-person|2-person|2 nguoi|hai nguoi|hai nhan vat|2 nhan vat|bac si|benh nhan|doctor|patient|host|guest|khach moi)\b/.test(normalized);
  if (!hasPodcastCue && !hasTwoPersonCue) return '';

  return `\n[LOCKED INTERACTION FORMAT - OPERATOR DIRECTIVE]\n- The operator requested a 2-person conversation/podcast/interview structure. Treat this as the primary creative format, not a loose suggestion.\n- Do not replace it with a solo UGC, solo phone demo, silent app demo, or generic screen recording.\n- visual_scene_1 must show two visible people in the requested relationship/roles, e.g. doctor and patient if those words appear, with podcast/interview framing, table/mic/phone prop, eye-line, and body posture.\n- hook_character_speech is required. Use short role-labelled on-camera dialogue in the selected copy language. Do not put a visible person's line into hook_vo. script_vo may include simple role-labelled dialogue; do not make it only narrator voice.\n- Keep the exchange simple and Rule-4 compliant: one conversational beat can live inside one 2.5-3s scene/camera angle. The app/feature action can enter after that first dialogue beat.\n- For health apps, doctor/patient is allowed as a content format, but never imply diagnosis, treatment, cure, disease detection, or doctor replacement.`;
}

function buildOperatorIdeaBriefBlock(input: {
  ideaDescription?: string;
  hookPlan: HookDurationPlan;
  outputLanguage: string;
}): string {
  const brief = clampPromptContext(input.ideaDescription, 900) || 'N/A';
  const interactionDirective = buildOperatorInteractionDirective(input.ideaDescription);
  return `## OPERATOR IDEA BRIEF - HIGH PRIORITY
This field is a creative directive, not optional notes. Use it to decide hook structure, trend/reference adaptation, visual execution, mood, and pacing before writing ideas.
- Operator idea description: ${brief}
- Hook duration: ${formatTimelineSecond(input.hookPlan.seconds)}s (${input.hookPlan.explicit ? 'explicitly requested' : 'AI inferred from content'}).
- If the operator describes a trend/reference/scene structure, adapt that structure directly into the hook/body/CTA instead of generating a generic app demo.
- If the operator does not specify seconds, infer a natural hook length from the content: 1 simple beat = 3s, 2 clear beats = 5s, demo/proof/two-person interaction = 6-8s.
- Keep the title and visual production prose Vietnamese. Text hien / CTA must include both Vietnamese and ${input.outputLanguage} when ${input.outputLanguage} is not Vietnamese, separated with " / ". Translate Voiceover / CHARACTER SPEECH into ${input.outputLanguage}.${interactionDirective}`;
}

function buildSelectedStrategyLockBlock(input: {
  visualType: string;
  coreUserValues: string[];
  emotionValues: string[];
  marketValues: string[];
  outputLanguage: string;
}): string {
  const lockedVisualType = normalizeFrameworkVisualFormat(input.visualType) || input.visualType || 'selected Visual/Theme';
  const coreUser = input.coreUserValues.join('; ') || 'selected core user';
  const emotion = input.emotionValues.join(' -> ') || 'selected emotion';
  const market = input.marketValues.join('; ') || 'selected market';
  const normalizedVisual = normalizeCompareText(lockedVisualType);
  const visualExecutionNote = normalizedVisual.includes('2d')
    ? '- 2D Animation execution: every visual_scene must explicitly be illustrated/2D/vector/cartoon animation. Characters, rooms, phones, heat icons, duplicate files, and UI panels are drawn elements. Do not output live-action UGC, handheld footage, selfie, real actor footage, or Motion Graphic as the main format.'
    : normalizedVisual.includes('3d')
      ? '- 3D Animation execution: every visual_scene must be 3D-rendered/CGI. Do not switch to live-action UGC, flat 2D, or pure screen recording.'
      : normalizedVisual.includes('motion')
        ? '- Motion Graphic execution means 2D motion graphics only: animated typography, flat vector shapes, icons, charts, app UI panels, data callouts, arrows, labels, and simple infographic transitions. Do not use podcast/interview/host/guest/Speaker 1/Speaker 2, real people, living-room dialogue, handheld footage, 3D render/CGI, or full 2D character/cartoon scene animation.'
        : normalizedVisual.includes('pov')
          ? '- POV execution: every visual_scene must be POV/screen-perspective. Do not label it UGC just because a person is implied.'
          : '- UGC execution: every visual_scene should feel like real social footage. Do not switch to animation or motion graphic as the main format.';

  return `## SELECTED FILTER LOCK - MUST FOLLOW
- Core user is locked as TARGET VIEWER/AUDIENCE: ${coreUser}. This tells who the ad is for, what they think/do, and why they act. Do not automatically make every on-screen person the same age/demographic unless the brief explicitly asks. Choose talent/objects/scenes that make this viewer stop scrolling.
- Market/culture is locked: ${market}. Use local setting, home/work details, skin tone/hair/clothing cues, props, and behavior that fit this market. Voice/speech language is ${input.outputLanguage}; market does not change Vietnamese hook text, CTA, or visual prose language.
- Emotion trigger is locked as VIEWER RESPONSE: ${emotion}. The hook should make the viewer feel this emotion. Do not treat it as only the character's mood.
- Visual/Theme is locked: ${lockedVisualType}. Every idea in this batch must have creativeType exactly "${lockedVisualType}".
${visualExecutionNote}
- The selected Angle is only the strategic angle. It must not override Visual/Theme. If an angle/reference implies podcast/interview/reaction but Visual/Theme is Motion Graphic, translate it into typography, UI, icons, charts, and data motion instead.
- Scene selection must follow the selected Angle/Visual. Do not default to kitchen, living room, sofa, or generic apartment unless the selected painpoint or angle requires it. For TV/editor/news/fact angles, use newsroom/studio desk/lower-third/panel/chart/infographic environments.
- Diversity means different angle_type, first action, prop/blocker, composition, reveal, and wording inside "${lockedVisualType}". Diversity does NOT mean changing the selected Visual/Theme format.`;
}

function trimWordsLocal(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(' ') : text.trim();
}

function trimOverlayWordsLocal(text: string, maxWordsPerLanguage: number): string {
  const clean = text.trim();
  const separator = [' / ', '\n', ' | ', ' — ', ' -- '].find(item => clean.includes(item));
  if (!separator) return trimWordsLocal(clean, maxWordsPerLanguage);

  return clean
    .split(separator)
    .map(part => trimWordsLocal(part, maxWordsPerLanguage))
    .filter(Boolean)
    .join(separator);
}

function readLooseText(record: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function readLooseArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter(item => Object.keys(item).length > 0)
    : [];
}

function collectLeanIdeaRecords(input: unknown): Array<{
  pillarRecord: Record<string, unknown>;
  angleRecord: Record<string, unknown>;
  ideaRecord: Record<string, unknown>;
  pillarIndex: number;
  angleIndex: number;
  ideaIndex: number;
}> {
  const output: Array<{
    pillarRecord: Record<string, unknown>;
    angleRecord: Record<string, unknown>;
    ideaRecord: Record<string, unknown>;
    pillarIndex: number;
    angleIndex: number;
    ideaIndex: number;
  }> = [];

  const inputRecord = asRecord(input);
  const wrappedRoots = !Array.isArray(input)
    ? readLooseArray(inputRecord.data ?? inputRecord.output ?? inputRecord.items ?? inputRecord.result)
    : [];
  const roots = Array.isArray(input) ? input : wrappedRoots.length > 0 ? wrappedRoots : [input];
  roots.forEach((root, rootIndex) => {
    const rootRecord = asRecord(root);
    if (Object.keys(rootRecord).length === 0) return;

    const angleRecords = readLooseArray(rootRecord.angles);
    if (angleRecords.length > 0) {
      angleRecords.forEach((angleRecord, angleFallbackIndex) => {
        const ideas = readLooseArray(angleRecord.ideas);
        ideas.forEach((ideaRecord, ideaFallbackIndex) => {
          output.push({
            pillarRecord: rootRecord,
            angleRecord,
            ideaRecord,
            pillarIndex: Number(rootRecord.pillar_index ?? rootRecord.pillarIndex ?? rootIndex) || 0,
            angleIndex: Number(angleRecord.angle_index ?? angleRecord.angleIndex ?? angleFallbackIndex) || 0,
            ideaIndex: ideaFallbackIndex,
          });
        });
      });
      return;
    }

    const directIdeas = readLooseArray(rootRecord.ideas);
    if (directIdeas.length > 0) {
      directIdeas.forEach((ideaRecord, ideaFallbackIndex) => {
        output.push({
          pillarRecord: rootRecord,
          angleRecord: rootRecord,
          ideaRecord,
          pillarIndex: Number(rootRecord.pillar_index ?? rootRecord.pillarIndex ?? rootIndex) || 0,
          angleIndex: Number(rootRecord.angle_index ?? rootRecord.angleIndex ?? 0) || 0,
          ideaIndex: ideaFallbackIndex,
        });
      });
      return;
    }

    output.push({
      pillarRecord: rootRecord,
      angleRecord: rootRecord,
      ideaRecord: rootRecord,
      pillarIndex: Number(rootRecord.pillar_index ?? rootRecord.pillarIndex ?? 0) || 0,
      angleIndex: Number(rootRecord.angle_index ?? rootRecord.angleIndex ?? 0) || 0,
      ideaIndex: rootIndex,
    });
  });

  return output;
}

function overlayTextAt(overlays: string[], pattern: RegExp, fallback = '') {
  const match = overlays.find(line => pattern.test(line));
  return match ? match.replace(/^\s*\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?s?\s*:\s*/i, '').trim() : fallback;
}

function normalizeLeanCreativeOutput(
  input: unknown,
  defaults: {
    duration: string;
    appName: string;
    category?: string;
    pillar: string;
    coreUser: string;
    emotion: string;
    psp: string;
    angle: string;
    angleIndex: number;
    startIndex: number;
    hookDurationSeconds?: number;
    visualType?: string;
    outputLanguage?: string;
  }
): Record<string, unknown>[] {
  const records = collectLeanIdeaRecords(input);

  return records.map((record, index): Record<string, unknown> | null => {
    const { pillarRecord, angleRecord, ideaRecord } = record;
    const ideaIndex = defaults.startIndex + index;
    const pillar = readLooseText(pillarRecord, ['pillar'], defaults.pillar);
    const angleName = readLooseText(angleRecord, ['angle_name', 'angleName'], defaults.angle || 'Core angle');
    const angleType = readLooseText(angleRecord, ['angle_type', 'angleType'], 'Curiosity');
    const angleDesc = readLooseText(angleRecord, ['angle_desc', 'angleDesc'], `Idea for ${angleName}`);
    const rawHookText = readLooseText(ideaRecord, ['hook_text_overlay', 'hookTextOverlay', 'hook_primary', 'hookPrimary']);
    const rawHookVo = readLooseText(ideaRecord, ['hook_vo', 'hookVoiceover', 'hook_voiceover', 'voiceover']);
    let hookCharacterSpeech = readLooseText(ideaRecord, ['hook_character_speech', 'hookCharacterSpeech', 'characterSpeech'], '');
    let hookVoiceVi = readLooseText(
      ideaRecord,
      ['hook_voice_vi', 'hookVoiceVi', 'hook_vi_translation', 'hookViTranslation', 'vi_translation', 'viTranslation'],
      readLooseText(asRecord(ideaRecord.hook), ['hookVoiceVi', 'hook_voice_vi', 'viTranslation', 'vi_translation'])
    );
    let visualScene1 = readLooseText(ideaRecord, ['visual_scene_1', 'visualScene1'], readLooseText(asRecord(ideaRecord.hook), ['visual', 'script']));
    let visualScene2 = readLooseText(ideaRecord, ['visual_scene_2', 'visualScene2'], readLooseText(asRecord(ideaRecord.body), ['visual', 'script']));
    let visualScene3 = readLooseText(ideaRecord, ['visual_scene_3', 'visualScene3'], readLooseText(asRecord(ideaRecord.cta), ['visual', 'script']));
    const rawCtaText = readLooseText(
      ideaRecord,
      ['cta_text', 'ctaText'],
      readLooseText(asRecord(ideaRecord.cta), ['textOverlay', 'text', 'voice', 'voiceover'])
    );
    if (!rawHookText || !visualScene1 || !visualScene2 || !visualScene3 || !rawCtaText) {
      return null;
    }

    const hookText = trimOverlayWordsLocal(rawHookText, 8);
    let hookVo = trimWordsLocal(rawHookVo, 12);
    const ctaText = trimOverlayWordsLocal(rawCtaText, 6);
    visualScene1 = enforceSelectedVisualFormatInScene(visualScene1, defaults.visualType);
    visualScene2 = enforceSelectedVisualFormatInScene(visualScene2, defaults.visualType);
    visualScene3 = enforceSelectedVisualFormatInScene(visualScene3, defaults.visualType);
    if (isMotionGraphicVisual(defaults.visualType) && hookCharacterSpeech) {
      hookVo = hookVo || trimWordsLocal(stripRoleLabelsForVoiceover(hookCharacterSpeech), 12);
      hookCharacterSpeech = '';
    }
    if (!hookVoiceVi && /^vietnamese$/i.test(defaults.outputLanguage || '')) {
      hookVoiceVi = [hookCharacterSpeech, hookVo, hookText].filter(Boolean).join(' / ');
    }
    if (hookVoiceVi && (!hasVietnameseDiacritics(hookVoiceVi) || !hasVietnameseCopyCue(hookVoiceVi) || hasUntranslatedAudienceCopyCue(hookVoiceVi))) {
      hookVoiceVi = '';
    }
    const scriptVo = readLooseText(ideaRecord, ['script_vo', 'scriptVo'], [hookVo, readLooseText(asRecord(ideaRecord.body), ['voice', 'voiceover'], ''), ctaText].filter(Boolean).join(' '));
    const overlayRecords = readLooseArray(ideaRecord.text_overlays ?? ideaRecord.textOverlays);
    const overlays = overlayRecords
      .map(item => {
        const time = readLooseText(item, ['time']);
        const text = readLooseText(item, ['text']);
        return time && text ? `${time}: ${text}` : text;
      })
      .filter(Boolean);

    const bodyOverlay = overlayTextAt(overlays, /\b(?:6|9|12|15)\b/, readLooseText(asRecord(ideaRecord.body), ['textOverlay', 'text'], 'See the result'));
    const ctaOverlay = overlayTextAt(overlays, /\b(?:18|22|25)\b/, readLooseText(asRecord(ideaRecord.cta), ['textOverlay', 'text'], ctaText));
    const track = readLooseText(ideaRecord, ['track'], 'B').toUpperCase();
    const safeTrack = ['A', 'B', 'C'].includes(track) ? track : 'B';
    const lockedCreativeType = defaults.visualType?.trim() ? normalizeFrameworkVisualFormat(defaults.visualType) : '';
    const visualRefNotes = readLooseText(ideaRecord, ['visual_ref_notes', 'visualRefNotes']);
    const talentProfile = readLooseText(ideaRecord, ['talent_profile', 'talentProfile'], 'No talent specified');
    const marketInsight = readLooseText(ideaRecord, ['market_insight', 'marketInsight']);
    const countryVisualInsight = readLooseText(ideaRecord, ['country_visual_insight', 'countryVisualInsight'], marketInsight || visualRefNotes);
    const hookContextInsight = readLooseText(ideaRecord, ['hook_context_insight', 'hookContextInsight'], visualScene1);
    const cameraPlan = readLooseText(ideaRecord, ['camera_plan', 'cameraPlan'], visualRefNotes);

    return normalizeIdeaOutput({
      id: `P0-A${defaults.angleIndex}-I${ideaIndex}`,
      title: readLooseText(ideaRecord, ['title'], hookText || angleName || `Idea ${ideaIndex + 1}`),
      duration: defaults.duration,
      creativeType: lockedCreativeType || (safeTrack === 'A' ? 'Screen Recording' : safeTrack === 'C' ? 'Motion Graphic' : 'UGC'),
      meta: {
        builderVersion: 'creative_idea_engine_v2_1_lean',
        pillar,
        pillarIndex: 0,
        angleName,
        angleType,
        angleDesc,
        hookPrimary: hookText,
        hookAlt1: readLooseText(ideaRecord, ['hook_alt_1_text', 'hookAlt1Text', 'hook_alt_1', 'hookAlt1']),
        hookAlt2: readLooseText(ideaRecord, ['hook_alt_2_text', 'hookAlt2Text', 'hook_alt_2', 'hookAlt2']),
        hookArchetype: readLooseText(ideaRecord, ['hook_archetype', 'hookArchetype']),
        hookAlt1Archetype: readLooseText(ideaRecord, ['hook_alt_1_archetype', 'hookAlt1Archetype']),
        hookAlt2Archetype: readLooseText(ideaRecord, ['hook_alt_2_archetype', 'hookAlt2Archetype']),
        emotionJourney: readLooseText(ideaRecord, ['emotion_journey', 'emotionJourney'], defaults.emotion),
        bodyMotivationPattern: readLooseText(ideaRecord, ['body_motivation_pattern', 'bodyMotivationPattern'], 'Demo-Story'),
        ctaFrictionReducer: readLooseText(ideaRecord, ['cta_friction_reducer', 'ctaFrictionReducer'], 'Free'),
        estimatedThumbStop: readLooseText(ideaRecord, ['estimated_thumb_stop', 'estimatedThumbStop'], 'Medium'),
        ideaReasoning: readLooseText(ideaRecord, ['idea_reasoning', 'ideaReasoning'], angleDesc),
        visualRefNotes,
        talentProfile,
        characterVisual: readLooseText(ideaRecord, ['character_visual', 'characterVisual'], talentProfile),
        marketInsight,
        countryVisualInsight,
        hookContextInsight,
        cameraPlan,
        voiceDirection: readLooseText(ideaRecord, ['voice_direction', 'voiceDirection'], hookCharacterSpeech ? 'Voice follows the visible character in the hook.' : 'Use voiceover only when no visible character speaks.'),
        sceneFamily: readLooseText(ideaRecord, ['scene_family', 'sceneFamily'], angleName),
        dontDo: readLooseText(ideaRecord, ['dont_do', 'dontDo'], 'Do not make the opening generic or studio-like.'),
        track: safeTrack,
        trackReason: readLooseText(ideaRecord, ['track_reason', 'trackReason']),
        priority: readLooseText(ideaRecord, ['priority'], 'A').toUpperCase(),
        overlaySequence: overlays,
      },
      framework: {
        coreUser: defaults.coreUser,
        painpoint: pillar,
        emotion: defaults.emotion,
        psp: defaults.psp,
      },
      explanation: readLooseText(ideaRecord, ['idea_reasoning', 'explanation'], angleDesc),
      hook: {
        durationSeconds: defaults.hookDurationSeconds || 5,
        visual: visualScene1,
        characterSpeech: hookCharacterSpeech,
        voiceover: hookVo,
        voice: hookVo || hookCharacterSpeech,
        textOverlay: hookText,
        text: hookText,
        script: visualScene1,
        viTranslation: hookVoiceVi,
      },
      body: {
        visual: visualScene2,
        voiceover: scriptVo,
        voice: scriptVo,
        textOverlay: bodyOverlay,
        text: bodyOverlay,
        script: visualScene2,
      },
      cta: {
        visual: visualScene3,
        voiceover: ctaText,
        voice: ctaText,
        textOverlay: ctaOverlay,
        text: ctaOverlay,
        script: visualScene3,
        endCard: `${defaults.appName} - ${ctaText}`,
      },
    }, {
      duration: defaults.duration,
      appName: defaults.appName,
      pillar,
      visualType: defaults.visualType,
    });
  }).filter((item): item is Record<string, unknown> => Boolean(item));
}

function buildQuickSceneLaneBlock(input: {
  batchStartIndex: number;
  batchQuantity: number;
  totalQuantity: number;
  visualType: string;
  market: string;
}): string {
  if (input.totalQuantity <= 1) return '';

  const lanes = [
    {
      sceneFamily: 'morning routine',
      context: 'bedside, kitchen counter, pill box, first phone check, family/home habit',
      camera: 'medium wide setup -> close-up prop -> POV phone proof',
      voice: 'single visible character, quiet first-person concern',
    },
    {
      sceneFamily: 'home office stress',
      context: 'desk, laptop call, calendar pressure, notification or spreadsheet as proof object',
      camera: 'over-shoulder -> close-up screen/hand -> split UI',
      voice: 'character speaks while reacting to the work moment',
    },
    {
      sceneFamily: 'commute or parking lot',
      context: 'car seat, bus stop, elevator, appointment reminder, bag or keys as blocker',
      camera: 'wide establishing -> handheld medium -> phone POV',
      voice: 'short breathy line from the person in the scene',
    },
    {
      sceneFamily: 'pharmacy or store aisle',
      context: 'shelf labels, receipt, product comparison, public errand behavior native to the market',
      camera: 'tracking aisle shot -> close-up label -> top-down phone check',
      voice: 'character whisper or direct thought tied to the visible prop',
    },
    {
      sceneFamily: 'family check-in',
      context: 'dining table, sofa edge, spouse/parent/child concern, shared phone screen as social proof',
      camera: 'two-shot wide -> reaction close-up -> over-shoulder phone',
      voice: 'visible character answers the family member; no fake Speaker 1/2 unless both appear',
    },
    {
      sceneFamily: 'before appointment prep',
      context: 'clinic waiting room, form, notes app, calendar, app log as reference before speaking to a professional',
      camera: 'POV form -> close-up hand/phone -> medium waiting room',
      voice: 'calm first-person line, no diagnosis or treatment promise',
    },
    {
      sceneFamily: 'grocery or daily errand',
      context: 'basket, nutrition label, queue, small practical decision, market-native packaging/colors',
      camera: 'wide aisle -> macro prop -> fast match cut to app UI',
      voice: 'character voice follows the hand action and object choice',
    },
    {
      sceneFamily: 'gym locker or post-walk pause',
      context: 'locker, towel, water bottle, smartwatch/phone comparison, recovery moment without medical claims',
      camera: 'low angle locker -> close-up wrist/phone -> POV app action',
      voice: 'visible character says a short self-check line',
    },
    {
      sceneFamily: 'travel day',
      context: 'airport/ride-share/hotel room, carry-on, reminder, unfamiliar routine disrupting the normal habit',
      camera: 'wide location cue -> close-up carry-on/phone -> split-screen reminder',
      voice: 'first-person voice tied to travel friction',
    },
    {
      sceneFamily: 'comment reply or social proof',
      context: 'viewer comment, saved screenshot, friend message, skeptical question answered with app proof',
      camera: 'screen-record style -> comment close-up -> creator reaction/phone POV',
      voice: 'character answers the visible comment directly',
    },
  ];

  const assigned = Array.from({ length: input.batchQuantity }, (_, offset) => {
    const globalSlot = input.batchStartIndex + offset;
    const lane = lanes[globalSlot % lanes.length];
    return `${globalSlot + 1}/${input.totalQuantity}: scene_family="${lane.sceneFamily}" | context=${lane.context} | camera=${lane.camera} | voice=${lane.voice}`;
  }).join('\n');

  return `SLOT DIVERSITY PLAN
Visual type remains locked as "${input.visualType}" for every slot.
Market/context must feel native to: ${input.market || 'selected market'}.
For each idea, use the assigned scene_family exactly and build a different first frame, prop, camera action, and voice opening:
${assigned}`;
}

function buildFastQuickGeneratePrompt(input: {
  appId?: string;
  quantity: number;
  batchStartIndex: number;
  totalQuantity: number;
  appName: string;
  appCategory: string;
  coreUserValues: string[];
  painPointValues: string[];
  emotionValues: string[];
  featureContext: string;
  visualType: string;
  targetMarketValues: string[];
  outputLanguage: string;
  angleContext: string;
  rawBrief?: string;
  systemRule?: string;
  previousIdeas?: string;
  trendingTopics: string[];
  trendingStructures: string[];
  seasonalVisualBlock?: string;
  filterConsistencyBlock?: string;
}) {
  const primaryPillar = input.painPointValues[0] || 'General user friction';
  const coreUser = input.coreUserValues.join('; ') || 'General mobile app user';
  const emotionJourney = input.emotionValues.join(' -> ') || 'Curiosity';
  const market = input.targetMarketValues.join(', ') || 'Global';
  const rawBrief = clampPromptContext(input.rawBrief, 1200) || 'N/A';
  const savedRule = compactSystemRule(input.systemRule, 1600);
  const trends = input.trendingTopics.length ? input.trendingTopics.join('; ') : 'None';
  const importedStructures = input.trendingStructures.length ? input.trendingStructures.slice(0, 2).join('\n') : 'None';
  const avoidIdeas = clampPromptContext(input.previousIdeas, 1200) || 'None yet';
  const slotDiversityPlan = buildQuickSceneLaneBlock({
    batchStartIndex: input.batchStartIndex,
    batchQuantity: input.quantity,
    totalQuantity: input.totalQuantity,
    visualType: input.visualType,
    market,
  });

  return `FAST GENERATE MODE
Use the saved system_rule as the fixed framework. Do not ask follow-up questions.

SAVED system_rule:
${savedRule}

INPUT FOR THIS RUN
- app_id: ${input.appId || 'N/A'}
- app: ${input.appName}
- category: ${input.appCategory}
- core_user: ${coreUser}
- painpoint: ${primaryPillar}
- PSP / feature: ${input.featureContext}
- emotion: ${emotionJourney}
- visual_type: ${input.visualType} (locked creativeType)
- trend / angle: ${input.angleContext || 'choose the strongest angle from brief'}
- market: ${market}
- voice_language: ${input.outputLanguage}
- quantity: ${input.quantity}
- quick_brief: ${rawBrief}
- trending hooks: ${trends}
- imported trend structure: ${importedStructures}
- avoid previous ideas / scene families: ${avoidIdeas}
${input.seasonalVisualBlock || ''}
${input.filterConsistencyBlock || ''}
${slotDiversityPlan}

CORE RULES
- Generate exactly ${input.quantity} ideas.
- Selected inputs are locked. If quick_brief conflicts with selected chips, keep selected chips unless quick_brief is more specific inside the same meaning.
- Make every idea visually different: different scene_family, first frame, daily context, object/blocker, camera action, proof object, and payoff.
- If generating more than 1 idea, at most ONE idea in the full request may use dizziness/falling/collapse/holding head as the hook. Do not make near-identical "person gets dizzy and falls" ideas.
- Choose unique scene_family labels from varied market-native moments, for example: morning routine, home office, commute/parking lot, pharmacy aisle, gym locker, telehealth note, family check-in, grocery trip, travel day, smartwatch comparison, desk stress, before-doctor-visit prep.
- Hook context must come from country/core-user insight for ${market}. Use locally plausible home/work/public spaces, clothing, props, phone behavior, family/work norms, and app proof. Avoid stereotypes and avoid generic empty rooms.
- Character visual is required when a person appears: age range, gender presentation when relevant, skin tone/ethnicity/country cue, outfit, body language, and prop. Keep it production-oriented, not discriminatory.
- Camera plan is required: name shot size/angle such as wide, medium, close-up, extreme close-up, POV, over-shoulder, top-down, tracking, split-screen.
- Voice direction is required: voice follows the visible character. If one visible character speaks, use hook_character_speech with that character label and place the same exact spoken line inside the matching visual_scene_1 timing row, e.g. 0-2.5s: Position anchor... Contact anchor... Physical action anchor... và Nhân vật nói "Ignoring that morning neck tension? It could be a silent warning". Do not output Speaker 1/Speaker 2 unless two visible characters are actually described.
- Hook must be concrete, pain-led, and filmable in the first beat. Body must show the PSP/app action solving or organizing the same pain. CTA must be short.
- For health/wellness: never diagnose, cure, treat, detect disease, promise prevention, or replace doctor. Use track/check/monitor/reference/wellness.
- title, visual_scene_1/2/3, character_visual, country_visual_insight, hook_context_insight, camera_plan, voice_direction, visual_ref_notes, talent_profile, dont_do are Vietnamese.
- hook_vo, hook_character_speech, script_vo are in ${input.outputLanguage}. hook_voice_vi is Vietnamese translation with full diacritics.
- hook_text_overlay, text_overlays.text, cta_text are bilingual Vietnamese / ${input.outputLanguage} when ${input.outputLanguage} is not Vietnamese.
- visual_scene_1 must include timing rows and obey pacing: 5s max 2 camera rows; 8-10s max 3-4 rows; each row about 2.5s+. Spoken voice must be embedded in the exact row where the character speaks, not only listed below the scene.
- Every visual_scene_1/2/3 must literally include Position anchor, Contact anchor, and Physical action anchor clauses.

OUTPUT JSON ONLY. Return this current schema:
[
  {
    "pillar_index": 0,
    "pillar": "${primaryPillar.replace(/"/g, '\\"')}",
    "angles": [
      {
        "angle_index": 0,
        "angle_name": "short angle name",
        "angle_type": "Fear|Fact|Comparison|POV|Social|Curiosity|Relief|Tutorial|Demo|Challenge|Trend",
        "angle_desc": "one sentence",
        "ideas": [
          {
            "id": "P0-A0-I0",
            "creativeType": "${input.visualType}",
            "title": "ten kich ban tieng Viet ngan",
            "hook_text_overlay": "Vietnamese / ${input.outputLanguage}, max 8 words per language",
            "hook_vo": "max 12 words, different from overlay",
            "hook_character_speech": "same visible-character line that is embedded inside visual_scene_1, with time + speaker label; empty only if nobody visible speaks",
            "hook_voice_vi": "Vietnamese translation of hook voice/speech",
            "hook_archetype": "taxonomy label",
            "hook_alt_1_text": "short alt hook",
            "hook_alt_1_vo": "short alt VO",
            "hook_alt_1_archetype": "different taxonomy label",
            "hook_alt_2_text": "short alt hook",
            "hook_alt_2_vo": "short alt VO",
            "hook_alt_2_archetype": "different taxonomy label",
            "emotion_journey": "Hook -> Body -> CTA",
            "body_motivation_pattern": "Reveal|Demo-Story|Escalate|Compare|Transform",
            "scene_family": "assigned unique scene family label, not reused in the full request",
            "character_visual": "Vietnamese: age, skin tone/ethnicity/country cue, outfit, body language, prop",
            "country_visual_insight": "Vietnamese: why this visual fits ${market} and the selected core user",
            "hook_context_insight": "Vietnamese: country/core-user insight behind the hook context",
            "camera_plan": "Vietnamese: shot sizes and camera angles for hook/body/CTA",
            "voice_direction": "Vietnamese: who speaks, voice tone, and how voice follows the visible character/timing row",
            "visual_scene_1": "0-2.5s: Vietnamese hook visual. Include Position anchor, Contact anchor, Physical action anchor, and if the character speaks add: và [nhân vật] nói \"exact hook_character_speech line\". 2.5-5s: Vietnamese continuation if needed.",
            "visual_scene_2": "Vietnamese body paragraph showing app/PSP action. Include Position anchor, Contact anchor, Physical action anchor.",
            "visual_scene_3": "Vietnamese CTA/payoff visual. Include Position anchor, Contact anchor, Physical action anchor.",
            "text_overlays": [
              {"time":"0-2.5s","text":"hook text"},
              {"time":"6-9s","text":"body text"},
              {"time":"18-22s","text":"CTA text"}
            ],
            "script_vo": "full VO, max 60 words",
            "cta_text": "Vietnamese / ${input.outputLanguage}, max 6 words per language",
            "cta_friction_reducer": "Free|No signup|30 seconds|1 tap",
            "visual_ref_notes": "camera, lighting, talent direction, pacing",
            "talent_profile": "specific profile or No talent - screen recording only",
            "dont_do": "specific QC warning, at least 5 words",
            "track": "A|B|C",
            "track_reason": "one sentence",
            "priority": "A|B|C",
            "estimated_thumb_stop": "Low|Medium|High",
            "idea_reasoning": "one sentence"
          }
        ]
      }
    ]
  }
]`;
}

function buildLeanGeneratePrompt(input: {
  quantity: number;
  appName: string;
  appCategory: string;
  coreUserValues: string[];
  painPointValues: string[];
  emotionValues: string[];
  featureContext: string;
  visualType: string;
  targetMarketValues: string[];
  targetLang: string;
  outputLanguage: string;
  angleContext: string;
  ideaDescription?: string;
  generationMode?: string;
  rawBrief?: string;
  previousIdeas?: string;
  appKnowledge?: string;
  trendingTopics: string[];
  trendingStructures: string[];
  seasonalVisualBlock?: string;
  filterConsistencyBlock?: string;
}) {
  const primaryPillar = input.painPointValues[0] || 'General user friction';
  const coreUser = input.coreUserValues.join('; ') || 'General mobile app user';
  const emotionJourney = input.emotionValues.join(' -> ') || 'auto';
  const market = input.targetMarketValues.join(', ') || input.targetLang || 'Global';
  const marketVisualProfile = buildMarketVisualProfile([
    ...input.targetMarketValues,
    ...getCoreUserMarketValues(input.coreUserValues),
  ]);
  const trends = input.trendingTopics.length ? input.trendingTopics.join('; ') : 'None';
  const importedStructures = input.trendingStructures.length ? input.trendingStructures.slice(0, 4).join('\n') : 'None';
  const recentIdeas = clampPromptContext(input.previousIdeas, 1200) || 'None';
  const appKnowledge = clampPromptContext(input.appKnowledge, 4000) || 'None';
  const rawBrief = clampPromptContext(input.rawBrief, 1400) || '';
  const isQuickBriefMode = input.generationMode === 'quick';
  const hookDurationPlan = resolveHookDurationPlan({
    ideaDescription: input.ideaDescription,
    painPointValues: input.painPointValues,
    featureContext: input.featureContext,
    visualType: input.visualType,
    angleContext: input.angleContext,
    coreUserValues: input.coreUserValues,
    trendingStructures: input.trendingStructures,
    fallback: 5,
  });
  const hookTimeline = buildHookTimelineRows(hookDurationPlan.seconds);
  const hookTextWindow = hookTimeline.textWindow;
  const pacingSafeVisualScene1Example = hookTimeline.example;
  const timelineRule = buildHookTimingRule(hookDurationPlan, hookTimeline);
  const operatorIdeaBriefBlock = buildOperatorIdeaBriefBlock({
    ideaDescription: input.ideaDescription,
    hookPlan: hookDurationPlan,
    outputLanguage: input.outputLanguage,
  });
  const selectedStrategyLockBlock = buildSelectedStrategyLockBlock({
    visualType: input.visualType,
    coreUserValues: input.coreUserValues,
    emotionValues: input.emotionValues,
    marketValues: input.targetMarketValues,
    outputLanguage: input.outputLanguage,
  });
  const quickBriefModeBlock = isQuickBriefMode
    ? `## QUICK BRIEF MODE - SOURCE OF TRUTH
The operator is using a Gemini-style one-shot brief flow.
- rawBrief is the source of truth for this generation.
- Parsed chips below are helper metadata only. If parsed chips conflict with rawBrief, follow rawBrief.
- Do not ask for missing chips. Infer reasonable values from rawBrief and the saved rule/app brain.
- Quantity requested in rawBrief is the total number of ideas for this API call.

rawBrief:
${rawBrief || input.ideaDescription || 'N/A'}`
    : '';

  return `You already have the Creative Idea Engine rules. Use them as default; do not restate them.

Generate exactly ${input.quantity} production-ready Meta vertical video ad ideas.

The UI already imported the selected chips/config. Treat the BRIEF below as the source of truth.
If any chip is abstract (for example a disease, fear, trend, or broad concern), silently sharpen it into a specific filmable situation before writing the idea. Do not reject the brief for being short.
Do not replace selected product metric or PSP with a nearby feature. If the PSP says blood pressure, keep blood pressure; if it says heart rate, keep heart rate.
Core user is the target viewer/audience for the ad, not automatically the on-screen character's exact age or identity. Emotion trigger is the viewer emotion the hook must create, not just the mood of a character in the scene.
For health/wellness apps, avoid banned medical claims: diagnose, cure, treat, detect disease, replace doctor. Use safe words like track, check, monitor, reference, wellness.
For health/wellness apps, if the Operator note asks for before/after, adapt it as before checking/logging vs after seeing an app number, reference, chart, or trend screen. Never make before/after about body change, disease outcome, symptom improvement, recovery, or prevention.
If Angle to test starts with "AUTO ANGLE", choose a genuinely distinct strongest angle for that slot from the brief. Do not output a generic angle name.
Angle planning rule:
- Each angle must have exactly one angle_type.
- If Angle to test contains "REQUIRED angle_type: X" or "ANGLE TYPE X", output angle_type X and make the video visually match that type.
- Across AUTO ANGLE slots, angle_type must be different. Do not create three videos that only change wording.
- Health/wellness must include/prefer Fact. Utility must include/prefer Comparison or Demo. AI apps must include/prefer Trend.
- Test: if removing the angle name makes the videos look similar, rewrite the angle.
- Scene test: if the angle says TV/editor/news/fact, the setting must feel like studio/newsroom/desk/panel/lower-third/chart/infographic. Do not fall back to kitchen/living room/sofa unless the painpoint explicitly requires it.
${quickBriefModeBlock}
${operatorIdeaBriefBlock}
${selectedStrategyLockBlock}
Operator note priority:
- The Operator note is a high-priority creative direction, not optional context.
- If it requests a hook length, trend, reference format, structure, pacing, or "only hook ideas", obey it unless it conflicts with compliance.
- If it mentions a trend or pasted structure, adapt that trend/structure directly into the hook/body/CTA instead of generating a generic app demo.
Language matrix rule:
- title/script name, visual_scene_1/2/3, and production notes MUST be written in Vietnamese.
- hook_text_overlay, text_overlays.text, and cta_text are actual on-video text and MUST include both Vietnamese and ${input.outputLanguage} when ${input.outputLanguage} is not Vietnamese. Use format "Vietnamese / ${input.outputLanguage}" in the same string.
- hook_vo, hook_character_speech, and script_vo MUST be written in ${input.outputLanguage}; these are the only audience speech/voice fields that follow the selected market language.
- hook_vo and hook_character_speech must be direct, pain-led, and emotion-led. In the first hook beat they must name the visible blocker/consequence from the selected pain point and make the selected emotion (${emotionJourney}) obvious; do not use generic soft lines. If hook_character_speech is used, also embed the same line inside the matching visual_scene_1 timing row with the speaker action, e.g. "và Nhân vật nói \"...\"".
- hook_voice_vi MUST be Vietnamese with full diacritics only. It is the Vietnamese translation of hook_vo + hook_character_speech only; if both are empty, translate hook_text_overlay. Do not explain the pain point there, do not copy the original ${input.outputLanguage} line into hook_voice_vi, and do not output unaccented Vietnamese.
- The selected market/core user decides this voice/speech language. Example: US -> English, LATAM/Mexico/Spain -> Spanish, Brazil/Portugal -> Portuguese, Germany -> German.
- visual_scene_1, visual_scene_2, visual_scene_3, visual_ref_notes, talent_profile, dont_do, and production notes MUST be Vietnamese for the internal team.
- Inside visual_scene_1, keep the production prose Vietnamese. Quoted spoken lines embedded in the timing row use ${input.outputLanguage}; quoted Text hiện must be bilingual Vietnamese / ${input.outputLanguage} when ${input.outputLanguage} is not Vietnamese.
- Do NOT write the whole visual_scene in ${input.outputLanguage}. Only audience speech/voice snippets use ${input.outputLanguage}.
- visual_scene_1, visual_scene_2, and visual_scene_3 MUST each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- visual_scene_1 MUST obey Rule 4 pacing: 5s max 2 scenes/camera angles; 8-10s max 3-4 scenes/camera angles; fewer scenes are allowed.
- hook_text_overlay or hook_vo must name the selected concrete metric/feature in the first hook beat when one exists. Use "blood pressure" directly for blood pressure, "heart rate" directly for heart rate, etc.; do not rely on vague phrases like "this number" or "something changed" before the viewer knows the topic.

Timeline output rule:
${timelineRule}
- visual_scene_2 MUST be one concise Vietnamese body paragraph for "Diễn biến (Body)".
- script_vo MUST be the main voiceover only, in ${input.outputLanguage}, without production labels.
- cta_text MUST be the final CTA/slogan only, bilingual Vietnamese / ${input.outputLanguage} when ${input.outputLanguage} is not Vietnamese.

BRIEF
- App: ${input.appName}
- Category: ${input.appCategory}
- Core user: ${coreUser}
- Pain point pillar: ${primaryPillar}
- Emotion trigger: ${emotionJourney}
- PSP / feature benefit: ${input.featureContext}
- Visual/theme: ${input.visualType} (LOCKED creativeType for every idea)
- Angle to test: ${input.angleContext || 'choose the strongest angle inside the pain point'}
- Market: ${market}
- Market visual profile: ${marketVisualProfile}
- Voice/speech language: ${input.outputLanguage}
- Production notes language: Vietnamese
- Operator note: ${input.ideaDescription || 'N/A'}
- Trending hooks: ${trends}
- Imported trend/video structure: ${importedStructures}
- App brain: ${appKnowledge}
- Recent ideas to avoid repeating: ${recentIdeas}
${input.seasonalVisualBlock || ''}
${input.filterConsistencyBlock || ''}

Anchor requirement: every visual_scene_1/2/3 must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
Pacing requirement: apply Rule 4. 5s hooks/videos max 2 scenes/camera angles; 8-10s hooks/videos max 3-4 scenes/camera angles; one scene/camera angle must last at least 2.5s; fewer scenes are allowed.

OUTPUT JSON ONLY. No markdown.
Use this compact schema:
[
  {
    "pillar_index": 0,
    "pillar": "${primaryPillar.replace(/"/g, '\\"')}",
    "angles": [
      {
        "angle_index": 0,
        "angle_name": "short angle name",
        "angle_type": "Fear|Fact|Comparison|POV|Social|Curiosity|Relief|Tutorial|Demo|Challenge|Trend",
        "angle_desc": "one sentence",
        "ideas": [
          {
            "id": "P0-A0-I0",
            "creativeType": "${input.visualType}",
            "title": "tên kịch bản tiếng Việt ngắn, 3-7 từ",
            "hook_text_overlay": "Vietnamese / ${input.outputLanguage}, max 8 words per language",
            "hook_vo": "max 12 words, different from text",
            "hook_character_speech": "",
            "hook_voice_vi": "Vietnamese translation of hook voice/speech",
            "hook_archetype": "taxonomy label",
            "hook_alt_1_text": "short alt hook",
            "hook_alt_1_vo": "short alt VO",
            "hook_alt_1_archetype": "different taxonomy label",
            "hook_alt_2_text": "short alt hook",
            "hook_alt_2_vo": "short alt VO",
            "hook_alt_2_archetype": "different taxonomy label",
            "emotion_journey": "Hook -> Body -> CTA",
            "body_motivation_pattern": "Reveal|Demo-Story|Escalate|Compare|Transform",
            "visual_scene_1": "${pacingSafeVisualScene1Example} Include Position anchor, Contact anchor, and Physical action anchor clauses. Obey Rule 4 pacing.",
            "visual_scene_2": "Vietnamese body paragraph with narrative tension and app action. Include Position anchor, Contact anchor, and Physical action anchor clauses.",
            "visual_scene_3": "Vietnamese CTA/payoff visual with app store or download prompt. Include Position anchor, Contact anchor, and Physical action anchor clauses.",
            "text_overlays": [
              {"time":"${hookTextWindow}","text":"hook text"},
              {"time":"6-9s","text":"body text"},
              {"time":"12-15s","text":"proof text"},
              {"time":"18-22s","text":"CTA text"}
            ],
            "script_vo": "full VO, max 60 words",
            "cta_text": "Vietnamese / ${input.outputLanguage}, max 6 words per language",
            "cta_friction_reducer": "Free|No signup|30 seconds|1 tap",
            "visual_ref_notes": "camera, lighting, talent direction, pacing",
            "talent_profile": "specific profile or No talent - screen recording only",
            "dont_do": "specific QC warning",
            "track": "A|B|C",
            "track_reason": "one sentence",
            "priority": "A|B|C",
            "estimated_thumb_stop": "Low|Medium|High",
            "idea_reasoning": "one sentence"
          }
        ]
      }
    ]
  }
]

Important: make all ${input.quantity} ideas visually different. Every idea title must be Vietnamese and usable for the output line "Kịch bản X.Y: [title]", not a generic "Idea". Keep the hook short, concrete, and shootable.`;
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
        language: 'Bilingual Vietnamese / market-language hook text and CTA; Vietnamese visual notes; market language only for voice, character speech, and script_vo',
        priority: 'A',
        extraContext: [
          'Task type: refine an existing idea, do not rewrite unrelated parts.',
          'Preserve the current JSON field structure and keep meta coherent after edits.',
          'Hook must include or preserve meta.pspBridge: the short bridge from viewer emotion/angle to PSP before Body starts.',
        ],
      });
      const refineDirectiveBlock = buildRefineDirectiveBlock(instruction);
      const buildRefinePrompt = (failureNotes = '') => `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

${refineFramework}

## TASK
Refine one existing production brief using the user instruction below.
- The USER REFINE BRIEF is the highest-priority edit instruction for creative content.
- Apply only the requested changes, but apply them visibly and meaningfully. A one-idea refine must not come back unchanged.
- Preserve the same problem-solution chain unless the user explicitly changes it.
- Preserve all existing meta strategy fields exactly: strategyCode, strategyCodes, strategyCodeMap, favorite keys, and source IDs. Treat these strategy codes as tracking IDs, not as instructions that can override the USER REFINE BRIEF.
- If the user asks to change visual style or space (for example 3D to 2D, UGC to animation, animation to real footage), update creativeType plus every hook/body/CTA visual and script field to match the new style. Do not mention the old style anywhere in visible production copy.
- Keep or add meta.pspBridge so Hook connects the pain/emotion to the PSP before Body.
- Body is only the demo/proof continuation; do not make Body the first place where PSP becomes relevant.
- Keep visual, voice, and textOverlay separated for hook, body, and CTA.
- Translate or rewrite title, character speech, voice/video voiceover, text overlay, script_vo, and CTA into natural English where the original output uses English, while keeping Vietnamese production notes natural where present.
- Return exactly 1 JSON object, not an array.

## USER EDIT INTENT - MUST BE REFLECTED IN OUTPUT
${refineDirectiveBlock}
Concrete user request: "${instruction}"
Before returning, internally check: "Can the user visibly see this requested edit in title, creativeType, hook, body, and CTA?" If no, rewrite again before output.
${failureNotes ? `\n## PREVIOUS OUTPUT FAILED QA\n${failureNotes}\nRegenerate the single refined idea using the same full rules and fix every QA failure.` : ''}

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
      const refinePrompt = buildRefinePrompt();

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
          data: applyExplicitRefineDirectives(buildRefineEmergencyFallback(body), instruction),
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
          data: applyExplicitRefineDirectives(buildRefineEmergencyFallback(body), instruction),
          meta: {
            warnings: ['Refine AI returned non-JSON output; backend returned a schema-safe fallback using the current idea.'],
            fallbackCount: 1,
          },
        });
      }
      let refinedIdea = mergeRefinedIdeaWithOriginal(parsed, originalIdea, {
        duration: originalDuration,
        appName,
        pillar: asText(originalFramework.painpoint),
      });
      const qaIssues = getRefineInstructionViolations(refinedIdea, instruction);
      if (isRefineMeaningfullyUnchanged(originalIdea, refinedIdea)) {
        qaIssues.push('The refined idea is effectively unchanged from the existing idea.');
      }

      if (qaIssues.length > 0) {
        const retryText = await askAI(buildRefinePrompt(qaIssues.join('\n- ')), {
          model: resolveModel(selectedModel),
          temperature: 0.75,
          max_tokens: 8192,
          useCreativePersona: false,
          priority: 'high',
        });
        const retryParsed = retryText ? parseJson(retryText) : null;
        if (retryParsed) {
          const retryIdea = mergeRefinedIdeaWithOriginal(retryParsed, originalIdea, {
            duration: originalDuration,
            appName,
            pillar: asText(originalFramework.painpoint),
          });
          const retryIssues = getRefineInstructionViolations(retryIdea, instruction);
          if (!isRefineMeaningfullyUnchanged(originalIdea, retryIdea) || retryIssues.length <= qaIssues.length) {
            refinedIdea = retryIdea;
          }
        }
      }

      return NextResponse.json({
        success: true,
        data: applyExplicitRefineDirectives(refinedIdea, instruction),
      });
    }

    // === MODE: GENERATE ANGLES (tạo angle từ painpoint) ===
    if (mode === 'generate-angles') {
      const appName = asText(body.appName) || 'App';
      const appCategory = asText(body.appCategory) || 'App';
      const painpoints = asStringList(body.painpoints);
      const coreUsers = asStringList(body.coreUsers);
      const emotions = asStringList(body.emotions);
      const targetMarkets = [
        ...asStringList(body.targetMarkets),
        ...asStringList(body.targetMarket),
      ];
      const outputLanguage = 'Vietnamese';
      const vietnamesePainpoints = (painpoints.length ? painpoints : ['nỗi đau đã chọn'])
        .map(vietnamesePainpointCue);
      const anglePrompt = `Bạn là nhân sự Idea người Việt. Hãy tạo các Angle quảng cáo bằng TIẾNG VIỆT cho app "${appName}" (${appCategory}).

Painpoint đã diễn đạt lại bằng tiếng Việt:
${vietnamesePainpoints.map((pp, index) => `${index + 1}. ${pp}`).join('\n')}

Core User: ${coreUsers.join('; ') || 'người dùng đã chọn'}
Emotion: ${emotions.join('; ') || 'cảm xúc đã chọn'}
Thị trường mục tiêu: ${targetMarkets.join('; ') || 'Global / không khóa thị trường'}
Ngôn ngữ output bắt buộc: ${outputLanguage}

Luật bắt buộc:
1. Chỉ trả về tiếng Việt tự nhiên, có dấu. Không viết tiếng Anh, không dịch ngược sang tiếng Anh.
2. Nếu painpoint gốc từng là tiếng Anh, chỉ dùng phần painpoint tiếng Việt ở trên để viết Angle.
3. Thị trường mục tiêu chỉ ảnh hưởng bối cảnh văn hóa, tuyệt đối không đổi ngôn ngữ Angle.
4. Mỗi Angle phải bám trực tiếp vào painpoint đã chọn, không trôi sang nỗi đau khác.
5. Không mở đầu bằng nhãn như "Fear:", "FOMO:", "Challenge:", "Social Proof:", "Aspirational:".
6. Viết như một tình huống UGC đời thường, ngắn, dễ quay, chưa pitch app sớm.
7. Mỗi Angle khoảng 8-16 từ và nên mở bằng một tình huống khác nhau.

Ví dụ style:
["Tôi tưởng đo sau khi đi bộ là đủ, nhưng máy cũ quá rườm rà", "Trong phòng chờ tôi mới nhận ra mình không còn muốn ghi tay nữa"]

Chỉ trả về JSON array string. Không markdown.`;

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
              const angleStrings = parsed.map(asText).filter(Boolean);
              const hasWrongLanguage = angleStrings.some(angle => hasGermanCopyCue(angle) || !hasVietnameseAngleCue(angle));
              if (angleStrings.length > 0 && !hasWrongLanguage) {
                return NextResponse.json({ success: true, angles: angleStrings });
              }
            }
          }
        }
      } catch (e) {
        console.error('[generate-angles] AI error:', e);
      }
      // Fallback: generate locally
      const fallback = buildLocalizedAngleFallback(painpoints, 'Vietnamese');
      return NextResponse.json({ success: true, angles: fallback });
    }

    if (mode !== 'refine' && mode !== 'generate-angles') {
      const appId = asText(body.appId);
      const appContext = appId ? await loadGenerationAppContext(appId) : {};
      const appName = appContext.appName || asText(body.appName) || 'App';
      const appCategory = appContext.appCategory || asText(body.appCategory) || 'General';
      const filters = asRecord(body.filters);
      const config = asRecord(body.config);
      const previousIdeas = asText(body.previousIdeas);
      const appKnowledge = appContext.appKnowledge || asText(body.appKnowledge);
      const savedSystemRule = appContext.systemRule || asText(body.systemRule);
      const useCreativeRulesV7 = false;
      const usePromptSystemBuilderHtml = false;
      const creativeRuleset: 'default' | 'v7' | 'builder' = 'default';
      const selectedModel = asText(body.selectedModel) || undefined;
      const trendingTopics = asStringList(body.trendingTopics);
      const trendingStructures = asStringList(body.trendingStructures);
      const solutionValues = asStringList(filters.solution);
      const coreUserValues = asStringList(filters.coreUser);
      const coreUserLanguageValues = getCoreUserLanguageValues(coreUserValues);
      const coreUserMarketValues = getCoreUserMarketValues(coreUserValues);
      const emotionValues = asStringList(filters.emotion);
      const targetMarketValues = asStringList(filters.targetMarket);
      const marketContextValues = Array.from(new Set([...targetMarketValues, ...coreUserMarketValues]));
      const angleValues = asStringList(filters.angle);
      const painPointValues = asStringList(filters.painPoint);
      const featureContext = solutionValues.length ? solutionValues.join(', ') : 'General App Features';
      const requestedQuantity = Math.min(toPositiveInt(config.quantity, 3), MAX_IDEAS_PER_REQUEST);
      const duration = asText(config.duration) || 'Short social-first runtime';
      const visualType = normalizeFrameworkVisualFormat(
        asText(config.visualType)
        || asStringList(filters.visualType)[0]
        || 'UGC'
      );
      const targetLang = detectMarketLang(marketContextValues, coreUserMarketValues);
      const generationMode = asText(config.generationMode) || 'builder';
      const isQuickGenerationMode = generationMode === 'quick';
      const rawBrief = asText(config.rawBrief);
      const ideaDescription = rawBrief || asText(config.ideaDescription) || undefined;
      const hookDurationPlan = resolveHookDurationPlan({
        ideaDescription,
        painPointValues,
        featureContext,
        visualType,
        angleContext: angleValues.join(', '),
        coreUserValues,
        trendingStructures,
        fallback: 5,
      });
      const requestedHookDuration = hookDurationPlan.seconds;
      const outputLanguage = inferGenerationCopyLanguage({
        coreUserValues,
        explicitLanguageValues: coreUserLanguageValues,
        painPointValues,
        emotionValues,
        angleValues,
        ideaDescription,
        targetLang,
      });
      const angleContext = angleValues.length ? angleValues.join(', ') : '';
      const primaryPillar = painPointValues[0] || 'General user friction';
      const angleIndex = Number(config.angleIndex || 1);
      const requestStartIndex = Math.max(0, Number(config.startIndex || 0) || 0);
      const totalVariations = Math.max(requestedQuantity, Number(config.totalVariations || requestedQuantity) || requestedQuantity);
      const effectiveSelectedModel = isQuickGenerationMode ? 'gemini-3-pro' : selectedModel;
      const modelCandidates = resolveIdeaModels(effectiveSelectedModel).slice(0, isQuickGenerationMode ? 1 : MAX_IDEA_MODEL_CANDIDATES);
      const primaryModel = modelCandidates[0] || resolveModel(selectedModel);
      const isGemini3Ideas = primaryModel.includes('gemini-3-pro');
      const batchPlans = buildIdeaBatchPlans(
        requestedQuantity,
        isQuickGenerationMode ? QUICK_IDEA_MAX_BATCH_SIZE : isGemini3Ideas ? GEMINI3_IDEA_MAX_BATCH_SIZE : MAX_IDEAS_PER_AI_BATCH
      );
      const aiBudgetStartedAt = Date.now();
      const requestAiBudgetMs = isQuickGenerationMode
        ? QUICK_IDEA_REQUEST_BUDGET_MS
        : isGemini3Ideas
          ? Math.max(GENERATE_IDEAS_REQUEST_AI_BUDGET_MS, GEMINI3_IDEA_REQUEST_BUDGET_MS)
          : GENERATE_IDEAS_REQUEST_AI_BUDGET_MS;
      const getRemainingAiBudgetMs = () => requestAiBudgetMs - (Date.now() - aiBudgetStartedAt);
      const hasAiBudget = () => getRemainingAiBudgetMs() >= GENERATE_IDEAS_MIN_CALL_TIMEOUT_MS;
      const getBudgetedTimeoutMs = (timeoutMs: number) => Math.max(
        GENERATE_IDEAS_MIN_CALL_TIMEOUT_MS,
        Math.min(timeoutMs, getRemainingAiBudgetMs())
      );
      const metricLock = getPrimarySolutionMetric(
        solutionValues.length ? solutionValues : [...painPointValues, ...angleValues]
      );
      const filterConsistencyBlock = buildFilterConsistencyPromptBlock({
        solutionValues,
        angleValues,
        painPointValues,
      });

      const activeSystemRule = compactSystemRule(savedSystemRule, isQuickGenerationMode ? 2200 : 3200);
      const truncatedKnowledge = isQuickGenerationMode
        ? ''
        : clampPromptContext(appKnowledge, GENERATE_IDEAS_CONTEXT_CHAR_LIMIT);
      const truncatedPreviousIdeas = clampPromptContext(previousIdeas, GENERATE_IDEAS_HISTORY_CHAR_LIMIT);
      const structuredTrendNotes = trendingStructures.slice(0, 4);
      const seasonalVisualBlock = buildSeasonalVisualBlock(config.seasonalVisualContext);

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
        const painpointPrecisionBlock = useCreativeRulesV7
          ? buildV7ExecutionContract({
              appName,
              coreUserValues,
              primaryPillar,
              angleContext,
              featureContext,
              targetMarketValues: marketContextValues,
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
- Core user is the target viewer/audience, not a required literal on-screen character profile. Emotion trigger is the feeling to create in the viewer, not only the character's emotion.
- Do not reduce the pain point to a broad symptom. The hook and visual_scene_1 must include at least 2 concrete anchors from the selected pain point/angle, such as trigger moment, body signal, suspected cause, location, object, or user fear.
- The first 3 seconds must show WHY this user cares now, not just that the symptom exists.
- The first 3 seconds must name the selected concrete metric/feature as early as possible. If the selected PSP is blood pressure, say blood pressure directly in hook_text_overlay or hook_vo; do not use vague substitutes like "this number" without naming it.
- visual_scene_2 must show the selected PSP/app action solving or organizing the same problem. Do not jump to a generic app demo.
- visual_scene_1/2/3 must each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- visual_scene_1 must obey Rule 4 pacing: 5s max 2 scenes/camera angles; 8-10s max 3-4 scenes/camera angles; each scene/camera angle >=2.5s.
- If this is a health/wellness app, position the app as tracking/logging/understanding trends only. Never diagnose, treat, detect disease, promise prevention, or imply before/after health improvement.
- If the PSP is a health tracker, hook_primary may be human/emotional, but visual_scene_1 or hook_alt must name the actual tracked concern/metric from the selected PSP/pain point. Do not stop at a generic symptom like "dizzy", "tired", or "worried".
- Avoid search-query hooks like "Huyết áp thấp có làm tôi choáng khi đứng dậy không?" Make hook_primary feel like a lived moment, confession, or tension line.
- Better lived-moment health hook style examples in ${outputLanguage}: "I thought it was just my age." / "The dizzy moment was not the scariest part." / "My morning started with a sudden pause."
- Hook execution must not be a copy-paste stack: hook_primary is the headline, hook_text_overlay is the readable screen text, and hook_voiceover or hook_character_speech must add a different lived detail. If nobody visibly speaks, hook_character_speech must be an empty string.
- Hook must sell through to PSP: include psp_bridge so the viewer understands why the app/action is the next natural step before the Body section starts.
- Body is only a suggested demo/proof continuation. Do not rely on Body alone to explain why the PSP matters.
- For multiple ideas, every hook_primary must be meaningfully different. Do not reuse "Why do I..." or the same sentence frame across the batch.`;

        const v21ExecutionOverrideBlock = `
## CREATIVE IDEA ENGINE V2.1 OVERRIDE - APPLIES TO ALL APPS
- Use the V2.1 output fields, not legacy hook_primary-first fields.
- Core User must be interpreted as TARGET VIEWER: Who + what they think + what they do + why unsolved + what makes them act. It is not automatically the age/emotion of the on-screen character.
- Emotion Trigger must be interpreted as VIEWER EMOTION to provoke through the hook, not merely the character's mood.
- Pain Point must be a SITUATION: Who + Where + Doing What + What Goes Wrong.
- Pain Point must be derived from Core User + PSP, app-relevant, and filmable in 3 seconds.
- Angle must be one angle_type + one market/framework approach + one visually different execution.
- If this app is Health, include/prefer Fact angle. If Utility, include/prefer Comparison or Demo. If AI, include/prefer Trend.
- visual_scene_1 must follow the Hook Timing Rule below, not a fixed 5s template.
- Scene 1 must depict the selected pain point situation before any app UI unless the category is AI and the hook archetype is Result First.
- Scene 1 must not default to kitchen/living room/sofa/apartment. Choose the setting from the selected angle/visual/painpoint; TV/editor/fact angles should look like studio/newsroom/desk/panel/chart/infographic execution.
- visual_scene_2 must be Sec 5-18 with narrative tension and a real app action.
- visual_scene_3 must be Sec 18-25 with CTA plus cta_friction_reducer.
- hook_text_overlay is bilingual Vietnamese / ${outputLanguage}, max 8 words per language. hook_vo is max 12 words. They must not duplicate.
- If visible talent speaks, fill hook_character_speech with the exact on-camera line.
- visual_scene_1, visual_scene_2, visual_scene_3, visual_ref_notes, talent_profile, dont_do, and all production notes MUST be Vietnamese.
- visual_scene_1, visual_scene_2, and visual_scene_3 MUST each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- visual_scene_1 MUST obey Rule 4 pacing: 5s max 2 scenes/camera angles; 8-10s max 3-4 scenes/camera angles; fewer scenes are allowed.
- title/script name, visual_scene prose, and production notes MUST be Vietnamese. hook_text_overlay, text_overlays.text, and cta_text MUST be bilingual Vietnamese / ${outputLanguage} when ${outputLanguage} is not Vietnamese. hook_vo, hook_character_speech, and script_vo MUST be ${outputLanguage}. hook_voice_vi MUST be Vietnamese with full diacritics. Only quoted Voiceover / CHARACTER SPEECH inside visual_scene uses ${outputLanguage}; quoted Text hiện is bilingual.
- visual_ref_notes must include camera style, lighting, talent direction, and pacing.`;

        const frameworkInjection = buildFrameworkInjection({
          appName,
          category: appCategory,
          coreUsers: coreUserValues,
          primaryEmotion: emotionValues[0] || 'Curiosity',
          visualTheme: `${visualType}. Keep the scenes native to ${marketContextValues.join(', ') || 'the selected market'}.`,
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
            'Stay social-first, market-native, and native to the selected Visual/Theme format',
            'Differentiate opening action, blocker, reveal, and voice opening across ideas',
            'Use a mixed hook/story pattern spread without changing the selected Visual/Theme creativeType',
          ],
          dontList: [
            'Do not drift away from the selected pain point',
            'Do not output cinematic brand-film copy',
            'Do not repeat the same scene family with new wording',
            'Do not label several ideas as POV just because they are shot handheld',
          ],
          anglesPerPillar: 1,
          ideasPerAngle: plan.batchQuantity,
          trackRule: `Track is internal difficulty only. All ideas must keep creativeType = ${visualType}.`,
          language: useCreativeRulesV7
            ? `Bilingual Vietnamese / ${outputLanguage} hook text and CTA; Vietnamese visual notes. Only voice, character speech, and script_vo in ${outputLanguage}.`
            : usePromptSystemBuilderHtml
              ? `Prompt System Builder HTML V1. Bilingual Vietnamese / ${outputLanguage} hook text and CTA; Vietnamese visual notes; only voice, character speech, and script_vo in ${outputLanguage}.`
              : `Bilingual Vietnamese / ${outputLanguage} hook text and CTA; Vietnamese visual notes; only voice, character speech, and script_vo in ${outputLanguage}.`,
          priority: 'A',
          extraContext: [
            `Selected angle: ${angleContext || 'Creative freedom'}`,
            `Idea description: ${ideaDescription || 'Creative freedom'}`,
            `Target market: ${marketContextValues.join(', ') || 'Default market'}`,
            `Batch window: ${requestStartIndex + plan.batchStartIndex + 1}-${requestStartIndex + plan.batchStartIndex + plan.batchQuantity}/${totalVariations}`,
          ],
        });

        const outputSpec = buildCreativeBriefOutputSpec({
          quantity: plan.batchQuantity,
          duration,
          appName,
          language: outputLanguage,
          visualType,
          ruleset: creativeRuleset,
        });
        const rulesBlock = useCreativeRulesV7
          ? `${CREATIVE_ADS_GENERATION_RULES_V7}

${BULLETPROOF_VISUAL_ANCHOR_RULES}
${PACING_LIMIT_RULES}

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
- Every idea must include visual_scene_1, visual_scene_2, visual_scene_3, hook_voice_vi, script_vo, cta_text, visual_ref_notes, talent_profile, dont_do, track, track_reason, priority.
- title/script name, visual scenes, and production notes must be Vietnamese. hook_text_overlay, text_overlays.text, and cta_text must be bilingual Vietnamese / ${outputLanguage} when ${outputLanguage} is not Vietnamese. Only hook_vo, hook_character_speech, and script_vo use ${outputLanguage}. In visual_scene rows, embed quoted spoken lines in the exact timing row where the character speaks; quoted Text hien is bilingual. Target market affects local setting, vibe, speech language, and second overlay language.
- hook_voice_vi must be Vietnamese with full diacritics; it translates hook_vo + hook_character_speech, and only if both are empty translates the ${outputLanguage} side of hook_text_overlay.
- Every visual_scene_1/2/3 must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- Each idea must stay inside the selected pain point, selected PSP, selected angle, and selected visual type.`
          : `Generate ${plan.batchQuantity} production-ready full ideas for the selected filter combination.
- Use Creative Idea Engine V2.1 schema and timeline.
- Return hook_text_overlay, hook_vo, hook_character_speech, hook_voice_vi, hook_archetype, hook_alt_1_text/vo/archetype, hook_alt_2_text/vo/archetype, emotion_journey, body_motivation_pattern, text_overlays, cta_friction_reducer, estimated_thumb_stop, and idea_reasoning.
- visual_scene_1 must follow the Hook Timing Rule below. Include bilingual Text hien and Voiceover in the selected voice language inside an existing timing row when needed.
- Every visual_scene_1/2/3 must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- Duration: ${duration}
- The final target for this selected angle is ${totalVariations} ideas. This API call only covers items ${requestStartIndex + plan.batchStartIndex + 1}-${requestStartIndex + plan.batchStartIndex + plan.batchQuantity}.
- Each idea must stay inside the selected pillar and selected angle focus.
- Treat the selected angle as one narrow manifestation of the selected pain point, not a replacement for it.
- If an angle is selected, the hook must make that angle visible immediately through the first action, first spoken line, or first contrast.
- Hook must include psp_bridge so the pain/emotion connects to the PSP before the Body section.
- Hook, body, and CTA must follow one continuous problem-solution chain.
- Body is a suggested demo/proof continuation; do not rely on Body alone to explain why the PSP matters.
- If multiple ideas are requested, diversify them aggressively while keeping the same strategic inputs.
- Visual / Theme format must be exactly one of the framework formats: 2D Animation, 3D Animation, UGC, POV, or Motion Graphic. Motion Graphic means 2D motion graphics: typography, flat shapes/icons/charts/UI panels/data callouts moving on screen; it is not live-action, 3D render, or full 2D character/cartoon animation. Do not use Reaction, Split Screen, Challenge, Social Proof, ASMR, Interview, or Trend Format as visual formats; put those only in reference_pattern or interrupt_mechanism when useful.
- Production blueprint: each idea must include reference_pattern, interrupt_mechanism, first_frame_asset, psp_bridge, proof_object, app_demo_action, overlay_sequence, and edit_notes. reference_pattern can be custom/hybrid. psp_bridge belongs to Hook and must connect the emotion/angle to the PSP. The remaining fields must be concrete enough for a creator to edit the video without asking follow-up questions.`;

        void painpointPrecisionBlock;
        void v21ExecutionOverrideBlock;
        void frameworkInjection;
        void outputSpec;
        void rulesBlock;
        void taskDirectives;

        const prompt = isQuickGenerationMode
            ? buildFastQuickGeneratePrompt({
                appId,
                quantity: plan.batchQuantity,
                batchStartIndex: plan.batchStartIndex,
                totalQuantity: requestedQuantity,
                appName,
                appCategory,
              coreUserValues,
              painPointValues: painPointValues.length ? painPointValues : [primaryPillar],
              emotionValues,
              featureContext,
              visualType,
              targetMarketValues: marketContextValues,
              outputLanguage,
                angleContext,
                rawBrief,
                systemRule: activeSystemRule,
                previousIdeas: [truncatedPreviousIdeas, inRequestHistory].filter(Boolean).join('\n\n'),
                trendingTopics,
              trendingStructures: structuredTrendNotes,
              seasonalVisualBlock,
              filterConsistencyBlock,
            })
          : buildLeanGeneratePrompt({
              quantity: plan.batchQuantity,
              appName,
              appCategory,
              coreUserValues,
              painPointValues: painPointValues.length ? painPointValues : [primaryPillar],
              emotionValues,
              featureContext,
              visualType,
              targetMarketValues: marketContextValues,
              targetLang,
              outputLanguage,
              angleContext,
              ideaDescription,
              generationMode,
              rawBrief,
              previousIdeas: [truncatedPreviousIdeas, inRequestHistory].filter(Boolean).join('\n\n'),
              appKnowledge: truncatedKnowledge,
              trendingTopics,
              trendingStructures: structuredTrendNotes,
              seasonalVisualBlock,
              filterConsistencyBlock,
            });

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
        const systemPrompt = isQuickGenerationMode ? FAST_CREATIVE_IDEA_SYSTEM_PROMPT : CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT;

        for (const [candidateIndex, model] of modelCandidates.entries()) {
          if (!hasAiBudget()) break;
          const candidateTimeoutMs = candidateIndex === 0
            ? getIdeaBatchTimeoutMs(model, plan.batchQuantity)
            : GENERATE_IDEAS_RETRY_TIMEOUT_MS;
          const generationTemperature = plan.batchQuantity > 1 ? 0.82 : 0.75;
          const budgetedTimeoutMs = getBudgetedTimeoutMs(isQuickGenerationMode ? QUICK_IDEA_BATCH_TIMEOUT_MS : candidateTimeoutMs);
          const directGeminiAvailable = Boolean(DIRECT_GEMINI_API_KEY) && model.startsWith('gemini/');
          let candidateText = directGeminiAvailable
            ? await callDirectGemini(model, prompt, {
                systemInstruction: systemPrompt,
                temperature: generationTemperature,
                maxOutputTokens: responseTokenBudget,
                timeoutMs: budgetedTimeoutMs,
              })
            : null;

          if (!candidateText) {
            candidateText = await callAI([
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt },
            ], {
              model,
              temperature: generationTemperature,
              max_tokens: responseTokenBudget,
              useCreativePersona: false,
              priority: 'high',
              timeoutMs: budgetedTimeoutMs,
              queueTimeoutMs: model.includes('gemini-3-pro') ? 60000 : undefined,
            });
          }

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
          category: appCategory,
          pillar: primaryPillar,
          coreUser: coreUserValues.join('; ') || 'General viewer',
          emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
          psp: featureContext,
          angle: angleContext,
          ideaDescription,
          language: outputLanguage,
          visualType,
          ruleset: creativeRuleset,
        });
        let validation = normalizeAndValidateIdeas(briefOutput.items, {
          duration,
          appName,
          category: appCategory,
          psp: featureContext,
          coreUser: coreUserValues.join('; ') || 'General viewer',
          emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
          angle: angleContext,
          pillar: primaryPillar,
          angleIndex: Math.max(angleIndex - 1, 0),
          ideaStartIndex: requestStartIndex + plan.batchStartIndex,
          hookDurationSeconds: requestedHookDuration,
          metricLock,
          visualType,
        });
        validation.invalidReasons.unshift(...briefOutput.invalidReasons);
        let valid = dedupeIdeas(validation.valid, priorGeneratedIdeas).slice(0, plan.batchQuantity);
        if (valid.length < plan.batchQuantity) {
          const lenientRejectedReasons: string[] = [];
          const lenientCandidates = normalizeLeanCreativeOutput(parsed, {
            duration,
            appName,
            category: appCategory,
            pillar: primaryPillar,
            coreUser: coreUserValues.join('; ') || 'General viewer',
            emotion: emotionValues.join(' -> ') || 'Curiosity -> Amazement -> Excitement',
            psp: featureContext,
            angle: angleContext,
            angleIndex: Math.max(angleIndex - 1, 0),
            startIndex: requestStartIndex + plan.batchStartIndex,
            hookDurationSeconds: requestedHookDuration,
            visualType,
            outputLanguage,
          }).map(item => repairGeneratedIdeaForValidation(sanitizeMedicalClaimsInIdea(item), metricLock)).filter((item, lenientIndex) => {
            const metricErrors = [
              ...validateHealthMetricLockOutput(item, metricLock, appName),
              ...validateHealthMetricDirectHookOutput(item, metricLock),
            ];
            if (metricErrors.length > 0) {
              validation.invalidReasons.push(`Soft metric warning P0-A${Math.max(angleIndex - 1, 0)}-I${requestStartIndex + plan.batchStartIndex + lenientIndex}: ${metricErrors.join('; ')}`);
            }
            const errors = validateIdeaOutput(item);
            if (errors.length > 0) {
              lenientRejectedReasons.push(`Lenient P0-A${Math.max(angleIndex - 1, 0)}-I${requestStartIndex + plan.batchStartIndex + lenientIndex}: ${errors.join('; ')}`);
            }
            return errors.length === 0;
          });
          validation.invalidReasons.push(...lenientRejectedReasons);

          const merged: Record<string, unknown>[] = [];
          for (const candidate of [...valid, ...lenientCandidates]) {
            const signature = ideaSignature(candidate);
            const isUnique = [...priorGeneratedIdeas, ...merged].every(item => (
              jaccardSimilarity(signature, ideaSignature(item)) < 0.76
            )) && ![...priorGeneratedIdeas, ...merged].some(item => hasSameHookFrame(candidate, item));
            if (isUnique) merged.push(candidate);
            if (merged.length >= plan.batchQuantity) break;
          }
          valid = merged;
        }
        const duplicateDetected = !isQuickGenerationMode && plan.batchQuantity > 1 && valid.length > 1 && hasNearDuplicateIdeas(valid);
        const needsValidationRetry = false;

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
              category: appCategory,
              pillar: primaryPillar,
              coreUser: coreUserValues.join('; ') || 'General viewer',
              emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
              psp: featureContext,
              angle: angleContext,
              ideaDescription,
              language: outputLanguage,
              visualType,
              ruleset: creativeRuleset,
            });
            const retryValidation = normalizeAndValidateIdeas(retryBriefOutput.items, {
              duration,
              appName,
              category: appCategory,
              psp: featureContext,
              coreUser: coreUserValues.join('; ') || 'General viewer',
              emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
              angle: angleContext,
              pillar: primaryPillar,
              angleIndex: Math.max(angleIndex - 1, 0),
              ideaStartIndex: requestStartIndex + plan.batchStartIndex,
              hookDurationSeconds: requestedHookDuration,
              metricLock,
              visualType,
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
              category: appCategory,
              pillar: primaryPillar,
              coreUser: coreUserValues.join('; ') || 'General viewer',
              emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
              psp: featureContext,
              angle: angleContext,
              ideaDescription,
              language: outputLanguage,
              visualType,
              ruleset: creativeRuleset,
            });
            const fallbackValidation = normalizeAndValidateIdeas(fallbackBriefOutput.items, {
              duration,
              appName,
              category: appCategory,
              psp: featureContext,
              coreUser: coreUserValues.join('; ') || 'General viewer',
              emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
              angle: angleContext,
              pillar: primaryPillar,
              angleIndex: Math.max(angleIndex - 1, 0),
              ideaStartIndex: requestStartIndex + plan.batchStartIndex,
              hookDurationSeconds: requestedHookDuration,
              metricLock,
              visualType,
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
          const reasonDetail = validation.invalidReasons.slice(0, 3).join(' | ');
          if (reasonDetail) throw new Error(`AI trả về format sai: ${reasonDetail}`);
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
      const shouldUseAiRefill = isQuickGenerationMode || (ENABLE_AI_RECOVERY_REFILL && false);
      const shouldUseLocalFallback = ENABLE_LOCAL_FALLBACK_TOPUP && !isGemini3Ideas;

      const runBatchPlanWithRecovery = async (
        plan: IdeaBatchPlan,
        priorGeneratedIdeas: Record<string, unknown>[]
      ) => {
        try {
          if (!hasAiBudget()) {
            throw new Error('AI request time budget was exhausted before this batch.');
          }
          const batchIdeas = await runGenerationBatch(plan, priorGeneratedIdeas);
          if (batchIdeas.length < plan.batchQuantity) {
            const missingCount = plan.batchQuantity - batchIdeas.length;
            const shouldRecoverShortBatch = shouldUseAiRefill && !batchErrors.some(isNonRecoverableAIGenerationError);
            const recoveredIdeas = shouldRecoverShortBatch
              ? await refillIdeasOneByOne(
                  missingCount,
                  plan.batchStartIndex + batchIdeas.length,
                  [...priorGeneratedIdeas, ...batchIdeas],
                  `batch ${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity} returned too few ideas`
                )
              : [];
            batchIdeas.push(...recoveredIdeas);

            const stillMissing = plan.batchQuantity - batchIdeas.length;
            let fallbackAdded = 0;
            const canUseLocalFallback = shouldUseLocalFallback
              && !batchErrors.some(isNonRecoverableAIGenerationError);
            if (canUseLocalFallback && stillMissing > 0) {
              const fallbackIdeas = buildFallbackIdeasForFilters({
                appName,
                filters,
                quantity: stillMissing,
                duration,
                startIndex: requestStartIndex + plan.batchStartIndex + batchIdeas.length,
                angleIndex,
                ideaDescription,
              hookDurationSeconds: requestedHookDuration,
            });
              batchIdeas.push(...fallbackIdeas);
              fallbackAdded = fallbackIdeas.length;
              fallbackCount += fallbackIdeas.length;
            }

            batchErrors.push(
              `Batch ${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity} was short; AI refill added ${recoveredIdeas.length}, fallback added ${fallbackAdded}.`
            );
          }
          return batchIdeas.slice(0, plan.batchQuantity);
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
                priorGeneratedIdeas,
                rangeLabel
              )
            : [];

          const stillMissing = plan.batchQuantity - recoveredIdeas.length;
          let fallbackAdded = 0;
          const canUseLocalFallback = shouldUseLocalFallback
            && !isNonRecoverableAIGenerationError(batchErrorMessage);
          if (canUseLocalFallback && stillMissing > 0) {
            const fallbackIdeas = buildFallbackIdeasForFilters({
              appName,
              filters,
              quantity: stillMissing,
              duration,
              startIndex: requestStartIndex + plan.batchStartIndex + recoveredIdeas.length,
              angleIndex,
              ideaDescription,
                hookDurationSeconds: requestedHookDuration,
              });
            recoveredIdeas.push(...fallbackIdeas);
            fallbackAdded = fallbackIdeas.length;
            fallbackCount += fallbackIdeas.length;
          }

          batchErrors.push(
            `${rangeLabel}: ${batchErrorMessage}. AI refill added ${recoveredIdeas.length}, fallback added ${fallbackAdded}.`
          );
          return recoveredIdeas.slice(0, plan.batchQuantity);
        }
      };

      const batchConcurrency = isGemini3Ideas
        ? Math.max(1, Math.min(isQuickGenerationMode ? QUICK_IDEA_BATCH_CONCURRENCY : GEMINI3_IDEA_BATCH_CONCURRENCY, 3, batchPlans.length))
        : 1;
      if (batchConcurrency > 1) {
        console.log('[generate-ideas] Gemini batch concurrency:', batchConcurrency, 'plans:', batchPlans.length);
      }

      for (let planIndex = 0; planIndex < batchPlans.length; planIndex += batchConcurrency) {
        const plansInFlight = batchPlans.slice(planIndex, planIndex + batchConcurrency);
        if (plansInFlight.length === 1) {
          const batchIdeas = await runBatchPlanWithRecovery(plansInFlight[0], aggregatedIdeas);
          aggregatedIdeas.push(...batchIdeas);
          continue;
        }

        const priorIdeasForChunk = [...aggregatedIdeas];
        const settledPlans = await Promise.allSettled(
          plansInFlight.map(plan => runBatchPlanWithRecovery(plan, priorIdeasForChunk))
        );
        const chunkIdeas: Record<string, unknown>[] = [];
        for (const [chunkIndex, settledPlan] of settledPlans.entries()) {
          const plan = plansInFlight[chunkIndex];
          if (settledPlan.status === 'fulfilled') {
            const uniquePlanIdeas = dedupeIdeas(
              settledPlan.value,
              [...aggregatedIdeas, ...chunkIdeas]
            ).slice(0, plan.batchQuantity);
            if (uniquePlanIdeas.length < Math.min(settledPlan.value.length, plan.batchQuantity)) {
              batchErrors.push(
                `Batch ${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity} had duplicate ideas after parallel merge.`
              );
            }
            chunkIdeas.push(...uniquePlanIdeas);
          } else {
            const message = settledPlan.reason instanceof Error
              ? settledPlan.reason.message
              : 'Unknown batch error';
            batchErrors.push(
              `${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity}/${requestedQuantity}: ${message}`
            );
          }
        }
        aggregatedIdeas.push(...chunkIdeas);
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
        const canUseLocalFallback = shouldUseLocalFallback
          && !batchErrors.some(isNonRecoverableAIGenerationError);
        if (canUseLocalFallback && stillMissing > 0) {
          const finalTopUp = buildFallbackIdeasForFilters({
            appName,
            filters,
            quantity: stillMissing,
            duration,
            startIndex: requestStartIndex + aggregatedIdeas.length,
            angleIndex,
            ideaDescription,
            hookDurationSeconds: requestedHookDuration,
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

      const finalIdeas = aggregatedIdeas.slice(0, requestedQuantity).map((idea, index) => repairGeneratedIdeaForValidation(syncHookDurationFromTimeline(repairIdeaTrackingFields(
        idea,
        {
          angleIndex: Math.max(angleIndex - 1, 0),
          ideaIndex: requestStartIndex + index,
          pillar: primaryPillar,
        }
      ), requestedHookDuration), metricLock));
      const generationMs = Date.now() - aiBudgetStartedAt;
      console.log(
        '[generate-ideas] Completed',
        `${finalIdeas.length}/${requestedQuantity}`,
        'ideas in',
        `${generationMs}ms`,
        'model:',
        primaryModel,
        'batches:',
        batchPlans.length
      );
      return NextResponse.json({
        success: true,
        data: finalIdeas,
        meta: {
          requestedQuantity,
          generatedQuantity: finalIdeas.length,
          generationMs,
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
    const useCreativeRulesV7 = false;
    const usePromptSystemBuilderHtml = false;
    const creativeRuleset: 'default' | 'v7' | 'builder' = 'default';
    const selectedModel = asText(body.selectedModel) || undefined;
    const trendingTopics = asStringList(body.trendingTopics);
    const trendingStructures = asStringList(body.trendingStructures);
    const solutionValues = asStringList(filters.solution);
    const coreUserValues = asStringList(filters.coreUser);
    const coreUserLanguageValues = getCoreUserLanguageValues(coreUserValues);
    const coreUserMarketValues = getCoreUserMarketValues(coreUserValues);
    const emotionValues = asStringList(filters.emotion);
    const targetMarketValues = asStringList(filters.targetMarket);
    const marketContextValues = Array.from(new Set([...targetMarketValues, ...coreUserMarketValues]));
    const angleValues = asStringList(filters.angle);
    const painPointValues = asStringList(filters.painPoint);
    const featureContext = solutionValues.length ? solutionValues.join(', ') : "General App Features";
    const quantity = Math.min(toPositiveInt(config.quantity, 3), 5); // Cap at 5 to avoid gateway timeout
    const duration = asText(config.duration) || 'Short social-first runtime';
    const visualType = normalizeFrameworkVisualFormat(
      asText(config.visualType)
      || asStringList(filters.visualType)[0]
      || 'UGC'
    );
    const targetLang = detectMarketLang(marketContextValues, coreUserMarketValues);
    const ideaDescription = asText(config.ideaDescription) || undefined;
    const outputLanguage = inferGenerationCopyLanguage({
      coreUserValues,
      explicitLanguageValues: coreUserLanguageValues,
      painPointValues,
      emotionValues,
      angleValues,
      ideaDescription,
      targetLang,
    });
    const marketContext = buildMarketContext(marketContextValues);
    const marketVisualProfile = buildMarketVisualProfile(marketContextValues);
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
    const hookDurationPlan = resolveHookDurationPlan({
      ideaDescription,
      painPointValues,
      featureContext,
      visualType,
      angleContext,
      coreUserValues,
      trendingStructures: structuredTrendNotes,
      fallback: 5,
    });
    const requestedHookDuration = hookDurationPlan.seconds;
    const hookTimeline = buildHookTimelineRows(requestedHookDuration);
    const hookTimingRule = buildHookTimingRule(hookDurationPlan, hookTimeline);
    const operatorIdeaBriefBlock = buildOperatorIdeaBriefBlock({
      ideaDescription,
      hookPlan: hookDurationPlan,
      outputLanguage,
    });
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
    const metricLock = getPrimarySolutionMetric(
      solutionValues.length ? solutionValues : [...painPointValues, ...angleValues]
    );
    const filterConsistencyBlock = buildFilterConsistencyPromptBlock({
      solutionValues,
      angleValues,
      painPointValues,
    });
    const variationBlock = variationIndex > 0
      ? `\n[VARIATION TRONG LẦN GEN HIỆN TẠI]\nĐây là idea ${variationIndex}/${totalVariations}. Phải khác các idea còn lại về tình huống mở đầu, hành động đầu tiên, creative type hoặc nhân vật phụ. Vẫn giữ ĐÚNG core user, painpoint, emotion, PSP, target market, month/season/event và output schema.\n`
      : '';
    const diversityBlock = buildBatchDiversityBlock(quantity, angleContext, angleIndex, totalAngles, visualType);

    const painpointPrecisionBlock = useCreativeRulesV7
      ? buildV7ExecutionContract({
          appName,
          coreUserValues,
          primaryPillar,
          angleContext,
          featureContext,
          targetMarketValues: marketContextValues,
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
- Core user is the target viewer/audience, not a required literal on-screen character profile. Emotion trigger is the feeling to create in the viewer, not only the character's emotion.
- Do not reduce the pain point to a broad symptom. The hook and visual_scene_1 must include at least 2 concrete anchors from the selected pain point/angle, such as trigger moment, body signal, suspected cause, location, object, or user fear.
- The first 3 seconds must show WHY this user cares now, not just that the symptom exists.
- The first 3 seconds must name the selected concrete metric/feature as early as possible. If the selected PSP is blood pressure, say blood pressure directly in hook_text_overlay or hook_vo; do not use vague substitutes like "this number" without naming it.
- visual_scene_2 must show the selected PSP/app action solving or organizing the same problem. Do not jump to a generic app demo.
- visual_scene_1/2/3 must each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- visual_scene_1 must obey Rule 4 pacing: 5s max 2 scenes/camera angles; 8-10s max 3-4 scenes/camera angles; each scene/camera angle >=2.5s.
- If this is a health/wellness app, position the app as tracking/logging/understanding trends only. Never diagnose, treat, detect disease, promise prevention, or imply before/after health improvement.
- If the PSP is a health tracker, hook_primary may be human/emotional, but visual_scene_1 or hook_alt must name the actual tracked concern/metric from the selected PSP/pain point. Do not stop at a generic symptom like "dizzy", "tired", or "worried".
- Avoid search-query hooks like "Huyết áp thấp có làm tôi choáng khi đứng dậy không?" Make hook_primary feel like a lived moment, confession, or tension line.
- Better lived-moment health hook style examples in ${outputLanguage}: "I thought it was just my age." / "The dizzy moment was not the scariest part." / "My morning started with a sudden pause."
- Hook execution must not be a copy-paste stack: hook_primary is the headline, hook_text_overlay is the readable screen text, and hook_voiceover or hook_character_speech must add a different lived detail. If nobody visibly speaks, hook_character_speech must be an empty string.
- Hook must sell through to PSP: include psp_bridge so the viewer understands why the app/action is the next natural step before the Body section starts.
- Body is only a suggested demo/proof continuation. Do not rely on Body alone to explain why the PSP matters.
- For multiple ideas, every hook_primary must be meaningfully different. Do not reuse "Why do I..." or the same sentence frame across the batch.`;

    const v21ExecutionOverrideBlock = `
## CREATIVE IDEA ENGINE V2.1 OVERRIDE - APPLIES TO ALL APPS
- Use the V2.1 output fields, not legacy hook_primary-first fields.
- Core User must be interpreted as TARGET VIEWER: Who + what they think + what they do + why unsolved + what makes them act. It is not automatically the age/emotion of the on-screen character.
- Emotion Trigger must be interpreted as VIEWER EMOTION to provoke through the hook, not merely the character's mood.
- Pain Point must be a SITUATION: Who + Where + Doing What + What Goes Wrong.
- Pain Point must be derived from Core User + PSP, app-relevant, and filmable in 3 seconds.
- Angle must be one angle_type + one market/framework approach + one visually different execution.
- If this app is Health, include/prefer Fact angle. If Utility, include/prefer Comparison or Demo. If AI, include/prefer Trend.
- visual_scene_1 must follow the Hook Timing Rule below, not a fixed 5s template.
- Scene 1 must depict the selected pain point situation before any app UI unless the category is AI and the hook archetype is Result First.
- Scene 1 must not default to kitchen/living room/sofa/apartment. Choose the setting from the selected angle/visual/painpoint; TV/editor/fact angles should look like studio/newsroom/desk/panel/chart/infographic execution.
- visual_scene_2 must be Sec 5-18 with narrative tension and a real app action.
- visual_scene_3 must be Sec 18-25 with CTA plus cta_friction_reducer.
- hook_text_overlay is bilingual Vietnamese / ${outputLanguage}, max 8 words per language. hook_vo is max 12 words. They must not duplicate.
- If visible talent speaks, fill hook_character_speech with the exact on-camera line.
- visual_scene_1, visual_scene_2, visual_scene_3, visual_ref_notes, talent_profile, dont_do, and all production notes MUST be Vietnamese.
- visual_scene_1, visual_scene_2, and visual_scene_3 MUST each include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- title/script name, visual_scene prose, and production notes MUST be Vietnamese. hook_text_overlay, text_overlays.text, and cta_text MUST be bilingual Vietnamese / ${outputLanguage} when ${outputLanguage} is not Vietnamese. hook_vo, hook_character_speech, and script_vo MUST be ${outputLanguage}. hook_voice_vi MUST be Vietnamese with full diacritics. Only quoted Voiceover / CHARACTER SPEECH inside visual_scene uses ${outputLanguage}; quoted Text hiện is bilingual.
- visual_ref_notes must include camera style, lighting, talent direction, and pacing.`;

    const outputSpec = buildCreativeBriefOutputSpec({
      quantity,
      duration,
      appName,
      language: outputLanguage,
      visualType,
      ruleset: creativeRuleset,
    });
    const rulesBlock = useCreativeRulesV7
      ? `${CREATIVE_ADS_GENERATION_RULES_V7}

${BULLETPROOF_VISUAL_ANCHOR_RULES}
${PACING_LIMIT_RULES}

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
- Every idea must include visual_scene_1, visual_scene_2, visual_scene_3, hook_voice_vi, script_vo, cta_text, visual_ref_notes, talent_profile, dont_do, track, track_reason, priority.
- title/script name, visual scenes, and production notes must be Vietnamese. hook_text_overlay, text_overlays.text, and cta_text must be bilingual Vietnamese / ${outputLanguage} when ${outputLanguage} is not Vietnamese. Only hook_vo, hook_character_speech, and script_vo use ${outputLanguage}. In visual_scene rows, embed quoted spoken lines in the exact timing row where the character speaks; quoted Text hien is bilingual. Target market affects local setting, vibe, speech language, and second overlay language.
- hook_voice_vi must be Vietnamese with full diacritics; it translates hook_vo + hook_character_speech, and only if both are empty translates the ${outputLanguage} side of hook_text_overlay.
- Every visual_scene_1/2/3 must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- Each idea must stay inside the selected pain point, selected PSP, selected angle, and selected visual type.`
      : `Generate ${quantity} production-ready full ideas for the selected filter combination.
- Use Creative Idea Engine V2.1 schema and timeline.
- Return hook_text_overlay, hook_vo, hook_character_speech, hook_voice_vi, hook_archetype, hook_alt_1_text/vo/archetype, hook_alt_2_text/vo/archetype, emotion_journey, body_motivation_pattern, text_overlays, cta_friction_reducer, estimated_thumb_stop, and idea_reasoning.
- visual_scene_1 must follow the Hook Timing Rule below. Include bilingual Text hien and Voiceover in the selected voice language inside an existing timing row when needed.
- Every visual_scene_1/2/3 must include Position anchor, Contact anchor, and Physical action anchor clauses inside the visual text.
- Keep the runtime social-first and flexible. Do not lock the concept to a fixed 15s/30s/60s format.
- Each idea must stay inside the selected pillar and selected angle focus.
- Treat the selected angle as one narrow manifestation of the selected pain point, not a replacement for it.
- If an angle is selected, the hook must make that angle visible immediately through the first action, first spoken line, or first contrast.
- Hook, body, and CTA must follow one continuous problem-solution chain.
- Visual / Theme format must be exactly one of the framework formats: 2D Animation, 3D Animation, UGC, POV, or Motion Graphic. Motion Graphic means 2D motion graphics: typography, flat shapes/icons/charts/UI panels/data callouts moving on screen; it is not live-action, 3D render, or full 2D character/cartoon animation. Use social hook patterns separately from visual format.
- If multiple ideas are requested, diversify them aggressively while keeping the same strategic inputs.`;

    const frameworkInjection = buildFrameworkInjection({
      appName,
      category: appCategory,
      coreUsers: coreUserValues,
      primaryEmotion: emotionValues[0] || 'Curiosity',
      visualTheme: `${visualType}. Keep the scenes native to ${marketContextValues.join(', ') || 'the selected market'}.`,
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
        'Stay social-first, market-native, and native to the selected Visual/Theme format',
        'Differentiate opening action, blocker, reveal, and voice opening across ideas',
      ],
      dontList: [
        'Do not drift away from the selected pain point',
        'Do not output cinematic brand-film copy',
        'Do not repeat the same scene family with new wording',
      ],
      anglesPerPillar: 1,
      ideasPerAngle: quantity,
      trackRule: `Track is internal difficulty only. All ideas must keep creativeType = ${visualType}.`,
          language: useCreativeRulesV7
            ? `Bilingual Vietnamese / ${outputLanguage} hook text and CTA; Vietnamese visual notes. Only voice, character speech, and script_vo in ${outputLanguage}.`
            : usePromptSystemBuilderHtml
              ? `Prompt System Builder HTML V1. Bilingual Vietnamese / ${outputLanguage} hook text and CTA; Vietnamese visual notes; only voice, character speech, and script_vo in ${outputLanguage}.`
              : `Bilingual Vietnamese / ${outputLanguage} hook text and CTA; Vietnamese visual notes; only voice, character speech, and script_vo in ${outputLanguage}.`,
      priority: 'A',
      extraContext: [
        `Selected angle: ${angleContext || 'Creative freedom'}`,
        `Idea description: ${ideaDescription || 'Creative freedom'}`,
        `Target market: ${marketContextValues.join(', ') || 'Default market'}`,
      ],
    });
    const selectedStrategyLockBlock = buildSelectedStrategyLockBlock({
      visualType,
      coreUserValues,
      emotionValues,
      marketValues: marketContextValues,
      outputLanguage,
    });

    const prompt = `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

${frameworkInjection}
${selectedStrategyLockBlock}

## SUPPORTING CONTEXT
${knowledgeBlock || '- No AI Brain memory yet.'}
${ideasBlock || '- No recent saved ideas.'}
${trendingBlock || '- No trending hooks injected.'}
${importedTrendBlock || ''}
${winningPatternBlock}
${marketContext}
${marketVisualProfile}
${seasonalVisualBlock || ''}
${variationBlock || ''}
${diversityBlock || ''}
${operatorIdeaBriefBlock}
## HOOK TIMING RULE
${hookTimingRule}
${painpointPrecisionBlock}
${v21ExecutionOverrideBlock}
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
      return NextResponse.json({
        success: false,
        error: getAIGenerationErrorMessage() || 'AI không trả về nội dung. Vui lòng thử lại.',
        meta: {
          requestedQuantity: quantity,
          generatedQuantity: 0,
          batchCount: 0,
          partial: true,
          fallbackCount: 0,
        },
      }, { status: 502 });
    }
    console.log('[generate-ideas] AI response length:', text.length, 'chars');

    let parsed = parseJson(text);
    if (!parsed) {
      console.error('[generate-ideas] Failed to parse:', text.substring(0, 300));
      return NextResponse.json({
        success: false,
        error: 'AI trả về không đúng JSON. Vui lòng thử lại.',
        meta: {
          requestedQuantity: quantity,
          generatedQuantity: 0,
          batchCount: 0,
          partial: true,
          fallbackCount: 0,
        },
      }, { status: 502 });
    }

    let parsedPreview: unknown = parsed;
    let briefOutput = normalizeCreativeBriefOutput(parsed, {
      duration,
      appName,
      category: appCategory,
      pillar: primaryPillar,
      coreUser: coreUserValues.join('; ') || 'General viewer',
      emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
      psp: featureContext,
      angle: angleContext,
      ideaDescription,
      language: outputLanguage,
      visualType,
      ruleset: creativeRuleset,
    });
    let validation = normalizeAndValidateIdeas(briefOutput.items, {
      duration,
      appName,
      category: appCategory,
      psp: featureContext,
      coreUser: coreUserValues.join('; ') || 'General viewer',
      emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
      angle: angleContext,
      pillar: primaryPillar,
      angleIndex: Math.max(angleIndex - 1, 0),
      hookDurationSeconds: requestedHookDuration,
      metricLock,
      visualType,
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
          category: appCategory,
          pillar: primaryPillar,
          coreUser: coreUserValues.join('; ') || 'General viewer',
          emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
          psp: featureContext,
          angle: angleContext,
          ideaDescription,
          language: outputLanguage,
          visualType,
          ruleset: creativeRuleset,
        });
        const retryValidation = normalizeAndValidateIdeas(retryBriefOutput.items, {
          duration,
          appName,
          category: appCategory,
          psp: featureContext,
          coreUser: coreUserValues.join('; ') || 'General viewer',
          emotion: emotionValues.join('; ') || 'Create a clear viewer emotion',
          angle: angleContext,
          pillar: primaryPillar,
          angleIndex: Math.max(angleIndex - 1, 0),
          hookDurationSeconds: requestedHookDuration,
          metricLock,
          visualType,
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
      return NextResponse.json({
        success: false,
        error: 'AI trả về idea không đạt rule V2.1. Vui lòng thử lại hoặc giảm số lượng idea.',
        meta: {
          requestedQuantity: quantity,
          generatedQuantity: 0,
          batchCount: 0,
          partial: true,
          fallbackCount: 0,
          warnings: validation.invalidReasons.length > 0 ? validation.invalidReasons.slice(0, 8) : undefined,
        },
      }, { status: 502 });
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

    return NextResponse.json({
      success: false,
      error: `Generate ideas exception: ${message}`,
      meta: {
        requestedQuantity: toPositiveInt(asRecord(requestBody.config).quantity, 3),
        generatedQuantity: 0,
        batchCount: 0,
        partial: true,
        fallbackCount: 0,
        warnings: [`Generate ideas exception: ${message}. Backend did not return local fallback ideas.`],
      },
    }, { status: 502 });
  }
}
