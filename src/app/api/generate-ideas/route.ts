import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';
import {
  buildFrameworkInjection,
  buildIdeaOutputSpec,
  CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT,
  CREATIVE_PROMPT_RULES,
  estimateHookDurationSeconds,
  normalizeIdeaOutput,
  parseJsonLoose,
  TOOL_COMPATIBILITY_GUARDRAILS,
} from '@/lib/creativePromptSystem';

export const maxDuration = 120;

function parseJson(text: string) {
  return parseJsonLoose(text);
}

const TRACKING_ID_PATTERN = /^P\d+-A\d+-I\d+$/;
const PATTERN_INTERRUPT_PATTERN = /(?:\?|\d|=|vs\b|still\b|without\b|stop\b|never\b|why\b|how\b|worst\b|finally\b|painful\b|awkward\b|annoying\b|sao\b|vẫn\b|đừng\b|không cần\b|thay vì|bao giờ|tệ nhất|mệt|phiền|khổ)/i;
const MEDICAL_CLAIM_PATTERN = /\b(?:diagnos(?:e|is|ing)|cure|treat(?:ment|ing)?|heal(?:ed|ing)?|detect disease|replace doctor|medical results?|clinical diagnosis|chẩn đoán|điều trị|chữa(?: khỏi)?|phát hiện bệnh|thay thế bác sĩ|kết quả y tế chính xác)\b/i;
const BEFORE_AFTER_PATTERN = /\b(?:before\s*\/\s*after|before and after|trước\s+và\s+sau|trước\s*\/\s*sau)\b/i;
const HEALTH_CONTEXT_PATTERN = /\b(?:health|doctor|disease|symptom|condition|therapy|medical|bệnh|bác sĩ|triệu chứng|sức khỏe|điều trị)\b/i;
const MAX_IDEAS_PER_AI_BATCH = 3;
const MAX_IDEAS_PER_REQUEST = 10;
const GENERATE_IDEAS_BATCH_TIMEOUT_MS = 45000;
const GENERATE_IDEAS_RETRY_TIMEOUT_MS = 25000;

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
  const id = asText(item.id);

  next.id = TRACKING_ID_PATTERN.test(id) ? id : `P0-A${context.angleIndex}-I${context.ideaIndex}`;
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

function normalizeAndValidateIdeas(
  items: unknown[],
  context: { duration: string; appName: string; pillar: string; angleIndex: number; ideaStartIndex?: number }
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
    const errors = validateIdeaOutput(normalized);

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
  return 'EN (Tiếng Anh)';
}

// Map frontend model names to gateway model identifiers
function resolveModel(selected?: string): string {
  const map: Record<string, string> = {
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
      if (jaccardSimilarity(ideaSignature(ideas[i]), ideaSignature(ideas[j])) >= 0.82) {
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

function trimPromptText(text: string, maxLength = 160) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildInRequestIdeaHistory(ideas: Record<string, unknown>[]) {
  if (ideas.length === 0) return '';

  return ideas
    .slice(-8)
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
  const normalizedAngleIndex = Math.max(options.angleIndex - 1, 0);
  const patterns = [
    {
      creativeType: 'UGC',
      hookPrimary: 'Why does this still happen?',
      hookAlt1: 'The hidden blocker is here',
      hookAlt2: 'Stop missing this cue',
      hookVoice: 'Why does this still happen every time?',
      bodyVoice: 'Show the exact blocker first, then reveal the product fix in one clear action.',
      ctaVoice: `Try ${options.appName} with this setup.`,
      bodyOverlay: 'Reveal the blocker',
      ctaOverlay: `Try ${options.appName}`,
      scene: 'handheld close-up on the exact object causing friction',
    },
    {
      creativeType: 'Reaction',
      hookPrimary: 'What changed in one tap?',
      hookAlt1: 'The reaction says it all',
      hookAlt2: 'One tap changed this',
      hookVoice: 'Wait, what changed in one tap?',
      bodyVoice: 'Cut to the reaction, then show the app action that made the change obvious.',
      ctaVoice: `Open ${options.appName} and test it.`,
      bodyOverlay: 'One action, clear result',
      ctaOverlay: 'Test it now',
      scene: 'reaction shot after the first visible result appears on screen',
    },
    {
      creativeType: 'Split Screen',
      hookPrimary: 'Without this, it drags',
      hookAlt1: 'One side feels stuck',
      hookAlt2: 'The contrast is obvious',
      hookVoice: 'Without this, the same task drags.',
      bodyVoice: 'Use a split frame to compare the slow path with the app-assisted path.',
      ctaVoice: `Compare it inside ${options.appName}.`,
      bodyOverlay: 'Slow path vs fix',
      ctaOverlay: 'Compare your result',
      scene: 'split-screen contrast between the messy route and the cleaner app route',
    },
    {
      creativeType: 'Challenge',
      hookPrimary: 'Can you spot the blocker?',
      hookAlt1: 'Most people miss this',
      hookAlt2: 'Find the problem first',
      hookVoice: 'Can you spot the blocker before I show it?',
      bodyVoice: 'Turn the pain point into a quick challenge, then show the fix after the viewer guesses.',
      ctaVoice: `Try the challenge in ${options.appName}.`,
      bodyOverlay: 'Spot the blocker',
      ctaOverlay: 'Try the challenge',
      scene: 'challenge-style opening with the blocker visible but not explained yet',
    },
    {
      creativeType: 'Social Proof',
      hookPrimary: 'Everyone notices this late',
      hookAlt1: 'This comment was right',
      hookAlt2: 'The late clue matters',
      hookVoice: 'Everyone notices this way too late.',
      bodyVoice: 'Frame the idea as a comment reply, then prove the comment with a quick demo.',
      ctaVoice: `Use ${options.appName} for your next test.`,
      bodyOverlay: 'The comment was right',
      ctaOverlay: 'Make your next test',
      scene: 'comment-reply opener with a real-world proof shot immediately after',
    },
    {
      creativeType: 'ASMR',
      hookPrimary: 'Why it feels harder',
      hookAlt1: 'The texture gives it away',
      hookAlt2: 'Listen to the problem',
      hookVoice: 'This is why it feels harder than it should.',
      bodyVoice: 'Use a tactile sound or texture cue to make the pain point feel concrete.',
      ctaVoice: `Check the cleaner path in ${options.appName}.`,
      bodyOverlay: 'Feel the friction',
      ctaOverlay: 'Check the cleaner path',
      scene: 'macro texture or sound cue that makes the friction obvious',
    },
    {
      creativeType: 'Trend Format',
      hookPrimary: 'Never miss this cue',
      hookAlt1: 'The cue appears first',
      hookAlt2: 'This cue changes it',
      hookVoice: 'Never miss this cue again.',
      bodyVoice: 'Use a fast trend-style cut to repeat the cue, then show the app payoff.',
      ctaVoice: `Make the cue obvious with ${options.appName}.`,
      bodyOverlay: 'Cue first, fix second',
      ctaOverlay: 'Make it obvious',
      scene: 'fast trend-style cut built around one repeated visual cue',
    },
    {
      creativeType: 'Interview',
      hookPrimary: 'Would you notice this?',
      hookAlt1: 'This answer changes it',
      hookAlt2: 'Ask this first',
      hookVoice: 'Would you notice this before it becomes a problem?',
      bodyVoice: 'Use a quick street-test or friend-test question, then prove the answer with the app flow.',
      ctaVoice: `Run the same check in ${options.appName}.`,
      bodyOverlay: 'Ask before solving',
      ctaOverlay: 'Run the check',
      scene: 'interview-style opener where one person points at the exact blocker',
    },
    {
      creativeType: 'UGC',
      hookPrimary: 'This shortcut is hidden',
      hookAlt1: 'The shortcut starts here',
      hookAlt2: 'Skip the slow version',
      hookVoice: 'This shortcut is hidden in the moment everyone ignores.',
      bodyVoice: 'Show the slow manual path for one beat, then switch into the cleaner app path.',
      ctaVoice: `Try the shortcut with ${options.appName}.`,
      bodyOverlay: 'Skip the slow path',
      ctaOverlay: 'Try the shortcut',
      scene: 'over-the-shoulder UGC shot with the slow manual workaround visible first',
    },
    {
      creativeType: 'POV',
      hookPrimary: 'Still stuck at this step?',
      hookAlt1: 'This step kills momentum',
      hookAlt2: 'Watch the fix land',
      hookVoice: 'Still stuck at this step?',
      bodyVoice: 'Move from the stuck moment into a simple before-choice-after-action flow.',
      ctaVoice: `Build your version in ${options.appName}.`,
      bodyOverlay: 'Fix the stuck step',
      ctaOverlay: 'Build your version',
      scene: 'single POV frame where the viewer sees the blocker from their own angle',
    },
  ];

  return Array.from({ length: options.quantity }, (_, index) => {
    const displayIndex = (options.startIndex || 0) + index;
    const pattern = patterns[displayIndex % patterns.length];
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
        visualRefNotes: `${visualType} for ${targetMarket}; open on ${pattern.scene}.`,
        talentProfile: coreUser,
        dontDo: 'Do not show a generic app screen without the selected pain object.',
        track: visualType.toLowerCase().includes('motion') ? 'C' : 'B',
        trackReason: `Fallback keeps the selected angle "${angleName}" visible through ${pattern.scene}.`,
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
        durationSeconds: estimateHookDurationSeconds({
          visual: `Open with ${pattern.scene}. The first frame clearly shows "${painpoint}" for ${coreUser}, in a ${targetMarket} context, before any app UI appears.`,
          voice: pattern.hookVoice,
          textOverlay: pattern.hookPrimary,
        }),
        visual: `Open with ${pattern.scene}. The first frame clearly shows "${painpoint}" for ${coreUser}, in a ${targetMarket} context, before any app UI appears.`,
        voice: pattern.hookVoice,
        textOverlay: pattern.hookPrimary,
        viTranslation: `Giữ đúng painpoint "${painpoint}" và mở bằng angle "${angleName}".`,
        viewerProfile: coreUser,
        viewerEmotion: `Viewer feels ${emotion} because the blocker is visible before the explanation.`,
        painpointImpact: `The pain point becomes concrete through the first visible object or action.`,
        whyTheyStopScrolling: `The hook asks a direct question and makes the blocker visible immediately.`,
      },
      body: {
        visual: `Show the stuck moment for two quick beats, then move into ${options.appName} solving the exact same situation without changing the pain point.`,
        voice: pattern.bodyVoice,
        textOverlay: pattern.bodyOverlay,
        viTranslation: `Demo ${psp} như cách giải quyết trực tiếp cho painpoint đã chọn.`,
      },
      cta: {
        visual: `End on the ${options.appName} result screen with the key action visible and no extra feature detour.`,
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
  let requestBody: any = {};
  try {
    requestBody = asRecord(await request.json());
    const body = requestBody;

    // === MODE: REFINE (AI chỉnh sửa idea có sẵn) ===
    if (body.mode === 'refine') {
      const { originalIdea, instruction, appName, appCategory, selectedModel } = body;
      const originalFramework = originalIdea?.framework || {};
      const refineFramework = buildFrameworkInjection({
        appName,
        category: appCategory || 'General',
        coreUsers: [String(originalFramework.coreUser || '')].filter(Boolean),
        primaryEmotion: String(originalFramework.emotion || 'Curiosity'),
        visualTheme: String(originalIdea?.creativeType || 'UGC') || 'UGC',
        psp: String(originalFramework.psp || appName),
        pillars: [String(originalFramework.painpoint || '')].filter(Boolean),
        anglesPerPillar: 1,
        ideasPerAngle: 1,
        language: 'Vietnamese strategy notes + original copy language',
        priority: 'A',
        extraContext: [
          'Task type: refine an existing idea, do not rewrite unrelated parts.',
          'Preserve the current JSON field structure and keep meta coherent after edits.',
        ],
      });
      const refinePrompt = `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

${refineFramework}

## TASK
Refine one existing production brief using the user instruction below.
- Apply only the requested changes.
- Preserve the same problem-solution chain unless the user explicitly changes it.
- Keep visual, voice, and textOverlay separated for hook, body, and CTA.
- Return exactly 1 JSON object, not an array.

[EXISTING IDEA JSON]
${JSON.stringify(originalIdea, null, 2)}

[USER REFINE BRIEF]
"${instruction}"

## OBJECT SCHEMA
Use the same field schema as one item from the standard idea output spec:
${buildIdeaOutputSpec({ quantity: 1, duration: originalIdea?.duration || '30s', appName, language: 'original copy language' })}

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
          duration: originalIdea?.duration || '30s',
          appName,
          pillar: String(originalFramework.painpoint || ''),
        }),
      });
    }

    // === MODE: GENERATE ANGLES (tạo angle từ painpoint) ===
    if (body.mode === 'generate-angles') {
      const { appName, appCategory, painpoints, coreUsers, emotions } = body;
      const pps = (painpoints || []).join('; ');
      const anglePrompt = `Tạo angle quảng cáo cho app "${appName}" (${appCategory || 'App'}).
Painpoints: ${pps}
Core Users: ${(coreUsers || []).join('; ')}
Emotions: ${(emotions || []).join('; ')}

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

        const res = await fetch(`${process.env.AI_BASE_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.AI_API_KEY}`,
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
      const fallback = (painpoints || []).flatMap((pp: string) => [
        `${pp} nhưng bạn vẫn chưa biết bắt đầu từ đâu`,
        `${pp} và mỗi lần nhìn vào nhà lại càng rối hơn`,
        `${pp} dù đã xem rất nhiều ý tưởng đẹp trên mạng`,
      ]);
      return NextResponse.json({ success: true, angles: fallback });
    }

    if (body.mode !== 'refine' && body.mode !== 'generate-angles') {
      const { appName, appCategory, filters, config, previousIdeas, appKnowledge, selectedModel, trendingTopics, trendingStructures } = body;
      const featureContext = filters?.solution?.length ? filters.solution.join(', ') : 'General App Features';
      const requestedQuantity = Math.min(toPositiveInt(config?.quantity, 3), MAX_IDEAS_PER_REQUEST);
      const duration = config?.duration || 'Short social-first runtime';
      const visualType = config?.visualType || 'UGC (Người thật)';
      const targetLang = detectLang(filters?.coreUser);
      const marketContext = buildMarketContext(filters?.targetMarket);
      const angleContext = filters?.angle?.length ? filters.angle.join(', ') : '';
      const primaryPillar = filters?.painPoint?.[0] || 'General user friction';
      const angleIndex = Number(config?.angleIndex || 1);
      const totalAngles = Number(config?.totalAngles || 1);
      const requestStartIndex = Math.max(0, Number(config?.startIndex || 0) || 0);
      const totalVariations = Math.max(requestedQuantity, Number(config?.totalVariations || requestedQuantity) || requestedQuantity);
      const resolvedModel = resolveModel(selectedModel);
      const batchPlans = buildIdeaBatchPlans(requestedQuantity);

      const rawKnowledge = appKnowledge || '';
      const truncatedKnowledge = rawKnowledge.length > 3000 ? `${rawKnowledge.substring(0, 3000)}\n[...truncated]` : rawKnowledge;
      const knowledgeBlock = truncatedKnowledge
        ? `\n[APP BRAIN - learned context for "${appName}"]\n${truncatedKnowledge}\n`
        : '';
      const recentIdeasBlock = previousIdeas
        ? `\n[RECENT SAVED IDEAS - learn style, do not repeat]\n${previousIdeas}\n`
        : '';
      const trendingBlock = trendingTopics?.length
        ? `\n[TRENDING CONTEXT]\n${trendingTopics.join(', ')}\nUse trends only when they naturally fit the selected pain point and emotion.\n`
        : '';
      const structuredTrendNotes = Array.isArray(trendingStructures)
        ? trendingStructures
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 6)
        : [];
      const importedTrendBlock = structuredTrendNotes.length
        ? `\n[IMPORTED VIDEO STRUCTURE]\n${structuredTrendNotes.join('\n')}\nLearn pacing and treatment, but do not copy the source structure verbatim.\n`
        : '';
      const seasonalVisualBlock = buildSeasonalVisualBlock(config?.seasonalVisualContext);

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
        const variationBlock = buildVariationWindowBlock(
          plan.batchStartIndex,
          plan.batchQuantity,
          requestedQuantity
        );
        const diversityBlock = buildBatchDiversityBlock(
          plan.batchQuantity,
          angleContext,
          angleIndex,
          totalAngles
        );

        const frameworkInjection = buildFrameworkInjection({
          appName,
          category: appCategory || 'General',
          coreUsers: filters?.coreUser || [],
          primaryEmotion: filters?.emotion?.[0] || 'Curiosity',
          visualTheme: `${visualType}. Keep the scenes native to ${filters?.targetMarket?.join(', ') || 'the selected market'}.`,
          psp: featureContext,
          pillars: filters?.painPoint?.length ? filters.painPoint : ['General user friction'],
          trendingHooks: trendingTopics || [],
          performanceData: [
            rawKnowledge ? `AI Brain memory: ${truncatedKnowledge}` : 'No AI Brain memory yet',
            previousIdeas ? `Recent idea history for anti-repeat:\n${previousIdeas}` : 'No recent saved ideas',
            inRequestHistory ? `Ideas already generated in this request:\n${inRequestHistory}` : 'No earlier ideas inside this request',
            structuredTrendNotes.length ? `Imported video structure:\n${structuredTrendNotes.join('\n')}` : 'No imported video structure',
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
          language: `Vietnamese strategy notes, ${targetLang} voice/text overlay`,
          priority: 'A',
          extraContext: [
            `Selected angle: ${angleContext || 'Creative freedom'}`,
            `Idea description: ${config?.ideaDescription || 'Creative freedom'}`,
            `Target market: ${filters?.targetMarket?.join(', ') || 'Default market'}`,
            `Batch window: ${requestStartIndex + plan.batchStartIndex + 1}-${requestStartIndex + plan.batchStartIndex + plan.batchQuantity}/${totalVariations}`,
          ],
        });

        const prompt = `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

${frameworkInjection}

## SUPPORTING CONTEXT
${knowledgeBlock || '- No AI Brain memory yet.'}
${recentIdeasBlock || '- No recent saved ideas.'}
${inRequestHistoryBlock || '- No earlier ideas in this request.'}
${trendingBlock || '- No trending hooks injected.'}
${importedTrendBlock || ''}
${marketContext}
${seasonalVisualBlock || ''}
${variationBlock || ''}
${diversityBlock || ''}

## TASK
Generate ${plan.batchQuantity} production-ready full ideas for the selected filter combination.
- Duration: ${duration}
- The final target for this selected angle is ${totalVariations} ideas. This API call only covers items ${requestStartIndex + plan.batchStartIndex + 1}-${requestStartIndex + plan.batchStartIndex + plan.batchQuantity}.
- Each idea must stay inside the selected pillar and selected angle focus.
- Treat the selected angle as one narrow manifestation of the selected pain point, not a replacement for it.
- If an angle is selected, the hook must make that angle visible immediately through the first action, first spoken line, or first contrast.
- Hook, body, and CTA must follow one continuous problem-solution chain.
- If multiple ideas are requested, diversify them aggressively while keeping the same strategic inputs.
- Creative type cap: output at most 1 POV idea in this batch. Use UGC, Reaction, Split Screen, Challenge, Social Proof, ASMR, Interview, or Trend Format for the rest.

${buildIdeaOutputSpec({ quantity: plan.batchQuantity, duration, appName, language: targetLang })}

${CREATIVE_PROMPT_RULES}
${TOOL_COMPATIBILITY_GUARDRAILS}`;

        console.log(
          '[generate-ideas] Batch prompt:',
          `${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity}/${requestedQuantity}`,
          'chars:',
          prompt.length,
          'model:',
          selectedModel || 'gemini-2.5-pro'
        );

        const text = await askAI(prompt, {
          model: resolvedModel,
          temperature: plan.batchQuantity > 1 ? 0.9 : 0.8,
          max_tokens: 16384,
          useCreativePersona: false,
          priority: 'high',
          timeoutMs: GENERATE_IDEAS_BATCH_TIMEOUT_MS,
        });

        if (!text) {
          throw new Error('AI không phản hồi');
        }

        const parsed = parseJson(text);
        if (!parsed) {
          console.error('[generate-ideas] Failed to parse:', text.substring(0, 300));
          throw new Error('Không parse được response. Thử lại.');
        }

        let arr = Array.isArray(parsed) ? parsed : [parsed];
        let validation = normalizeAndValidateIdeas(arr, {
          duration,
          appName,
          pillar: primaryPillar,
          angleIndex: Math.max(angleIndex - 1, 0),
          ideaStartIndex: requestStartIndex + plan.batchStartIndex,
        });
        let valid = dedupeIdeas(validation.valid, priorGeneratedIdeas).slice(0, plan.batchQuantity);
        const duplicateDetected = valid.length > 1 && hasNearDuplicateIdeas(valid);
        const needsValidationRetry = validation.invalidReasons.length > 0 || valid.length < plan.batchQuantity;

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
            retryNotes.push(`The previous batch contains ideas that are too similar. Regenerate all ${plan.batchQuantity} ideas with clearly different scene families, opening actions, props, camera reveals, voice openings, and creative types.`);
          }
          if (valid.length < plan.batchQuantity) {
            retryNotes.push('Too many ideas reused the same creativeType or POV. Keep POV to max 1 and fill the rest with non-POV formats.');
          }

          const retryText = await askAI(`${prompt}

[RETRY - INVALID OR TOO WEAK]
Regenerate all ${plan.batchQuantity} ideas and obey the hard rules strictly.
${retryNotes.join('\n\n')}`, {
            model: resolvedModel,
            temperature: 0.95,
            max_tokens: 16384,
            useCreativePersona: false,
            priority: 'high',
            timeoutMs: GENERATE_IDEAS_RETRY_TIMEOUT_MS,
          });

          if (retryText) {
            const retryParsed = parseJson(retryText);
            const retryArr = Array.isArray(retryParsed) ? retryParsed : retryParsed ? [retryParsed] : [];
            const retryValidation = normalizeAndValidateIdeas(retryArr, {
              duration,
              appName,
              pillar: primaryPillar,
              angleIndex: Math.max(angleIndex - 1, 0),
              ideaStartIndex: requestStartIndex + plan.batchStartIndex,
            });
            const retryValid = dedupeIdeas(retryValidation.valid, priorGeneratedIdeas).slice(0, plan.batchQuantity);
            const retryHasDuplicates = retryValid.length > 1 && hasNearDuplicateIdeas(retryValid);

            const shouldUseRetry = retryValid.length > valid.length
              || (valid.length === 0 && retryValid.length > 0)
              || (duplicateDetected && retryValid.length > 0 && !retryHasDuplicates);

            if (shouldUseRetry && (retryValid.length > 0 || retryValidation.invalidReasons.length === 0)) {
              arr = retryArr;
              validation = retryValidation;
              valid = retryValid;
            }
          }
        }

        if (valid.length === 0) {
          console.error('[generate-ideas] No valid ideas:', JSON.stringify(arr[0]).substring(0, 200));
          if (validation.invalidReasons.length > 0) {
            console.error('[generate-ideas] Validation failures:', validation.invalidReasons);
          }
          throw new Error('AI trả về format sai. Thử lại.');
        }

        return valid.slice(0, plan.batchQuantity);
      };

      const aggregatedIdeas: Record<string, unknown>[] = [];
      const batchErrors: string[] = [];
      let fallbackCount = 0;

      for (const plan of batchPlans) {
        try {
          const batchIdeas = await runGenerationBatch(plan, aggregatedIdeas);
          if (batchIdeas.length < plan.batchQuantity) {
            const missingCount = plan.batchQuantity - batchIdeas.length;
            const recoveredIdeas = await refillIdeasOneByOne(
              missingCount,
              plan.batchStartIndex + batchIdeas.length,
              [...aggregatedIdeas, ...batchIdeas],
              `batch ${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity} returned too few ideas`
            );
            batchIdeas.push(...recoveredIdeas);

            const stillMissing = plan.batchQuantity - batchIdeas.length;
            if (stillMissing > 0) {
              const fallbackIdeas = buildFallbackIdeasForFilters({
                appName,
                filters,
                quantity: stillMissing,
                duration,
                startIndex: requestStartIndex + plan.batchStartIndex + batchIdeas.length,
                angleIndex,
                ideaDescription: config?.ideaDescription,
              });
              batchIdeas.push(...fallbackIdeas);
              fallbackCount += fallbackIdeas.length;
            }

            batchErrors.push(
              `Batch ${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity} was short; AI refill added ${recoveredIdeas.length}, fallback added ${Math.max(0, stillMissing)}.`
            );
          }
          aggregatedIdeas.push(...batchIdeas.slice(0, plan.batchQuantity));
        } catch (batchError) {
          const rangeLabel = `${plan.batchStartIndex + 1}-${plan.batchStartIndex + plan.batchQuantity}/${requestedQuantity}`;
          console.error(`[generate-ideas] Batch ${rangeLabel} failed:`, batchError);
          const batchErrorMessage = batchError instanceof Error
            ? batchError.message
            : 'Unknown batch error';
          const recoveredIdeas = await refillIdeasOneByOne(
            plan.batchQuantity,
            plan.batchStartIndex,
            aggregatedIdeas,
            rangeLabel
          );
          aggregatedIdeas.push(...recoveredIdeas);

          const stillMissing = plan.batchQuantity - recoveredIdeas.length;
          if (stillMissing > 0) {
            const fallbackIdeas = buildFallbackIdeasForFilters({
              appName,
              filters,
              quantity: stillMissing,
              duration,
              startIndex: requestStartIndex + plan.batchStartIndex + recoveredIdeas.length,
              angleIndex,
              ideaDescription: config?.ideaDescription,
            });
            aggregatedIdeas.push(...fallbackIdeas);
            fallbackCount += fallbackIdeas.length;
          }

          batchErrors.push(
            `${rangeLabel}: ${batchErrorMessage}. AI refill added ${recoveredIdeas.length}, fallback added ${Math.max(0, stillMissing)}.`
          );
        }
      }

      if (aggregatedIdeas.length < requestedQuantity) {
        const missingCount = requestedQuantity - aggregatedIdeas.length;
        const recoveredIdeas = await refillIdeasOneByOne(
          missingCount,
          aggregatedIdeas.length,
          aggregatedIdeas,
          'final top-up'
        );
        aggregatedIdeas.push(...recoveredIdeas);

        const stillMissing = requestedQuantity - aggregatedIdeas.length;
        if (stillMissing > 0) {
          const finalTopUp = buildFallbackIdeasForFilters({
            appName,
            filters,
            quantity: stillMissing,
            duration,
            startIndex: requestStartIndex + aggregatedIdeas.length,
            angleIndex,
            ideaDescription: config?.ideaDescription,
          });
          aggregatedIdeas.push(...finalTopUp);
          fallbackCount += finalTopUp.length;
        }

        batchErrors.push(
          `Backend final top-up: AI refill added ${recoveredIdeas.length}, fallback added ${Math.max(0, stillMissing)}.`
        );
      }

      if (aggregatedIdeas.length === 0) {
        const emergencyIdeas = buildFallbackIdeasForFilters({
          appName,
          filters,
          quantity: requestedQuantity,
          duration,
          startIndex: requestStartIndex,
          angleIndex,
          ideaDescription: config?.ideaDescription,
        });
        aggregatedIdeas.push(...emergencyIdeas);
        fallbackCount += emergencyIdeas.length;
        batchErrors.push('All AI batches failed; backend generated a full schema-safe fallback batch.');
      }

      const finalIdeas = aggregatedIdeas.slice(0, requestedQuantity);
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
    const { appName, appCategory, filters, config, previousIdeas, appKnowledge, selectedModel, trendingTopics, trendingStructures } = body;
    const featureContext = filters?.solution?.length ? filters.solution.join(', ') : "General App Features";
    const quantity = Math.min(config?.quantity || 3, 5); // Cap at 5 to avoid gateway timeout
    const duration = config?.duration || 'Short social-first runtime';
    const visualType = config?.visualType || 'UGC (Người thật)';
    const targetLang = detectLang(filters?.coreUser);
    const marketContext = buildMarketContext(filters?.targetMarket);
    const angleContext = filters?.angle?.length ? filters.angle.join(', ') : '';
    const primaryPillar = filters?.painPoint?.[0] || 'General user friction';

    // Truncate knowledge to avoid prompt overflow
    const rawKnowledge = appKnowledge || '';
    const truncatedKnowledge = rawKnowledge.length > 3000 ? rawKnowledge.substring(0, 3000) + '\n[...truncated]' : rawKnowledge;

    const knowledgeBlock = truncatedKnowledge
      ? `\n[APP BRAIN — Kiến thức AI đã học cho app "${appName}". NGUỒN THAM KHẢO #1.]\n${truncatedKnowledge}\n`
      : '';

    const ideasBlock = previousIdeas
      ? `\n[IDEAS GẦN ĐÂY — Học phong cách, nâng cấp, KHÔNG lặp lại]\n${previousIdeas}\n`
      : '';

    const trendingBlock = trendingTopics?.length
      ? `\n[TRENDING HIỆN TẠI — KẾT HỢP NẾU PHÙ HỢP]\n${trendingTopics.join(', ')}\n→ Kết hợp trend vào tình huống/hook nếu tự nhiên. KHÔNG ép trend vào nếu không phù hợp với painpoint/emotion đã chọn.\n`
      : '';
    const structuredTrendNotes = Array.isArray(trendingStructures)
      ? trendingStructures
          .map(item => String(item || '').trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    const importedTrendBlock = structuredTrendNotes.length
      ? `\n[IMPORTED VIDEO STRUCTURE — ƯU TIÊN HỌC CẤU TRÚC, KHÔNG COPY NGUYÊN XI]\n${structuredTrendNotes.join('\n')}\n→ Học nhịp hook/body/CTA, camera treatment, audio pattern và text overlay style. Vẫn phải bám đúng painpoint/emotion/filter của app.\n`
      : '';
    const seasonalVisualBlock = buildSeasonalVisualBlock(config?.seasonalVisualContext);
    const variationIndex = Number(config?.variationIndex || 0);
    const totalVariations = Number(config?.totalVariations || quantity);
    const angleIndex = Number(config?.angleIndex || 1);
    const totalAngles = Number(config?.totalAngles || 1);
    const variationBlock = variationIndex > 0
      ? `\n[VARIATION TRONG LẦN GEN HIỆN TẠI]\nĐây là idea ${variationIndex}/${totalVariations}. Phải khác các idea còn lại về tình huống mở đầu, hành động đầu tiên, creative type hoặc nhân vật phụ. Vẫn giữ ĐÚNG core user, painpoint, emotion, PSP, target market, month/season/event và output schema.\n`
      : '';
    const diversityBlock = buildBatchDiversityBlock(quantity, angleContext, angleIndex, totalAngles);

    const frameworkInjection = buildFrameworkInjection({
      appName,
      category: appCategory || 'General',
      coreUsers: filters?.coreUser || [],
      primaryEmotion: filters?.emotion?.[0] || 'Curiosity',
      visualTheme: `${visualType}. Keep the scenes native to ${filters?.targetMarket?.join(', ') || 'the selected market'}.`,
      psp: featureContext,
      pillars: filters?.painPoint?.length ? filters.painPoint : ['General user friction'],
      trendingHooks: trendingTopics || [],
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
      language: `Vietnamese strategy notes, ${targetLang} voice/text overlay`,
      priority: 'A',
      extraContext: [
        `Selected angle: ${angleContext || 'Creative freedom'}`,
        `Idea description: ${config?.ideaDescription || 'Creative freedom'}`,
        `Target market: ${filters?.targetMarket?.join(', ') || 'Default market'}`,
      ],
    });

    const prompt = `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

${frameworkInjection}

## SUPPORTING CONTEXT
${knowledgeBlock || '- No AI Brain memory yet.'}
${ideasBlock || '- No recent saved ideas.'}
${trendingBlock || '- No trending hooks injected.'}
${importedTrendBlock || ''}
${marketContext}
${seasonalVisualBlock || ''}
${variationBlock || ''}
${diversityBlock || ''}

## TASK
Generate ${quantity} production-ready full ideas for the selected filter combination.
- Keep the runtime social-first and flexible. Do not lock the concept to a fixed 15s/30s/60s format.
- Each idea must stay inside the selected pillar and selected angle focus.
- Treat the selected angle as one narrow manifestation of the selected pain point, not a replacement for it.
- If an angle is selected, the hook must make that angle visible immediately through the first action, first spoken line, or first contrast.
- Hook, body, and CTA must follow one continuous problem-solution chain.
- If multiple ideas are requested, diversify them aggressively while keeping the same strategic inputs.

${buildIdeaOutputSpec({ quantity, duration, appName, language: targetLang })}

${CREATIVE_PROMPT_RULES}
${TOOL_COMPATIBILITY_GUARDRAILS}`;

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

    let arr = Array.isArray(parsed) ? parsed : [parsed];
    let validation = normalizeAndValidateIdeas(arr, {
      duration,
      appName,
      pillar: primaryPillar,
      angleIndex: Math.max(angleIndex - 1, 0),
    });
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
        retryNotes.push(`Batch trước có các hook quá giống nhau. Hãy tạo lại TOÀN BỘ ${quantity} ideas.
Bắt buộc mỗi idea khác scene family: đổi địa điểm, nhân vật phụ, object blocker, opening action, camera reveal, voice mở đầu và creativeType.
Không giữ lại cùng một cảnh rồi chỉ đổi vài chi tiết nhỏ.`);
      }

      const retryText = await askAI(`${prompt}

[RETRY — INVALID HOẶC QUÁ YẾU]
Tạo lại TOÀN BỘ ${quantity} ideas. Tuân thủ nghiêm ngặt hard rules.
${retryNotes.join('\n\n')}`, {
        model: resolveModel(selectedModel),
        temperature: 0.95,
        max_tokens: 16384,
        useCreativePersona: false
      });

      if (retryText) {
        const retryParsed = parseJson(retryText);
        const retryArr = Array.isArray(retryParsed) ? retryParsed : retryParsed ? [retryParsed] : [];
        const retryValidation = normalizeAndValidateIdeas(retryArr, {
          duration,
          appName,
          pillar: primaryPillar,
          angleIndex: Math.max(angleIndex - 1, 0),
        });
        const retryValid = retryValidation.valid.slice(0, quantity);
        const retryHasDuplicates = retryValid.length > 1 && hasNearDuplicateIdeas(retryValid);

        const shouldUseRetry = retryValid.length > valid.length
          || (valid.length === 0 && retryValid.length > 0)
          || (duplicateDetected && retryValid.length > 0 && !retryHasDuplicates);

        if (shouldUseRetry && (retryValid.length > 0 || retryValidation.invalidReasons.length === 0)) {
          text = retryText;
          parsed = retryParsed;
          arr = retryArr;
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
      console.error('[generate-ideas] No valid ideas:', JSON.stringify(arr[0]).substring(0, 200));
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
