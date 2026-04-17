import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';
import {
  buildFrameworkInjection,
  buildIdeaOutputSpec,
  CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT,
  CREATIVE_PROMPT_RULES,
  normalizeIdeaOutput,
  parseJsonLoose,
  TOOL_COMPATIBILITY_GUARDRAILS,
} from '@/lib/creativePromptSystem';

export const maxDuration = 120;

function parseJson(text: string) {
  return parseJsonLoose(text);
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
    'Idea 1: UGC/POV đời thường, mở bằng một hành động cá nhân đang bị kẹt giữa chừng.',
    'Idea 2: Reaction hoặc social interruption, có người/vật thứ hai làm tình huống đổi nhịp.',
    'Idea 3: Split-screen hoặc reveal bất ngờ, mở bằng một blocking object/không gian khác hẳn idea 1.',
    'Idea 4: ASMR/oddly satisfying, mở bằng texture/âm thanh/chuyển động nhỏ gây dừng scroll.',
    'Idea 5: Comment-reply/social proof, mở bằng một câu hỏi hoặc phản ứng từ người khác.',
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
- Nếu trùng scene family, viết lại idea sau thành scene family khác.`;
}

function ideaSignature(idea: any): string {
  return [
    idea?.title,
    idea?.creativeType,
    idea?.hook?.visual,
    idea?.hook?.voice,
    idea?.hook?.textOverlay,
    idea?.body?.visual,
  ].filter(Boolean).join(' ');
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

function hasNearDuplicateIdeas(ideas: any[]): boolean {
  for (let i = 0; i < ideas.length; i++) {
    for (let j = i + 1; j < ideas.length; j++) {
      if (jaccardSimilarity(ideaSignature(ideas[i]), ideaSignature(ideas[j])) >= 0.62) {
        return true;
      }
    }
  }

  return false;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

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
      });
      if (!text) return NextResponse.json({ error: 'AI không phản hồi' }, { status: 500 });
      const parsed = parseJson(text);
      if (!parsed) return NextResponse.json({ error: 'Không parse được' }, { status: 500 });
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

    // === MODE: GENERATE (tạo idea mới) ===
    const { appName, appCategory, filters, config, previousIdeas, appKnowledge, selectedModel, trendingTopics } = body;
    const featureContext = filters?.solution?.length ? filters.solution.join(', ') : "General App Features";
    const quantity = Math.min(config?.quantity || 3, 5); // Cap at 5 to avoid gateway timeout
    const duration = config?.duration || '30s';
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
${marketContext}
${seasonalVisualBlock || ''}
${variationBlock || ''}
${diversityBlock || ''}

## TASK
Generate ${quantity} production-ready full ideas for the selected filter combination.
- Duration: ${duration}
- Each idea must stay inside the selected pillar and selected angle focus.
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
      return NextResponse.json({ error: 'AI không phản hồi. Thử lại.' }, { status: 500 });
    }
    console.log('[generate-ideas] AI response length:', text.length, 'chars');

    let parsed = parseJson(text);
    if (!parsed) {
      console.error('[generate-ideas] Failed to parse:', text.substring(0, 300));
      return NextResponse.json({ error: 'Không parse được response. Thử lại.' }, { status: 500 });
    }

    let arr = Array.isArray(parsed) ? parsed : [parsed];
    let valid = arr
      .map(item => normalizeIdeaOutput(item, { duration, appName, pillar: primaryPillar }))
      .filter(item => {
        const hook = (item?.hook || {}) as Record<string, unknown>;
        return String(hook.visual || hook.script || '').trim().length > 0;
      })
      .slice(0, quantity);

    if (quantity > 1 && valid.length > 1 && hasNearDuplicateIdeas(valid)) {
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
    }

    if (valid.length === 0) {
      console.error('[generate-ideas] No valid ideas:', JSON.stringify(arr[0]).substring(0, 200));
      return NextResponse.json({ error: 'AI trả về format sai. Thử lại.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: valid });
  } catch (err) {
    console.error('[generate-ideas] Exception:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
