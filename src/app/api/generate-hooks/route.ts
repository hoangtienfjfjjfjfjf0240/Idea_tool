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

// Map frontend model names to gateway model identifiers
function resolveModel(selected?: string): string {
  const map: Record<string, string> = {
    'gemini-2.5-pro': 'gemini/gemini-2.5-pro',
    'gpt-4.1': 'openai/gpt-4.1',
    'o4-mini': 'openai/o4-mini',
  };
  return map[selected || ''] || 'gemini/gemini-2.5-pro';
}

export async function POST(request: NextRequest) {
  try {
    const { hook, instruction, quantity = 3, appName, appCategory, selectedModel } = await request.json();

    const prompt = `[ROLE] Senior Creative Strategist chuyên Meta/TikTok Performance Ads.
Bạn đang MODIFY một Winning Hook — tạo ${quantity} biến thể MỚI.

═══════════════════════════════════════
HOOK GỐC (WINNING — ĐÃ CHẠY TỐT)
═══════════════════════════════════════
📌 Tên: "${hook.title}"
📝 Mô tả: ${hook.description || 'N/A'}
🧠 Concept: ${hook.hook_concept || 'N/A'}
🎬 Creative Type: ${hook.creative_type || hook.subtitle || 'N/A'}
👁️ Visual gốc: ${hook.visual_detail || 'N/A'}
👤 Core User: ${hook.core_user || 'N/A'}
💔 Painpoint: ${hook.painpoint || 'N/A'}
😱 Emotion: ${hook.emotion || 'N/A'}
📱 App: "${appName}" (${appCategory || 'General'})

═══════════════════════════════════════
CHỈ THỊ MODIFY TỪ USER
═══════════════════════════════════════
"${instruction}"

═══════════════════════════════════════
NGUYÊN TẮC MODIFY — CHỈ ĐỔI VISUAL HOOK, GIỮ DNA GỐC
═══════════════════════════════════════
Bạn đang lấy 1 hook gốc đã chạy tốt → tạo ${quantity} CÁCH QUAY VISUAL KHÁC NHAU cho cùng hook concept đó.

⚠️ KHÔNG ĐỔI: Concept hook, painpoint, emotion, core user (trừ khi user yêu cầu).
⚠️ CHỈ ĐỔI: VISUAL — cách quay, bối cảnh, địa điểm, nhân vật cụ thể, góc camera, trang phục, ánh sáng.

📌 VISUAL GỐC ĐỂ THAM CHIẾU:
"${hook.visual_detail || hook.description || 'Xem concept hook gốc ở trên'}"
→ Mỗi biến thể PHẢI KHÁC visual gốc — khác cách quay, khác bối cảnh, khác người — nhưng VẪN kể cùng câu chuyện hook.

═══════════════════════════════════════
🎬 VISUAL VARIATION MATRIX — MỖI BIẾN THỂ PHẢI KHÁC VISUAL GỐC VỀ:
═══════════════════════════════════════
Mỗi biến thể PHẢI khác visual gốc + khác các biến thể khác TỐI THIỂU 3/5 yếu tố:
① ĐỊA ĐIỂM: Hoàn toàn khác (VD: gốc ở kitchen → biến thể ở Walmart, backyard, doctor's office)
② NHÂN VẬT: Khác giới/tuổi/vai trò nhưng VẪN trong core user (VD: gốc bà 60 → biến thể ông 65, couple 50s)
③ GÓC QUAY/STYLE: Khác format (VD: gốc UGC selfie → biến thể POV, CCTV, screen recording, green screen)
④ TÌNH HUỐNG: Cùng painpoint nhưng KHÁC kịch bản (VD: gốc phone lag lúc gọi → biến thể phone lag lúc thanh toán)
⑤ GIỌNG/MOOD: Khác cảm giác (VD: gốc drama sợ hãi → biến thể sarcastic, hài hước nhẹ, urgent)

❌ TUYỆT ĐỐI KHÔNG: 
- Tất cả biến thể cùng địa điểm, cùng người, chỉ đổi vài từ voice
- Copy y visual gốc rồi thay tên
- Tất cả biến thể đều UGC selfie (phải đa dạng style quay)

✅ PHẢI LÀ: Mỗi biến thể = 1 CÁCH QUAY HOÀN TOÀN KHÁC — cùng hook concept nhưng team editor có THỂ QUAY NHIỀU VIDEO KHÁC NHAU.

VÍ DỤ — Hook gốc: "Bà 60 tuổi ở bệnh viện, phone lag, bác sĩ không xem được hồ sơ":
- Biến thể 1: Ông 65 tuổi ở sân bay MCO, boarding pass app crash, nhân viên gate đang đóng cửa → POV shot
- Biến thể 2: Bà 58 tuổi ở Walmart self-checkout, Apple Pay freeze, hàng dài sau lưng → góc CCTV
- Biến thể 3: Couple 50s ở nhà, đang FaceTime cháu nội lần đầu, phone đơ giữa chừng → selfie UGC
→ TẤT CẢ đều cùng painpoint "phone lag lúc quan trọng" nhưng VISUAL HOÀN TOÀN KHÁC.

═══════════════════════════════════════
🔺 TAM GIÁC BẮT BUỘC: CORE USER × PAINPOINT × EMOTION
═══════════════════════════════════════
1. NHÂN VẬT = CORE USER: Nhân vật PHẢI KHỚP với Core User của hook gốc (${hook.core_user || 'theo hook gốc'}).
2. PAINPOINT: Giữ nguyên painpoint gốc (${hook.painpoint || 'theo hook gốc'}) — chỉ thay đổi TÌNH HUỐNG.
3. EMOTION: Giữ đúng emotion gốc (${hook.emotion || 'theo hook gốc'}) — visual mới vẫn phải trigger cùng emotion.
→ Hook KHÔNG giới thiệu app. App chỉ xuất hiện ở Body/CTA.



═══════════════════════════════════════
⚠️ RULE VĂN HÓA & HÀNH VI (CỰC KỲ QUAN TRỌNG)
═══════════════════════════════════════
Thị trường mục tiêu: US (Mỹ). MỌI chi tiết trong script PHẢI chuẩn xác về:


🏠 BỐI CẢNH ĐỜI THƯỜNG MỸ:
- Nhà: suburban house, apartment, kitchen with granite counter, living room with sectional sofa, backyard/patio/deck
- Xe: minivan, SUV, sedan, xe park ở garage/driveway/parking lot
- Nơi công cộng: Walmart, Target, CVS, Starbucks, gas station, doctor's office waiting room
- Sự kiện: Thanksgiving dinner, kids' soccer practice, Sunday brunch, road trip, BBQ

📱 CÔNG NGHỆ & APP CỦA MỸ:
- iPhone hoặc Samsung Galaxy (KHÔNG Xiaomi, Oppo, Vivo)
- Siri, Google Assistant (KHÔNG Zalo, WeChat, Bkav)
- Ring doorbell, SimpliSafe, ADT camera (KHÔNG generic "Home Security")
- Venmo, Apple Pay, Cash App, banking apps (Chase, BoA, Wells Fargo)
- Health insurance: MyChart, Blue Cross, UnitedHealthcare app
- ParkMobile, SpotHero, PayByPhone (KHÔNG "ParkingPay" generic)
- Facebook, Instagram, TikTok, YouTube, Snapchat

👥 HÀNH VI & QUAN HỆ MỸ:
- Gọi "Dad/Mom", "honey", "babe" (KHÔNG "bố/mẹ")  
- Tiếng lóng: "dude", "literally", "I can't even", "no way", "oh my god"
- Cha mẹ 50-65 tuổi ở Mỹ: thường dùng iPad/iPhone, hay forward email chain, save memes, screenshot recipes từ Facebook
- Đặc trưng: show ảnh cháu cho bạn, FaceTime với con, dùng text message (iMessage) nhiều hơn bất kỳ app chat nào
- Parking: meter, parking garage, parallel parking, valet
- Y tế: copay, deductible, in-network, out-of-pocket, insurance card trên app

🍔 ĐỜI SỐNG THƯỜNG NGÀY:
- Sáng: coffee from Keurig/Starbucks, drive thru
- Trưa: lunch break, leftovers, meal prep container
- Tối: Netflix, Amazon Prime, Hulu, Roku TV
- Weekend: yard work, Home Depot/Lowe's, kids' activities, church, brunch
- Tiền: credit score, tax return, Student loans, 401k

❌ KHÔNG BAO GIỜ XUẤT HIỆN:
- Zalo, VTV, xe máy/Honda Lead, chợ, quán phở, Grab, MoMo, Shopee
- "Tải ngay", "link ở bio" (nghe quá VN)
- Bệnh viện công, phòng khám đông đúc kiểu châu Á
- Xưng hô kiểu VN: bố/mẹ/con, anh/chị/em
- Tiền VNĐ, đơn vị đo lường metric (dùng miles, Fahrenheit, pounds)

═══════════════════════════════════════
FORMAT "SCRIPT" — KỊCH BẢN KỂ CHUYỆN
═══════════════════════════════════════
⚠️ KHÔNG viết tách rời Visual / Text / Voice.
⚠️ KHÔNG viết 3 options cho text overlay. CHỈ 1 TEXT DUY NHẤT.

"script" = MỘT KỊCH BẢN LIỀN MẠCH cho 3-5 giây hook đầu tiên.
Viết như đạo diễn ghi chú cho quay phim. PHẢI GỘP:
→ Ai đang làm gì, biểu cảm gì — CHI TIẾT (visual)
→ Ai nói gì, giọng điệu/cảm xúc nào (voice) — tag [VOICE — Ai, giọng gì]
→ Text overlay hiện lên khi nào — tag [TEXT OVERLAY]
→ Âm thanh/tiếng động — tag [SFX]

VÍ DỤ SCRIPT CHUẨN (Hãy viết y như này):
---
"POV shot from a woman's eyes (late 50s). She's standing in a dark living room, only the dim glow of a Roku TV illuminating her face. Her hands (trembling, wedding ring visible) are gripping an iPhone 14. The screen shows the Ring app frozen solid — the spinning wheel won't stop.

[SFX] A loud CRACK of a branch snapping outside, near the back patio.
She gasps, her breath quickens.

[VOICE — Woman, whispered, terrified]: 'Oh my god... come on... COME ON!'
She frantically taps the screen. Nothing responds.

[TEXT OVERLAY] 'It always fails when you need it most.'"
---

VÍ DỤ 2 (UGC style):
---
"Selfie-style UGC. A daughter (mid 20s, messy bun, oversized hoodie) sitting next to her dad (early 60s, reading glasses pushed up on forehead, reclined on a worn La-Z-Boy). She looks exasperated. He's got his arms crossed, defensive.

[VOICE — Daughter, deadpan]: 'Dad, I'm literally trying to save your phone. It says storage full.'
[VOICE — Dad, stubborn]: 'It is NOT full! I delete my pictures every week!'
[VOICE — Daughter, sighing]: 'Okay then what are these... 2,849 screenshots of the Weather Channel app?'

She holds up his phone to the camera.
[TEXT OVERLAY] 'My dad, the digital hoarder.'"
---

❌ TUYỆT ĐỐI KHÔNG VIẾT KIỂU NÀY:
- "Người dùng lo lắng nhìn điện thoại" → QUÁ CHUNG CHUNG, không chi tiết
- "Cảnh quay cinematic...", "Diễn viên trong trang phục..." → TVC
- "Op1: xxx Op2: xxx Op3: xxx" → KHÔNG, chỉ 1 text overlay
- "Home Security app" generic → Phải dùng tên app thật: Ring, SimpliSafe, ADT
- "Bệnh viện" một mình → phải mô tả MÁY MÓC, TIẾNG, KHÔNG KHÍ cụ thể
- "Sân bay" một mình → phải ghi rõ TÊN SÂN BAY (FLL, LAX, JFK, MCO...)
- "Cửa hàng điện thoại" → T-Mobile, Best Buy, Apple Store cụ thể

📌 CHUẨN CHI TIẾT BẮT BUỘC (HỌC TỪ PRODUCTION THẬT):
1. BỐI CẢNH: Không chỉ "bệnh viện" → mô tả máy hô hấp, dây dợ, máy đo nhịp tim tít tít, ánh đèn neon
2. ĐỊA ĐIỂM: Fort Lauderdale (FLL), Orlando (MCO), T-Mobile, Best Buy, Walmart, CVS cụ thể
3. NHIỀU OPTIONS: Gợi ý 2-3 biến thể bối cảnh (khác người, khác địa điểm, khác góc quay)
4. CẢM XÚC CAO TRÀO: Nhân vật phải bực bội, sợ hãi, giận dữ, run rẩy — không nhạt
5. VOICE: Viết đúng câu nói cụ thể, đúng giọng, đúng cảm xúc
6. GHI CHÚ PRODUCTION: "nhạc kịch tính", "góc quay CCTV", "drama"

✅ PHẢI ĐẠT ĐƯỢC:
- Đọc xong phải THẤY ĐƯỢC cảnh quay trong đầu — từng chi tiết nhỏ
- Chi tiết 100% chuẩn US: đồ vật, app, bối cảnh, cách nói, TÊN ĐỊA ĐIỂM THẬT
- Biết AI NÓI GÌ, giọng điệu NÀO, cảm xúc GÌ
- Painpoint ĐÁNH THẲNG vào tâm lý — không trừu tượng
- Text overlay = 1 câu duy nhất, bold, giật gân
- Mỗi hook gợi ý 2-3 biến thể bối cảnh/địa điểm
- Ghi chú production: nhạc, SFX, góc quay
═══════════════════════════════════════
⚠️ RULE NGÔN NGỮ: PHẢI CÓ BẢN DỊCH TIẾNG VIỆT
═══════════════════════════════════════
Voice/text overlay viết bằng TIẾNG ANH chuẩn Mỹ.
NHƯNG BẮT BUỘC kèm bản dịch tiếng Việt ("viTranslation").

═══════════════════════════════════════
OUTPUT: JSON ARRAY, KHÔNG markdown — MỖI BIẾN THỂ = 1 VISUAL HOOK MỚI
═══════════════════════════════════════
[{
  "id": 1,
  "title": "Tên biến thể (tiếng Việt, ghi rõ VISUAL khác gì gốc: VD 'CCTV ở Walmart' hoặc 'POV sân bay MCO')",
  "explanation": "So sánh visual gốc vs visual mới: khác gì về địa điểm, người, góc quay, mood? Tại sao cách quay mới hiệu quả? (tiếng Việt, 3-5 câu)",
  "hook": {
    "script": "KỊCH BẢN LIỀN MẠCH hook 3-5s — mô tả CHI TIẾT: Ở ĐÂU (địa điểm cụ thể), AI (nhân vật cụ thể, tuổi, mặc gì), ĐANG LÀM GÌ (hành động), GÓC QUAY (POV/UGC/CCTV...) + [VOICE bằng English] + [TEXT OVERLAY bằng English] + [SFX]. PHẢI KHÁC visual gốc.",
    "textOverlay": "1 câu text overlay bằng tiếng Anh",
    "viTranslation": "Bản dịch TIẾNG VIỆT của voice + text overlay",
    "visualDiff": "KHÁC GỐC: gốc [mô tả ngắn visual gốc] → biến thể này [mô tả visual mới]. Khác về: [liệt kê: địa điểm/người/góc quay/...]",
    "viewerEmotion": "Người xem CẢM NHẬN gì khi xem hook visual mới này? (tiếng Việt, 2-3 câu)",
    "painpointImpact": "Painpoint thể hiện qua visual mới NHƯ THẾ NÀO? Nhân vật ĐANG làm gì thể hiện painpoint? (tiếng Việt, 2-3 câu)",
    "whyTheyStopScrolling": "Tại sao người xem DỪNG SCROLL ở visual mới này? 1 câu (tiếng Việt)"
  }
}]`;

    const text = await askAI(prompt, { 
      model: resolveModel(selectedModel), 
      temperature: 0.8, 
      max_tokens: 16384,
      useCreativePersona: false 
    });
    if (!text) return NextResponse.json({ error: 'No AI response' }, { status: 500 });

    const parsed = parseJson(text);
    if (!parsed) return NextResponse.json({ error: 'Failed to parse' }, { status: 500 });

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = arr.slice(0, quantity).map((item: any, i: number) => ({
      id: `hook-${Date.now()}-${i}`,
      title: item.title || `Biến thể ${i + 1}`,
      explanation: item.explanation || '',
      hook: {
        // New merged format
        script: item.hook?.script || '',
        textOverlay: item.hook?.textOverlay || item.hook?.text_overlay || '',
        // Legacy compat — map from new format
        visual: item.hook?.script || item.hook?.visual || '',
        text: item.hook?.textOverlay || item.hook?.text_overlay || item.hook?.text || '',
        voice: '',
      },
    }));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
