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
    'gemini-2.5-flash': 'gemini/gemini-2.5-flash',
    'gemini-3-pro': 'gemini/gemini-3-pro-preview',
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
NGUYÊN TẮC MODIFY — CHỈ ĐỔI VISUAL HOOK, GIỮ DNA + CẤU TRÚC GỐC
═══════════════════════════════════════
Bạn đang lấy 1 hook gốc đã chạy tốt → tạo ${quantity} CÁCH QUAY VISUAL KHÁC NHAU cho cùng hook concept đó.

⚠️ KHÔNG ĐỔI: Concept hook, painpoint, emotion, core user (trừ khi user yêu cầu).
⚠️ CHỈ ĐỔI: VISUAL — cách quay, bối cảnh, địa điểm, nhân vật cụ thể, góc camera, trang phục, ánh sáng.

═══════════════════════════════════════
📐 GIỮ CẤU TRÚC TƯƠNG TÁC VIDEO GỐC (BẮT BUỘC)
═══════════════════════════════════════
Phân tích hook gốc và GIỮ NGUYÊN các yếu tố cấu trúc sau:

🎭 SỐ NGƯỜI: Hook gốc có bao nhiêu người → modify cũng PHẢI có bấy nhiêu người.
   → Gốc 1 người nói = modify 1 người nói (monologue)
   → Gốc 2 người tương tác = modify 2 người tương tác (dialogue)
   → Gốc nhóm/gia đình = modify nhóm/gia đình

🗣️ KIỂU TƯƠNG TÁC: Giữ nguyên cách nhân vật interact.
   → Gốc: A nói với B, B phản ứng = modify: X nói với Y, Y phản ứng (KHÁC người, CÙNG pattern)
   → Gốc: người tự nói với camera = modify: người tự nói với camera
   → Gốc: bố nói con nghe = modify: bố nói con nghe (hoặc mẹ nói con nghe)

📝 ĐỘ CHI TIẾT SCRIPT: Modify phải CHI TIẾT BẰNG hoặc HƠN hook gốc.
   → Gốc có [VOICE] 3 câu → modify cũng PHẢI có [VOICE] 3+ câu
   → Gốc có [SFX] → modify cũng PHẢI có [SFX]
   → Gốc mô tả biểu cảm chi tiết → modify cũng PHẢI mô tả biểu cảm chi tiết
   → KHÔNG ĐƯỢC rút gọn — modify PHẢI dài bằng hoặc hơn gốc

VÍ DỤ:
Hook gốc: "Bố già ở bệnh viện nói với CON GÁI: 'Con ơi, sao cái phone nó cứ...' — con gái thở dài, cầm phone bố..."
→ Modify PHẢI giữ 2 người tương tác:
   - Biến thể 1: "Ông 65 ở sân bay nói với VỢ: 'Em ơi, cái boarding pass nó... nó cứ quay quay...' — vợ vội vàng cầm phone chồng..."
   - Biến thể 2: "Bà 60 ở Walmart gọi CON TRAI: 'Con ơi, mẹ đang bị...' — tiếng con trai ở speakerphone: 'Mẹ bình tĩnh, bấm nút...'"
   ❌ SAI: Modify thành 1 người đứng một mình (mất cấu trúc 2 người)

📌 VISUAL GỐC ĐỂ THAM CHIẾU:
"${hook.visual_detail || hook.description || 'Xem concept hook gốc ở trên'}"
→ Mỗi biến thể PHẢI KHÁC visual gốc — khác cách quay, khác bối cảnh, khác người — nhưng VẪN kể cùng câu chuyện hook VÀ giữ cùng cấu trúc tương tác.

═══════════════════════════════════════
🎬 VISUAL VARIATION MATRIX — MỖI BIẾN THỂ PHẢI KHÁC VISUAL GỐC VỀ:
═══════════════════════════════════════
Mỗi biến thể PHẢI khác visual gốc + khác các biến thể khác TỐI THIỂU 3/5 yếu tố:
① ĐỊA ĐIỂM: Hoàn toàn khác (VD: gốc ở kitchen → biến thể ở Walmart, backyard, doctor's office)
② NHÂN VẬT: Khác giới/tuổi/vai trò nhưng VẪN trong core user + GIỮ SỐ NGƯỜI (VD: gốc bố+con → biến thể ông+vợ, bà+cháu)
③ GÓC QUAY/STYLE: Khác format (VD: gốc UGC selfie → biến thể POV, CCTV, screen recording, green screen)
④ TÌNH HUỐNG: Cùng painpoint nhưng KHÁC kịch bản (VD: gốc phone lag lúc gọi → biến thể phone lag lúc thanh toán)
⑤ GIỌNG/MOOD: Khác cảm giác (VD: gốc drama sợ hãi → biến thể sarcastic, hài hước nhẹ, urgent)

❌ TUYỆT ĐỐI KHÔNG: 
- Tất cả biến thể cùng địa điểm, cùng người, chỉ đổi vài từ voice
- Copy y visual gốc rồi thay tên
- Gốc 2 người → modify thành 1 người (mất cấu trúc tương tác)
- Modify ngắn hơn hook gốc (phải chi tiết bằng hoặc hơn)

✅ PHẢI LÀ: Mỗi biến thể = 1 CÁCH QUAY HOÀN TOÀN KHÁC — cùng hook concept, cùng cấu trúc tương tác, nhưng team editor có THỂ QUAY NHIỀU VIDEO KHÁC NHAU.

VÍ DỤ — Hook gốc: "Bà 60 tuổi ở bệnh viện, phone lag, bác sĩ không xem được hồ sơ" (2 người: bà + bác sĩ):
- Biến thể 1: Ông 65 ở sân bay MCO, boarding pass crash, NHÂN VIÊN gate đang đóng cửa → POV shot (2 người: ông + nhân viên)
- Biến thể 2: Bà 58 ở Walmart self-checkout, Apple Pay freeze, NHÂN VIÊN hỏi "Ma'am?" → góc CCTV (2 người: bà + nhân viên)
- Biến thể 3: Couple 50s ở nhà, FaceTime CHÁU NỘI lần đầu, phone đơ → selfie UGC (2 người: ông/bà + cháu trên màn hình)
→ TẤT CẢ giữ cấu trúc 2 người, cùng painpoint, nhưng VISUAL HOÀN TOÀN KHÁC.

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
⚠️ RULE NGÔN NGỮ — QUAN TRỌNG
═══════════════════════════════════════
📝 SCRIPT MÔ TẢ CẢNH: Viết bằng TIẾNG VIỆT — đây là brief cho team VN đọc.
🎤 [VOICE]: Câu nói nhân vật viết bằng TIẾNG ANH (vì target US)
📺 [TEXT OVERLAY]: Viết bằng TIẾNG ANH
🔄 viTranslation: Dịch lại voice + text overlay sang tiếng Việt

VÍ DỤ ĐÚNG:
"Cận cảnh bàn tay run rẩy của bà 60 tuổi, cầm iPhone 14, đang đứng ở quầy self-checkout Walmart. Phía sau là hàng người dài, có tiếng xì xào.
[SFX] Tiếng máy quét barcode bíp bíp liên tục.
Bà nhìn màn hình hoảng hốt — Apple Pay đang quay vòng vòng, không load.
[VOICE — Bà, giọng hoảng sợ, thì thầm]: 'Come on... please... everyone's waiting...'
[TEXT OVERLAY] 'When your phone fails at the worst moment.'"

❌ TUYỆT ĐỐI KHÔNG viết toàn bộ script bằng tiếng Anh — team VN không đọc hiểu được.
✅ Mô tả cảnh = tiếng Việt. Chỉ [VOICE] và [TEXT OVERLAY] = tiếng Anh.

═══════════════════════════════════════
OUTPUT: JSON ARRAY, KHÔNG markdown — MỖI BIẾN THỂ = 1 VISUAL HOOK MỚI
═══════════════════════════════════════
[{
  "id": 1,
  "title": "Tên biến thể (tiếng Việt, ghi rõ VISUAL khác gì gốc: VD 'CCTV ở Walmart' hoặc 'POV sân bay MCO')",
  "explanation": "So sánh visual gốc vs visual mới: khác gì về địa điểm, người, góc quay, mood? Tại sao cách quay mới hiệu quả? (tiếng Việt, 3-5 câu)",
  "hook": {
    "script": "KỊCH BẢN bằng TIẾNG VIỆT mô tả cảnh quay CHI TIẾT: Ở ĐÂU, AI, ĐANG LÀM GÌ, GÓC QUAY + [VOICE bằng English] + [TEXT OVERLAY bằng English] + [SFX]. Phần mô tả cảnh = tiếng Việt, chỉ voice/text = English.",
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
