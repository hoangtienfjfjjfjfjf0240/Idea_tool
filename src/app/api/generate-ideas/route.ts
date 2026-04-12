import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';

export const maxDuration = 120;

function parseJson(text: string) {
  try {
    let clean = text.replace(/```json\s*|```/g, '').trim();
    const s = clean.indexOf('['), e = clean.lastIndexOf(']');
    const s2 = clean.indexOf('{'), e2 = clean.lastIndexOf('}');
    if (s !== -1 && e !== -1 && (s2 === -1 || s < s2)) clean = clean.substring(s, e + 1);
    else if (s2 !== -1 && e2 !== -1) clean = clean.substring(s2, e2 + 1);
    return JSON.parse(clean);
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
    'gpt-4.1': 'openai/gpt-4.1',
    'o4-mini': 'openai/o4-mini',
  };
  return map[selected || ''] || 'gemini/gemini-2.5-pro';
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
4. Script vẫn phải viết kiểu KỊCH BẢN LIỀN MẠCH với [VOICE], [TEXT OVERLAY], [SFX]
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

    // === MODE: GENERATE (tạo idea mới) ===
    const { appName, appCategory, filters, config, previousIdeas, appKnowledge, selectedModel } = body;
    const featureContext = filters?.solution?.length ? filters.solution.join(', ') : "General App Features";
    const quantity = config?.quantity || 3;
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

    const prompt = `[ROLE] Bạn là Senior Creative Strategist chuyên tạo Production Brief cho Meta/TikTok Video Ads.
Output của bạn PHẢI giống hệt một dòng trong Google Sheet production mà team editor đọc xong có thể quay/gen ngay — không cần hỏi thêm.
${knowledgeBlock}
${ideasBlock}

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
RULE #7: FORMAT "SCRIPT" — KỊCH BẢN HÀNH ĐỘNG LIỀN MẠCH (QUAN TRỌNG)
═══════════════════════════════════════
⚠️ KHÔNG viết tách rời Visual / Text / Voice thành các đoạn riêng biệt.
⚠️ KHÔNG viết 3 options cho text (Op1/Op2/Op3). CHỈ 1 TEXT DUY NHẤT.

Mỗi section (hook, body, cta) dùng field "script" = MỘT KỊCH BẢN HÀNH ĐỘNG CỤ THỂ.
Viết như STORYBOARD — MỖI CÂU LÀ 1 HÀNH ĐỘNG theo TIMELINE.
Voice/text xen kẽ trong flow — KHÔNG tách ra sau.

📐 QUY TẮC VIẾT SCRIPT:
1. MỞ ĐẦU = ai, ở đâu, đang làm gì (1 câu, ĐỜI THƯỜNG)
2. Hành động liên tục theo timeline, voice ĐÚNG LÚC nhân vật nói
3. [VOICE] chèn ĐÚNG thời điểm nhân vật nói
4. [TEXT OVERLAY] chèn ĐỂ CHỈ RÕ text hiện lúc nào
5. CẮT ngang / transition / reveal = viết rõ
6. Painpoint hiện qua HÀNH ĐỘNG + LỜI NÓI TỰ NHIÊN

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
Framework/explanation/phân tích = TIẾNG VIỆT. Script voice/text = ${targetLang}.

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
    "script": "KỊCH BẢN LIỀN MẠCH: tình huống ĐỜI THƯỜNG → painpoint THẬT hiện qua HÀNH ĐỘNG + LỜI NÓI TỰ NHIÊN (không setup giả tạo) → VIEWER cảm nhận emotion. [VOICE bằng ${targetLang}, tự nhiên như người thật nói] + [TEXT OVERLAY bằng ${targetLang}] chèn đúng lúc trong flow. KHÔNG copy ví dụ mẫu. Tối thiểu 4-6 câu hành động liên tục.",
    "textOverlay": "1 câu text overlay bằng ${targetLang}",
    "viTranslation": "Bản dịch TIẾNG VIỆT của voice + text overlay trong hook",
    "viewerProfile": "VIEWER ĐANG LƯỚT FEED là ai? Tuổi, giới, đang ở đâu, đang làm gì? (tiếng Việt, 2 câu CỤ THỂ)",
    "viewerEmotion": "VIEWER CẢM NHẬN GÌ khi xem hook? Họ TỰ HỎI gì? MUỐN BIẾT gì tiếp? Mô tả hành trình cảm xúc CỤ THỂ (tiếng Việt, 2-3 câu)",
    "painpointImpact": "VIEWER tự thấy mình ở đâu? Liên tưởng đến vấn đề gì CỦA HỌ? (tiếng Việt, 2-3 câu, nêu ví dụ tình huống thật)",
    "whyTheyStopScrolling": "VIEWER dừng scroll vì lý do gì CỤ THỂ? (tiếng Việt, 1 câu rõ ràng)"
  },
  "body": {
    "script": "KỊCH BẢN LIỀN MẠCH body bằng tiếng Việt + [VOICE bằng ${targetLang}] + [TEXT OVERLAY bằng ${targetLang}].",
    "textOverlay": "Text kết quả/con số bằng ${targetLang}",
    "viTranslation": "Bản dịch tiếng Việt voice + text overlay trong body"
  },
  "cta": {
    "script": "KỊCH BẢN CTA bằng tiếng Việt + [VOICE bằng ${targetLang}] + [TEXT OVERLAY bằng ${targetLang}].",
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
