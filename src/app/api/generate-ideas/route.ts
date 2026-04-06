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

export async function POST(request: NextRequest) {
  try {
    const { appName, appCategory, filters, config, previousIdeas, appKnowledge } = await request.json();
    const featureContext = filters?.solution?.length ? filters.solution.join(', ') : "General App Features";
    const quantity = config?.quantity || 3;
    const duration = config?.duration || '30s';
    const visualType = config?.visualType || 'UGC (Người thật)';
    const targetLang = detectLang(filters?.coreUser);

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
RULE #1: HOOK FORMULA (BẮT BUỘC)
═══════════════════════════════════════
Hook = Visual/Text/Voice khiến NGƯỜI XEM (viewer) cảm thấy đúng EMOTION MỤC TIÊU khi nhìn thấy PAINPOINT của CORE USER.

⚠️ PHÂN BIỆT:
- EMOTION = cảm xúc hook tạo ra CHO NGƯỜI XEM (VD: người xem phải SỢ HÃI, LO LẮNG)
- EMOTION ≠ cảm xúc của nhân vật (nhân vật có thể bình thường, TÌNH HUỐNG phải khiến NGƯỜI XEM lo sợ)
→ Hook KHÔNG giới thiệu app. Hook KỂ CHUYỆN tạo EMOTION cho viewer.
→ App chỉ xuất hiện ở BODY và CTA.

═══════════════════════════════════════
RULE #2: VISUAL TYPE BẮT BUỘC: ${visualType}
═══════════════════════════════════════
• UGC (Người thật): Quay bằng điện thoại, góc selfie/handheld, ánh sáng tự nhiên, setting đời thường
• Screen Recording: Quay màn hình điện thoại, finger tap
• Green Screen: Người thật trước nền xanh
• Mixed Media: Cảnh quay thật + overlay đồ họa
• ASMR: Cận cảnh extreme close-up, không voice-over
• Trend Format: Theo format viral TikTok đang hot

═══════════════════════════════════════
RULE #3: CREATIVE TYPE (ghi rõ)
═══════════════════════════════════════
Mỗi idea PHẢI thuộc 1 kiểu: UGC / POV / Split Screen / Interview / Reaction / Hỏi AI / ASMR / Localize / Scale / Breaking News / Social Proof

═══════════════════════════════════════
RULE #4: ANTI-TVC (KHÔNG vi phạm)
═══════════════════════════════════════
❌ Không nhạc nền epic/cinematic, không slow-motion, không studio lighting
❌ Không script dài dòng, sáo rỗng, trừu tượng
✅ Phải giống video TikTok/UGC: tự nhiên, hơi raw, đời thường

═══════════════════════════════════════
⚠️ RULE #4.5: VĂN HÓA & HÀNH VI (CỰC KỲ QUAN TRỌNG)
═══════════════════════════════════════
Thị trường mục tiêu: US (Mỹ). MỌI chi tiết trong script PHẢI chuẩn xác về văn hóa, thói quen, hành vi của người Mỹ:

🏠 BỐI CẢNH ĐỜI THƯỜNG MỸ:
- Nhà: suburban house, apartment, kitchen with granite counter, living room with sectional sofa, backyard/patio/deck
- Xe: minivan, SUV, sedan, park ở garage/driveway/parking lot
- Nơi công cộng: Walmart, Target, CVS, Starbucks, gas station, doctor's office
- Sự kiện: Thanksgiving dinner, kids' soccer practice, Sunday brunch, road trip, BBQ

📱 CÔNG NGHỆ & APP PHẢI DÙNG TÊN THẬT:
- iPhone hoặc Samsung Galaxy (KHÔNG Xiaomi, Oppo, Vivo)
- Siri, Google Assistant (KHÔNG Zalo, WeChat)
- Ring doorbell, SimpliSafe, ADT camera (KHÔNG "Home Security" generic)
- Venmo, Apple Pay, Cash App, banking apps: Chase, Bank of America, Wells Fargo
- Health insurance: MyChart, Blue Cross, UnitedHealthcare app
- Parking: ParkMobile, SpotHero, PayByPhone (KHÔNG "ParkingPay" generic)
- Social: Facebook, Instagram, TikTok, YouTube, Snapchat

👥 HÀNH VI & CÁCH NÓI MỸ:
- Gọi "Dad/Mom", "honey", "babe" (KHÔNG "bố/mẹ/con")
- Tiếng lóng: "dude", "literally", "I can't even", "no way", "oh my god"
- Cha mẹ 50-65t ở Mỹ: dùng iPad/iPhone, hay forward email chain, save memes, screenshot recipes từ Facebook, show ảnh cháu, FaceTime
- Dùng iMessage / SMS nhiều hơn bất kỳ app chat nào
- Y tế: copay, deductible, in-network, insurance card trên app

❌ TUYỆT ĐỐI KHÔNG XUẤT HIỆN:
- Zalo, VTV, xe máy, chợ, quán phở, Grab, MoMo, Shopee
- "Link ở bio", "Tải ngay" — quá đặc thù VN
- Bệnh viện công đông đúc kiểu châu Á
- Xưng hô VN: bố/mẹ/con, anh/chị/em
- Tiền VNĐ, metric (dùng miles, °F, pounds, inches)

═══════════════════════════════════════
RULE #5: FORMAT "SCRIPT" — KỊCH BẢN KỂ CHUYỆN
═══════════════════════════════════════
⚠️ KHÔNG viết tách rời Visual / Text / Voice thành 3 field riêng biệt.
⚠️ KHÔNG viết 3 options cho text (Op1/Op2/Op3). CHỈ 1 TEXT DUY NHẤT.

Mỗi section (hook, body, cta) dùng field "script" = MỘT KỊCH BẢN LIỀN MẠCH.
Viết như một đạo diễn ghi chú cho quay phim. Trong đó PHẢI GỘP:
→ Ai đang làm gì, biểu cảm gì, ở đâu, mặc gì (visual)
→ Ai nói gì, giọng điệu nào, cảm xúc gì (voice) — dùng tag [VOICE — Ai, giọng gì]
→ Text overlay hiện gì, hiện lúc nào — dùng tag [TEXT OVERLAY]
→ Âm thanh/tiếng động — dùng tag [SFX]

VÍ DỤ SCRIPT HOOK CHUẨN (Hãy viết giống y thế này):
---
"POV shot from a woman's eyes (late 50s). She's standing in a dark living room, only the dim glow of a Roku TV illuminating her face. Her hands (trembling, wedding ring visible) grip an iPhone 14. The screen shows her Ring app frozen solid — spinning wheel, no response.

[SFX] A loud CRACK of a branch snapping outside, near the back patio door.
She gasps, breath quickening.

[VOICE — Woman, whispered, terrified]: 'Oh my god... come on... COME ON!'
She frantically taps the screen. Nothing happens.

[TEXT OVERLAY] 'It always fails when you need it most.'"
---

VÍ DỤ SCRIPT BODY CHUẨN:
---
"Cut to screen recording on iPhone. User opens Phone Cleaner app. Scan animation runs, stops and highlights: 'Data Decay Detected: 7.2 GB of Corrupted Files'.

[VOICE — Narrator, calm authority]: 'This app performs an instant emergency cleanup. It clears out corrupted data and makes your phone responsive again in seconds.'

User taps 'REPAIR & CLEAN'. Satisfying cleanup animation runs.
[TEXT OVERLAY] '7.2 GB of Corrupted Files REMOVED'"
---

═══════════════════════════════════════
⚠️ VÍ DỤ HOOK THỰC TẾ TỪ PRODUCTION (MỨC ĐỘ CHI TIẾT PHẢI ĐẠT)
═══════════════════════════════════════
Đây là ví dụ hook thực tế từ team sáng tạo. Output CỦA BẠN phải chi tiết BẰNG hoặc HƠN mức này:

🏥 VÍ DỤ 1 — App dọn dẹp điện thoại (Hook bệnh viện):
---
"Bối cảnh trong phòng bệnh, bệnh nhân nam nằm trên giường máy hô hấp dây dợ nhằng nhịt kiểu lâm sao để cấm thấy bệnh rất nặng nhé, máy đo nhịp tim kêu tít tít tít rồi như kiểu sắp ngừng tim tôi nói. Bên cạnh là bà sĩ muốn xem hồ sơ bệnh nhưng app không cập nhật nên không xem được và người nhà tuổi 45+ đứng bên cạnh tay cầm điện thoại mặt lo lắng, sợ hãi, run rẩy nói 'Doctor, I'm freaking out! Zero space, My MyChart won't update to show my records!'. Bác sĩ ấn ấn trán nói 'Don't panic. It's just storage junk. Let's clear it in 3 seconds.'
- 2 option khung cảnh bệnh viện, bác sĩ, người già khác nhau
- Body điện thoại mới
- Cho nhạc nền kiểu kịch tính, drama chứ nhé"
---

✈️ VÍ DỤ 2 — App dọn dẹp điện thoại (Hook sân bay):
---
"Bối cảnh ở sân bay góc quay focus vào người già và nhân viên an ninh sân bay. Người già mặc trang phục kiểu thoải mái du lịch, kéo vali, tay cầm iPhone mặt rất lo lắng. Phía sau lưng là hàng người đứng đài ào xôn xao, có tiếng hô vọng từi giục giã 'Hurry up'. Người già mặt rất lo lắng nói 'Please help! My storage is full and the Passport app refuses to update my info!'. Nhân viên an ninh sân bay nói 'Don't panic. It's just hidden trash. Watch me wipe it in 3 seconds.'
- 3 option đ/cảnh sân bay khác nhau và người già khác nhau
+ FLL (Fort Lauderdale-Hollywood International Airport)
+ MCO (Orlando International Airport)
+ RSW (Southwest Florida International Airport - Fort Myers)"
---

📱 VÍ DỤ 3 — App dọn dẹp điện thoại (Hook T-Mobile store):
---
"Bối cảnh tại store bán điện thoại: 3 option apple, best buy, T-Mobile. 1 người đang giả thể ngân hàng đính thanh toán với nhân viên bán hàng và nói vội giọng phẫn nạn, bực bội: 'This phone is so laggy it's useless. Sell me a new one NOW!'. Người bán hàng đang đính cấm thể ngân hàng thị có người đi tới túc giận đập vai người mua hoặc bàn ghế gì đó cho cảo trao cảm xúc nhé, người nây nói: 'Are you crazy? Stop wasting a grand on a new iPhone! Fixing it is super easy. Look here.'
- Đa dạng góc quay CCTV/ góc quay khác nhau, người mua và người khuyến có thể là nam/ nữ trung niên, già hàn đa dạng trong các option lên nhé
- Cảm xúc 2 người nói chuyện cho cao trào thể hiện nhiều lên như ý idea CCTV ngày trước ngon tốt"
---

📌 RÚT RA TỪ CÁC VÍ DỤ TRÊN — BẮT BUỘC ÁP DỤNG:
1. BỐI CẢNH CỤ THỂ: Không chỉ "bệnh viện" → phải mô tả máy hô hấp, dây dợ, máy đo nhịp tim tít tít
2. ĐỊA ĐIỂM TÊN THẬT: Fort Lauderdale (FLL), Orlando (MCO), T-Mobile, Best Buy, Apple Store
3. NHIỀU OPTIONS: Mỗi hook gợi ý 2-3 biến thể bối cảnh (khác người, khác địa điểm, khác góc quay)
4. CẢM XÚC CAO TRÀO: Nhân vật phải bực bội, sợ hãi, giận dữ, run rẩy — không nhạt
5. VOICE CỤ THỂ: Viết đúng câu nói, đúng giọng, đúng cảm xúc (không generic)
6. GHI CHÚ PRODUCTION: "cho nhạc nền kịch tính", "góc quay CCTV", "drama chứ nhé"

❌ TUYỆT ĐỐI KHÔNG VIẾT:
- "Người dùng lo lắng nhìn điện thoại" → QUÁ CHUNG CHUNG, không chi tiết
- "Cảnh quay cinematic..." → TVC
- "Op1: xxx Op2: yyy Op3: zzz" → KHÔNG, chỉ 1 text overlay
- "Home Security app" generic → Phải dùng tên app thật (Ring, SimpliSafe...)
- "Bệnh viện" một mình → phải mô tả MÁY MÓC, TIẾNG, KHÔNG KHÍ
- "Sân bay" một mình → phải ghi rõ TÊN SÂN BAY (FLL, LAX, JFK, MCO...)
- "Cửa hàng điện thoại" → phải ghi T-Mobile, Best Buy, Apple Store...

✅ PHẢI ĐẠT ĐƯỢC:
- Đọc xong phải THẤY ĐƯỢC cảnh quay trong đầu — từng chi tiết nhỏ
- Chi tiết 100% chuẩn US: đồ vật, app, bối cảnh, cách nói, TÊN ĐỊA ĐIỂM THẬT
- Biết AI NÓI GÌ, giọng điệu NÀO, cảm xúc GÌ
- Painpoint ĐÁNH THẲNG vào tâm lý — không trừu tượng
- Text overlay = 1 câu duy nhất
- Mỗi hook GỢI Ý 2-3 biến thể bối cảnh/địa điểm (ghi trong script)
- Ghi chú production: nhạc, SFX, góc quay đặc biệt

═══════════════════════════════════════
CẤU TRÚC VIDEO ${duration}
═══════════════════════════════════════
🎣 HOOK (3-5s): script kịch bản → TẠO ĐÚNG EMOTION MỤC TIÊU từ PAINPOINT
📖 BODY (10-25s): script kịch bản → DEMO PSP giải quyết Painpoint
🔥 CTA (3-5s): script kịch bản → KÊU GỌI HÀNH ĐỘNG

═══════════════════════════════════════
⚠️ RULE ĐẶC BIỆT: HOOK PHẢI CÓ PHÂN TÍCH SÂU
═══════════════════════════════════════
Hook KHÔNG CHỈ là script mô tả cảnh quay.
Mỗi hook PHẢI KÈM PHÂN TÍCH chi tiết:
- "viewerProfile": Ai đang xem? (tuổi, giới, hành vi, bối cảnh sống — CỤ THỂ)
- "viewerEmotion": NGƯỜI XEM cảm nhận gì khi xem hook? Mô tả CHI TIẾT hành trình cảm xúc, không chỉ ghi "Sợ hãi" mà phải mô tả: "Người xem 50+ tuổi sẽ lập tức liên tưởng đến chính mình — 'Trời ơi, điện thoại mình cũng hay bị treo, nếu xảy ra lúc đó thì sao?'. Cảm giác bất lực và sợ hãi lan tỏa."
- "painpointImpact": Painpoint ĐÁNH VÀO tâm lý người xem NHƯ THẾ NÀO? Mô tả CỤ THỂ: "Cha mẹ 50+ tuổi sẽ nhận ra mình cũng hay screenshot vô tội vạ nhưng không bao giờ xóa. Con cái chỉ ra điều này khiến họ vừa xấu hổ vừa lo lắng."
- "whyTheyStopScrolling": Tại sao người xem DỪNG SCROLL ở hook này? 1 câu cụ thể.

═══════════════════════════════════════
⚠️ RULE NGÔN NGỮ: PHẢI CÓ BẢN DỊCH TIẾNG VIỆT
═══════════════════════════════════════
Voice/text overlay viết bằng ${targetLang} (ngôn ngữ target).
NHƯNG BẮT BUỘC kèm bản dịch tiếng Việt ("viTranslation") cho MỌI script.
→ Team VN đọc hiểu nhanh, không cần tra từ điển.

═══════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════
Trả về ĐÚNG ${quantity} objects trong JSON ARRAY.
KHÔNG markdown. KHÔNG giải thích thêm.
Framework/explanation/phân tích = TIẾNG VIỆT. Script voice/text = ${targetLang}.

[{
  "id": 1,
  "title": "Tên concept ngắn tiếng Việt (VD: 'POV - Camera an ninh bị treo')",
  "duration": "${duration}",
  "creativeType": "UGC / POV / Interview / Breaking News / ...",
  "framework": {
    "coreUser": "Chân dung user CỤ THỂ: tuổi, giới, hành vi, bối cảnh (tiếng Việt, 2-3 câu)",
    "painpoint": "Nỗi đau CỤ THỂ, mô tả tình huống thực tế, không trừu tượng (tiếng Việt, 2-3 câu)",
    "emotion": "Cảm xúc hook TẠO RA CHO NGƯỜI XEM (không phải nhân vật) — mô tả CHI TIẾT hành trình cảm xúc (tiếng Việt, 2-3 câu)",
    "psp": "Tính năng app giải quyết painpoint + cách demo (tiếng Việt)"
  },
  "explanation": "Tại sao idea này hiệu quả + lấy cảm hứng từ đâu (tiếng Việt, 3-5 câu)",
  "hook": {
    "script": "KỊCH BẢN LIỀN MẠCH hook 3-5s bằng tiếng Việt (mô tả visual + [VOICE bằng ${targetLang}] + [TEXT OVERLAY bằng ${targetLang}] + [SFX]). CHI TIẾT.",
    "textOverlay": "1 câu text overlay bằng ${targetLang}",
    "viTranslation": "Bản dịch TIẾNG VIỆT của toàn bộ voice + text overlay trong hook",
    "viewerProfile": "Ai đang xem hook này? Mô tả CỤ THỂ chân dung người xem target (tiếng Việt, 2 câu)",
    "viewerEmotion": "Người xem CẢM NHẬN gì khi xem hook? Mô tả CHI TIẾT hành trình cảm xúc — họ nghĩ gì, liên tưởng gì, lo sợ gì (tiếng Việt, 2-3 câu)",
    "painpointImpact": "Painpoint ĐÁNH VÀO tâm lý người xem NHƯ THẾ NÀO? Họ tự thấy mình trong tình huống nào? (tiếng Việt, 2-3 câu)",
    "whyTheyStopScrolling": "Tại sao người xem DỪNG SCROLL? 1 câu cụ thể (tiếng Việt)"
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

    console.log('[generate-ideas] Prompt length:', prompt.length, 'chars');
    const text = await askAI(prompt, { 
      model: 'gemini/gemini-2.5-pro', 
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
