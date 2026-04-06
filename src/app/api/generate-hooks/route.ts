import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';

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

export async function POST(request: NextRequest) {
  try {
    const { hook, instruction, quantity = 3, appName, appCategory } = await request.json();

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
NGUYÊN TẮC MODIFY
═══════════════════════════════════════
1. GIỮ DNA HOOK GỐC: Core User, Painpoint, Emotion, Creative Type (trừ khi user yêu cầu đổi).
2. THAY ĐỔI THEO CHỈ THỊ: Đổi bối cảnh, người, góc quay, trang phục, voice script.
3. Mỗi biến thể PHẢI KHÁC NHAU về bối cảnh/người/câu chuyện.

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

✅ PHẢI ĐẠT ĐƯỢC:
- Đọc xong phải THẤY ĐƯỢC cảnh quay trong đầu
- Chi tiết phải 100% chuẩn US: đồ vật, app, bối cảnh, cách nói
- Biết AI NÓI GÌ, giọng điệu NÀO, cảm xúc GÌ
- Painpoint ĐÁNH THẲNG vào tâm lý — không trừu tượng
- Text overlay = 1 câu duy nhất, bold, giật gân
═══════════════════════════════════════
⚠️ RULE NGÔN NGỮ: PHẢI CÓ BẢN DỊCH TIẾNG VIỆT
═══════════════════════════════════════
Voice/text overlay viết bằng TIẾNG ANH chuẩn Mỹ.
NHƯNG BẮT BUỘC kèm bản dịch tiếng Việt ("viTranslation").

═══════════════════════════════════════
OUTPUT: JSON ARRAY, KHÔNG markdown
═══════════════════════════════════════
[{
  "id": 1,
  "title": "Tên biến thể (tiếng Việt, ghi rõ khác gì gốc)",
  "explanation": "Tại sao biến thể này hiệu quả + khác gì hook gốc (tiếng Việt, 3-5 câu)",
  "hook": {
    "script": "KỊCH BẢN LIỀN MẠCH bằng tiếng Việt mô tả cảnh + [VOICE bằng English] + [TEXT OVERLAY bằng English] + [SFX]. CHI TIẾT.",
    "textOverlay": "1 câu text overlay bằng tiếng Anh",
    "viTranslation": "Bản dịch TIẾNG VIỆT của voice + text overlay",
    "viewerEmotion": "Người xem CẢM NHẬN gì khi xem hook? Họ nghĩ gì, liên tưởng gì? (tiếng Việt, 2-3 câu)",
    "painpointImpact": "Painpoint ĐÁNH VÀO tâm lý người xem NHƯ THẾ NÀO? (tiếng Việt, 2-3 câu)",
    "whyTheyStopScrolling": "Tại sao người xem DỪNG SCROLL? 1 câu (tiếng Việt)"
  }
}]`;

    const text = await askAI(prompt, { 
      model: 'gemini/gemini-2.5-pro', 
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
