import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';

export const maxDuration = 120;

function parseJson(text: string) {
  try {
    // Step 1: Strip markdown fences and trim
    let clean = text.replace(/```json\s*|```/g, '').trim();

    // Step 2: Remove BOM and zero-width chars
    clean = clean.replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '');

    // Step 3: Extract JSON array or object
    const s = clean.indexOf('['), e = clean.lastIndexOf(']');
    const s2 = clean.indexOf('{'), e2 = clean.lastIndexOf('}');
    if (s !== -1 && e !== -1 && (s2 === -1 || s < s2)) clean = clean.substring(s, e + 1);
    else if (s2 !== -1 && e2 !== -1) clean = clean.substring(s2, e2 + 1);

    // Step 4: Try direct parse first
    try { return JSON.parse(clean); } catch {}

    // Step 5: Fix common issues and retry
    let fixed = clean
      .replace(/,\s*([}\]])/g, '$1')        // trailing commas
      .replace(/\n/g, '\\n')                 // unescaped newlines in strings
      .replace(/\r/g, '\\r')                 // unescaped carriage returns
      .replace(/\t/g, '\\t');                // unescaped tabs
    try { return JSON.parse(fixed); } catch {}

    // Step 6: More aggressive — fix unescaped newlines inside string values
    fixed = clean.replace(/("(?:[^"\\]|\\.)*")|[\n\r\t]/g, (match, str) => {
      if (str) return str; // inside string, keep as-is
      return ' '; // outside string, replace with space
    });
    try { return JSON.parse(fixed); } catch {}

    // Step 7: Last resort — eval-safe parse via Function
    try {
      const fn = new Function('return ' + clean);
      return fn();
    } catch {}

    return null;
  } catch { return null; }
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // === MODE: REFINE (AI chỉnh sửa idea có sẵn) ===
    if (body.mode === 'refine') {
      const { originalIdea, instruction, appName, appCategory, selectedModel } = body;
      const refinePrompt = `[ROLE] Bạn là Senior Creative Strategist. User muốn CHỈNH SỬA một idea quảng cáo video.

[APP] "${appName}" — Category: "${appCategory || 'General'}"

[IDEA GỐC]
${JSON.stringify(originalIdea, null, 2)}

[YÊU CẦU CHỈNH SỬA TỪ USER]
"${instruction}"

[NHIỆM VỤ]
1. Đọc hiểu idea gốc và yêu cầu chỉnh sửa
2. Áp dụng ĐÚNG yêu cầu chỉnh sửa — chỉ thay đổi phần user yêu cầu, giữ nguyên phần không đề cập
3. Giữ NGUYÊN JSON structure y hệt idea gốc
4. Giữ rõ format tách field visual, voice, textOverlay cho hook/body/cta; không trộn voice/text overlay vào visual
5. Trả về ĐÚNG 1 JSON object (KHÔNG phải array). KHÔNG markdown. KHÔNG giải thích.

⚠️ QUAN TRỌNG:
- Emotion mục tiêu = cảm xúc mà NGƯỜI XEM cảm nhận khi xem video, KHÔNG phải cảm xúc nhân vật diễn
- Visual phải thực tế, dễ quay (UGC style), KHÔNG cinematic/TVC
- Nếu user yêu cầu đổi emotion → thiết kế lại hook để trigger đúng emotion MỚI cho viewer`;

      const text = await askAI(refinePrompt, {
        model: resolveModel(selectedModel),
        temperature: 0.7,
        max_tokens: 8192,
        useCreativePersona: false,
      });
      if (!text) return NextResponse.json({ error: 'AI không phản hồi' }, { status: 500 });
      const parsed = parseJson(text);
      if (!parsed) return NextResponse.json({ error: 'Không parse được' }, { status: 500 });
      return NextResponse.json({ success: true, data: parsed });
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
    const variationBlock = variationIndex > 0
      ? `\n[VARIATION TRONG LẦN GEN HIỆN TẠI]\nĐây là idea ${variationIndex}/${totalVariations}. Phải khác các idea còn lại về tình huống mở đầu, hành động đầu tiên, creative type hoặc nhân vật phụ. Vẫn giữ ĐÚNG core user, painpoint, emotion, PSP, target market, month/season/event và output schema.\n`
      : '';

    const prompt = `[ROLE] Bạn là Senior Creative Strategist chuyên tạo Production Brief cho Meta/TikTok Video Ads.
Output của bạn PHẢI giống hệt một dòng trong Google Sheet production mà team editor đọc xong có thể quay/gen ngay — không cần hỏi thêm.
${knowledgeBlock}
${ideasBlock}
${trendingBlock}
${seasonalVisualBlock}
${variationBlock}

[APP] "${appName}" — Category: "${appCategory || 'General'}"
[PSP] ${featureContext}
[CORE USER] ${filters?.coreUser?.join(', ') || 'General'}
[PAINPOINT] ${filters?.painPoint?.join(', ') || 'General'}
[EMOTION MỤC TIÊU — CẢM XÚC PHẢI TẠO RA CHO NGƯỜI XEM] ${filters?.emotion?.join(', ') || 'General'}
[DẠNG VISUAL] ${visualType}
[NGÔN NGỮ MỤC TIÊU] ${targetLang}
[MÔ TẢ BỔ SUNG] ${config?.ideaDescription || 'Creative Freedom'}
[SỐ LƯỢNG] ${quantity} ideas

═══════════════════════════════════════
RULE #1: EMOTION = CẢM XÚC CỦA NGƯỜI XEM (VIEWER), KHÔNG PHẢI NHÂN VẬT (ACTOR)
═══════════════════════════════════════
⚠️⚠️⚠️ ĐÂY LÀ RULE QUAN TRỌNG NHẤT ⚠️⚠️⚠️

EMOTION MỤC TIÊU LÀ: ${filters?.emotion?.join(', ') || 'General'}
→ Đây là cảm xúc mà NGƯỜI ĐANG LƯỚT FEED phải CẢM NHẬN khi xem hook.
→ KHÔNG PHẢI cảm xúc nhân vật trong video diễn ra.

❌ SAI: Mô tả nhân vật "run rẩy, hoảng sợ, khóc lóc, stress" → đây là DIỄN XUẤT của actor, KHÔNG liên quan đến viewer
✅ ĐÚNG: Thiết kế TÌNH HUỐNG + CÁCH KỂ CHUYỆN khiến NGƯỜI XEM cảm thấy emotion mục tiêu

📌 CÁCH TẠO EMOTION CHO VIEWER THEO TỪNG LOẠI:

🔍 TÒ MÒ (Curious) — VIEWER phải TỰ HỎI "cái gì vậy? phải xem tiếp!":
   → Dùng: CURIOSITY GAP — cho thấy 1 phần kết quả bất ngờ nhưng CẮT NGANG, không reveal hết
   → Dùng: reaction bất ngờ "Wait what?!", before/after tease, "I didn't expect this"
   → Dùng: Expert/authority figure nghi ngờ rồi bị BẤT NGỜ
   → VD: Người quay UGC chụp bathroom cũ → app render kết quả → MẮT MỞ TO "No way..." → CẮT, không cho thấy kết quả
   → ❌ KHÔNG: mô tả nhân vật sợ hãi, stress, khóc — đó KHÔNG tạo tò mò cho viewer

😱 SỢ HÃI (Fear) — VIEWER phải cảm thấy ĐỒNG CẢM + LO CHO MÌNH:
   → Dùng: tình huống relatable mà viewer tự thấy "trời ơi mình cũng có thể bị vậy"
   → KHÔNG dùng: mô tả nhân vật run rẩy ớn lạnh kiểu horror movie
   → VD: UGC bình thường, người quay cho thấy screen phone hiện cảnh báo "storage 99% full" → "Tôi suýt mất hết ảnh..."

🤩 FOMO — VIEWER phải cảm thấy "mọi người biết hết rồi trừ mình":
   → Dùng: social proof, before/after dramatic, "why didn't anyone tell me about this?"
   → VD: "My neighbor showed me this app..." → kết quả wow → viewer: "mình cũng phải thử"

🤯 SHOCK — VIEWER phải "KHÔNG THỂ TIN":
   → Dùng: contrast mạnh, con số bất ngờ, reveal bất ngờ
   → VD: "This FREE app just did what my $5000 interior designer did" → before/after

😢 ĐỒNG CẢM — VIEWER phải thấy MÌNH trong video:
   → Dùng: tình huống quen thuộc, "ai cũng từng trải qua"
   → VD: Bố già loay hoay với phone, con gái thở dài → viewer 35+: "đúng bố mình luôn"

⚠️ EMOTION CHECKPOINT — TỰ KIỂM TRA TRƯỚC KHI OUTPUT:
→ Đọc lại hook: MỘT NGƯỜI ĐANG LƯỚT TIKTOK/REELS sẽ CẢM NHẬN "${filters?.emotion?.join(', ') || 'General'}" CHƯA?
→ Nếu hook chỉ mô tả nhân vật stress/sợ hãi riêng → viewer KHÔNG tự động cảm thấy gì → SAI
→ Hook phải thiết kế để viewer TỰ cảm nhận emotion thông qua: curiosity gap, relatable situation, social proof, shock value

═══════════════════════════════════════
RULE #2: HOOK FORMULA — NHÂN VẬT + PAINPOINT + VIEWER EMOTION
═══════════════════════════════════════
Hook = NHÂN VẬT (core user) GẶP PAINPOINT → nhưng CÁCH KỂ phải trigger EMOTION cho VIEWER.

🔺 BẮT BUỘC:
1. NHÂN VẬT KHỚP CORE USER: Nếu Core User = "Phụ nữ 35-45" → nhân vật phải là phụ nữ 35-45
2. PAINPOINT HIỆN QUA TÌNH HUỐNG: Nhân vật đang gặp painpoint trong tình huống ĐỜI THƯỜNG, THỰC TẾ
3. CÁCH KỂ trigger VIEWER EMOTION: Không phải nhân vật diễn emotion → mà CÁCH KỂ CHUYỆN tạo emotion cho viewer

→ Hook KHÔNG giới thiệu app. App chỉ xuất hiện ở BODY và CTA.

═══════════════════════════════════════
RULE #3: HOOK PHẢI ĐÁNH ĐÚNG PAINPOINT ĐÃ CHỌN — KHÔNG THAY THẾ
═══════════════════════════════════════
Visual type đã chọn: ${visualType}

⚠️⚠️⚠️ RULE QUAN TRỌNG NHẤT:
PAINPOINT ĐÃ CHỌN: "${filters?.painPoint?.join(', ') || 'General'}"
APP: "${appName}" (${appCategory || 'General'})
CORE USER: ${filters?.coreUser?.join(', ') || 'General'}

→ Hook PHẢI đánh ĐÚNG painpoint "${filters?.painPoint?.join(', ') || 'General'}" cho đúng core user.
→ KHÔNG ĐƯỢC thay thế bằng painpoint khác dù có liên quan.

📌 CÁCH HIỂU PAINPOINT — ĐỌC KỸ VÀ DIỄN GIẢI ĐÚNG:
1. Đọc painpoint từ filter: "${filters?.painPoint?.join(', ') || 'General'}"
2. TỰ HỎI: Painpoint này NGHĨA LÀ GÌ trong đời thực của core user?
3. Tình huống nào HÀNG NGÀY mà core user GẶP painpoint này?
4. Họ NÓI GÌ, LÀM GÌ khi đang gặp painpoint này?
5. Hook phải DIỄN TẢ đúng khoảnh khắc đó.

⚠️ NGUYÊN TẮC DIỄN GIẢI PAINPOINT:
- Đọc painpoint THEO NGHĨA ĐEN — nó nói gì thì hook phải nói về cái đó
- KHÔNG tự suy diễn sang vấn đề liên quan nhưng KHÁC BẢN CHẤT

VÍ DỤ CÁCH DIỄN GIẢI ĐÚNG (áp dụng cho BẤT KỲ APP NÀO):

Ví dụ app ĂN UỐNG — painpoint "Ăn uống mất kiểm soát":
= Người dùng ĂN KHÔNG KIỂM SOÁT ĐƯỢC — ăn theo cảm xúc, ăn snack đêm, ăn quá nhiều rồi hối hận
→ TÌNH HUỐNG: Đang buồn/stress → mở tủ lạnh lúc nửa đêm → ăn hết gói snack → nhìn bao bì trống → thở dài
→ KHÔNG PHẢI: "muốn giảm cân" (đó là MỤC TIÊU, khác với painpoint "mất kiểm soát")
→ KHÔNG PHẢI: "không biết nấu gì" (đó là painpoint khác)

Ví dụ app ĂN UỐNG — painpoint "Tăng cân lại dù đã từng cố giảm":
= Người dùng ĐÃ GIẢM THÀNH CÔNG rồi nhưng TĂNG LẠI — yo-yo dieting, thất vọng, tự hỏi "sao lần nào cũng vậy"
→ TÌNH HUỐNG: Cân nặng đo sáng nay lên 5 pounds so với tháng trước — dù đang cố. Nhìn ảnh cũ lúc đã slim.
→ KHÔNG PHẢI: "sợ mắc bệnh" (đó là painpoint sức khỏe, khác)

Ví dụ app THIẾT KẾ — painpoint "Ko biết thiết kế":
= KHÔNG BIẾT chọn style gì, phối màu ra sao → confused, overwhelmed
→ TÌNH HUỐNG: lướt Pinterest 3 giờ mà vẫn 0 quyết định
→ KHÔNG PHẢI: "tốn tiền designer" (đó là painpoint TÀI CHÍNH, khác)

❌ LỖI SAI HAY GẶP — AI THƯỜNG TRỘN LẪN PAINPOINT:
- Painpoint = "Ăn mất kiểm soát" → AI gen hook về "tốn tiền ăn ngoài" → ❌ SAI (đó là painpoint tài chính)
- Painpoint = "Tăng cân lại" → AI gen hook về "không biết nấu gì" → ❌ SAI (đó là painpoint kỹ năng)
- Painpoint = "Ko biết thiết kế" → AI gen hook về "tốn tiền contractor" → ❌ SAI (đó là painpoint tài chính)
- Mỗi painpoint là MỘT VẤN ĐỀ CỤ THỂ, RIÊNG BIỆT. KHÔNG TRỘN LẪN.

📐 CÁCH PAINPOINT PHẢI HIỆN TRONG HOOK:
1. Painpoint hiện qua HÀNH ĐỘNG + LỜI NÓI TỰ NHIÊN (không mô tả suông)
2. Tình huống THỰC TẾ — xảy ra tự nhiên trong đời thường của core user
3. Core user (viewer) phải NHẬN RA NGAY "à đúng rồi mình cũng bị vậy!"
4. KHÔNG setup giả tạo, không diễn kịch

📐 CHECKLIST TRƯỚC KHI OUTPUT:
□ Hook đang nói VỀ ĐÚNG painpoint "${filters?.painPoint?.join(', ') || 'General'}" chưa?
□ Hay đang lạc sang painpoint KHÁC (dù liên quan)?
□ Tình huống có xảy ra TỰ NHIÊN trong đời core user không?
□ Core user có NHẬN RA MÌNH không?

═══════════════════════════════════════
RULE #4: CREATIVE TYPE
═══════════════════════════════════════
Mỗi idea PHẢI thuộc 1 kiểu: UGC / POV / Split Screen / Interview / Reaction / ASMR / Trend Format / Social Proof / Challenge

═══════════════════════════════════════
RULE #5: VOICE PHẢI TỰ NHIÊN — NHƯ NGƯỜI THẬT NÓI
═══════════════════════════════════════
⚠️ Voice/script là yếu tố quan trọng nhất. Nếu voice nghe GIẢ → toàn bộ hook thất bại.

✅ VOICE TỰ NHIÊN — nghe như người thật nói với bạn bè/camera:
- Có ngập ngừng, có "um", "like", "okay so..."
- Câu ngắn, đứt quãng, không hoàn chỉnh ngữ pháp
- Giọng điệu phù hợp tình huống (bực bội, hào hứng, thì thầm, deadpan)
- Phản ứng cảm xúc THẬT — không diễn

❌ VOICE GIẢ — nghe như script quảng cáo:
- Concept name trong voice ("bài kiểm tra sai lầm", "thử thách 30 ngày") → không ai nói thế
- Quá formal ("Trước khi tôi bắt đầu hành trình...") → không phải UGC
- Mở đầu kiểu youtuber ("Chào mọi người, hôm nay tôi sẽ...")
- Tự monologue trước camera không tự nhiên

${marketContext}

═══════════════════════════════════════
RULE #6: SEASON / MONTH / EVENT PHẢI ĐI VÀO VISUAL HOOK
═══════════════════════════════════════
Nếu có SEASONAL VISUAL CONTEXT:
1. Hook visual PHẢI mở bằng một cảnh nhìn ra ngay mùa/tháng/sự kiện qua visual tự nhiên: trang phục, props, màu sắc, ánh sáng, hành vi hoặc set dressing.
2. Context mùa/tháng KHÔNG được xuất hiện như phần mô tả riêng, note riêng hoặc câu giải thích. Nó phải nằm trong hành động/cảnh quay của hook.
3. Chỉ dùng chi tiết hợp với core user, app, painpoint và target market. Ví dụ mùa đông ở SEA/VN không mặc định có tuyết; hãy localize thành gift shopping, Tết, hoodie nhẹ, mưa lạnh, mall decoration nếu hợp hơn.
4. Sự kiện chỉ làm visual đúng thời điểm, KHÔNG thay thế painpoint. Painpoint vẫn là trục chính của Hook.
5. Không tự thêm mùa/sự kiện vào [MÔ TẢ BỔ SUNG]; chỉ áp dụng trong hook.visual.

═══════════════════════════════════════
RULE #7: FORMAT "SCRIPT" — KỊCH BẢN HÀNH ĐỘNG LIỀN MẠCH (QUAN TRỌNG)
═══════════════════════════════════════
⚠️ PHẢI tách rõ 3 field: visual / voice / textOverlay. KHÔNG trộn voice và text overlay vào visual.
⚠️ KHÔNG viết 3 options cho text (Op1/Op2/Op3). CHỈ 1 TEXT DUY NHẤT.

Mỗi section (hook, body, cta) phải có:
- "visual" = mô tả cảnh quay, hành động, camera, bối cảnh
- "voice" = câu nhân vật nói / VOICE tự nhiên
- "textOverlay" = text xuất hiện trên màn hình

📐 QUY TẮC VIẾT:
1. VISUAL chỉ mô tả cảnh quay và hành động theo timeline, KHÔNG chèn [VOICE] hoặc [TEXT OVERLAY]
2. VOICE phải tự nhiên, như người thật nói trong UGC, không đọc slogan
3. TEXT OVERLAY phải ngắn, rõ, không quảng cáo hóa
4. MỞ ĐẦU = ai, ở đâu, đang làm gì (ĐỜI THƯỜNG)
5. Painpoint hiện qua HÀNH ĐỘNG + LỜI NÓI TỰ NHIÊN
6. CẮT ngang / transition / reveal = viết rõ ở visual nếu cần

═══════════════════════════════════════
RULE #8: KHÔNG ĐƯỢC TVC HÓA
═══════════════════════════════════════
⚠️ Output phải là UGC / social-first / handheld / phone-shot / relatable.
⚠️ KHÔNG viết kiểu TVC bóng bẩy, cinematic montage, brand film, voiceover quá trau chuốt, hoặc copy nghe như slogan quảng cáo.

❌ Tránh:
- "Khám phá giải pháp hoàn hảo cho không gian của bạn"
- "Biến ngôi nhà mơ ước thành hiện thực"
- mô tả camera quá điện ảnh, quá dựng, quá staged

✅ Ưu tiên:
- lời nói ngập ngừng, đời thường, hơi lộn xộn
- tình huống thật trong nhà, trong bathroom, khi đang nhìn đồ đạc hoặc scroll Pinterest
- reaction thật, không diễn quá

📌 PAINPOINT = KHOẢNH KHẮC, KHÔNG PHẢI MÔ TẢ:
❌ SAI: "Cô đứng trong bếp, cô muốn giảm cân." → mô tả suông, không có hành động
❌ SAI: "Anh ngồi nhìn cân nặng tăng." → setup giả tạo
✅ ĐÚNG: Khoảnh khắc ĐỜI THƯỜNG — đang làm gì đó bình thường → painpoint BẬT RA tự nhiên qua hành động/lời nói

═══════════════════════════════════════
❌ TUYỆT ĐỐI KHÔNG VIẾT KIỂU SAI NÀY:
═══════════════════════════════════════

SAI 1 — LẠC PAINPOINT (LỖI NGHIÊM TRỌNG NHẤT):
Painpoint đã chọn là A → nhưng hook lại nói về B (dù B liên quan)
→ ❌ MỖI PAINPOINT LÀ MỘT VẤN ĐỀ RIÊNG. KHÔNG TRỘN LẪN.

SAI 2 — SETUP QUÁ RÕ:
Nhân vật cố tình tạo tình huống để nói về painpoint trước camera
→ ❌ Không ai monologue trước camera. Painpoint phải xuất hiện TỰ NHIÊN.

SAI 3 — ĐẶT TÊN CONCEPT:
"We're running the 'XYZ' test/challenge"
→ ❌ Không ai đặt tên hành động mình. Đây là copywriting.

SAI 4 — Copy ví dụ cũ:
→ ❌ KHÔNG copy lại bất cứ ví dụ nào. Phải TẠO MỚI dựa trên painpoint, app, core user ĐÃ CHỌN.

═══════════════════════════════════════
⚠️ RULE: HOOK PHẢI CÓ PHÂN TÍCH — FOCUS VIEWER
═══════════════════════════════════════
Hook PHẢI KÈM PHÂN TÍCH chi tiết về VIEWER (người đang lướt feed), KHÔNG phải nhân vật:
- "viewerProfile": Ai đang LƯỚT FEED sẽ dừng lại? (tuổi, giới, hành vi, bối cảnh sống — CỤ THỂ)
- "viewerEmotion": VIEWER cảm nhận gì khi xem hook? Mô tả hành trình cảm xúc CỦA VIEWER: họ TỰ HỎI gì, LIÊN TƯỞNG gì, MUỐN BIẾT gì tiếp
- "painpointImpact": VIEWER tự thấy mình ở đâu trong tình huống? Họ liên tưởng đến vấn đề nào CỦA HỌ?
- "whyTheyStopScrolling": Tại sao VIEWER DỪNG SCROLL? (curiosity gap, relatable, shock value...)

═══════════════════════════════════════
⚠️ RULE NGÔN NGỮ: PHẢI CÓ BẢN DỊCH TIẾNG VIỆT
═══════════════════════════════════════
Voice/text overlay viết bằng ${targetLang} (ngôn ngữ target).
NHƯNG BẮT BUỘC kèm bản dịch tiếng Việt ("viTranslation") cho MỌI script.
→ Team VN đọc hiểu nhanh, không cần tra từ điển.

═══════════════════════════════════════
CẤU TRÚC VIDEO ${duration}
═══════════════════════════════════════
🎣 HOOK (3-5s): script kịch bản → TẠO EMOTION CHO VIEWER
📖 BODY (10-25s): script kịch bản → DEMO PSP giải quyết Painpoint
🔥 CTA (3-5s): script kịch bản → KÊU GỌI HÀNH ĐỘNG

═══════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════
Trả về ĐÚNG ${quantity} objects trong JSON ARRAY.
KHÔNG markdown. KHÔNG giải thích thêm.
Framework/explanation/phân tích = TIẾNG VIỆT. Voice/text overlay = ${targetLang}. Visual mô tả bằng tiếng Việt tự nhiên.

[{
  "id": 1,
  "title": "Tên concept ngắn tiếng Việt (VD: 'UGC - Chồng cá cược bathroom')",
  "duration": "${duration}",
  "creativeType": "UGC / POV / Interview / Reaction / ...",
  "framework": {
    "coreUser": "Chân dung viewer TARGET: tuổi, giới, hành vi, bối cảnh (tiếng Việt, 2-3 câu)",
    "painpoint": "Nỗi đau CỤ THỂ, mô tả tình huống thực tế (tiếng Việt, 2-3 câu)",
    "emotion": "Cảm xúc mà VIEWER sẽ CẢM NHẬN khi xem hook — mô tả hành trình: viewer nghĩ gì, tự hỏi gì (tiếng Việt, 2-3 câu)",
    "psp": "Tính năng app giải quyết painpoint + cách demo (tiếng Việt)"
  },
  "explanation": "Tại sao idea này hiệu quả + VIEWER emotion trigger bằng cách nào (tiếng Việt, 3-5 câu)",
  "hook": {
    "visual": "Mô tả cảnh quay hook thật cụ thể: ai, ở đâu, đang làm gì, camera lia vào đâu, painpoint hiện ra như thế nào. Viết 3-5 câu ngắn theo timeline. KHÔNG chèn voice hoặc text overlay vào đây.",
    "voice": "1-3 câu nhân vật nói bằng ${targetLang}. Tự nhiên, social-first, không TVC, không slogan.",
    "textOverlay": "1 câu text overlay ngắn bằng ${targetLang}",
    "viTranslation": "Bản dịch TIẾNG VIỆT của voice + text overlay trong hook",
    "viewerProfile": "VIEWER ĐANG LƯỚT FEED là ai? Tuổi, giới, đang ở đâu, đang làm gì? (tiếng Việt, 2 câu CỤ THỂ)",
    "viewerEmotion": "VIEWER CẢM NHẬN GÌ khi xem hook? Họ TỰ HỎI gì? MUỐN BIẾT gì tiếp? Mô tả hành trình cảm xúc CỤ THỂ (tiếng Việt, 2-3 câu)",
    "painpointImpact": "VIEWER tự thấy mình ở đâu? Liên tưởng đến vấn đề gì CỦA HỌ? (tiếng Việt, 2-3 câu, nêu ví dụ tình huống thật)",
    "whyTheyStopScrolling": "VIEWER dừng scroll vì lý do gì CỤ THỂ? (tiếng Việt, 1 câu rõ ràng)"
  },
  "body": {
    "visual": "Mô tả cảnh body: demo app, thao tác, before/after, reaction. Viết theo timeline. KHÔNG chèn voice hoặc text overlay vào đây.",
    "voice": "1-3 câu voice bằng ${targetLang}, tự nhiên như người dùng thật đang nói tiếp.",
    "textOverlay": "Text kết quả/con số bằng ${targetLang}",
    "viTranslation": "Bản dịch tiếng Việt voice + text overlay trong body"
  },
  "cta": {
    "visual": "Mô tả cảnh CTA: màn hình app, tay chỉ, end moment, pose cuối hoặc cut cuối. KHÔNG chèn voice hoặc text overlay vào đây.",
    "voice": "1-2 câu CTA bằng ${targetLang}, ngắn, không gồng quảng cáo.",
    "textOverlay": "CTA bold bằng ${targetLang}",
    "viTranslation": "Bản dịch tiếng Việt voice + text overlay trong CTA",
    "endCard": "${appName} + tagline bằng ${targetLang}"
  }
}]`;

    console.log('[generate-ideas] Prompt length:', prompt.length, 'chars, model:', selectedModel || 'gemini-2.5-pro');
    const text = await askAI(prompt, {
      model: resolveModel(selectedModel),
      temperature: 0.8,
      max_tokens: 16384,
      useCreativePersona: false
    });
    if (!text) {
      console.error('[generate-ideas] AI returned null');
      return NextResponse.json({ error: 'AI không phản hồi. Thử lại.' }, { status: 500 });
    }
    console.log('[generate-ideas] AI response length:', text.length, 'chars');

    const parsed = parseJson(text);
    if (!parsed) {
      console.error('[generate-ideas] Failed to parse:', text.substring(0, 300));
      return NextResponse.json({ error: 'Không parse được response. Thử lại.' }, { status: 500 });
    }

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = arr.filter((i: any) => i?.hook).slice(0, quantity);

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
