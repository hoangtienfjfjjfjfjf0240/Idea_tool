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

// Detect language from Core User text
function detectLang(coreUsers: string[]): string {
  const joined = (coreUsers || []).join(' ').toLowerCase();
  if (joined.includes('es') || joined.includes('tây ban nha') || joined.includes('spanish')) return 'ES (Tây Ban Nha)';
  if (joined.includes('pt') || joined.includes('brazil') || joined.includes('portuguese')) return 'PT (Bồ Đào Nha)';
  if (joined.includes('jp') || joined.includes('japan') || joined.includes('nhật')) return 'JP (Nhật)';
  if (joined.includes('vn') || joined.includes('việt')) return 'VI (Việt Nam)';
  if (joined.includes('se') || joined.includes('thụy điển') || joined.includes('swedish')) return 'SE (Thụy Điển)';
  if (joined.includes('de') || joined.includes('đức') || joined.includes('german')) return 'DE (Đức)';
  if (joined.includes('fr') || joined.includes('pháp') || joined.includes('french')) return 'FR (Pháp)';
  if (joined.includes('sea') || joined.includes('thái') || joined.includes('malay') || joined.includes('indo')) return 'SEA (Đa ngôn ngữ ĐNA)';
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

❌ TUYỆT ĐỐI KHÔNG VIẾT:
- "Người dùng lo lắng nhìn điện thoại" → QUÁ CHUNG CHUNG, không chi tiết
- "Cảnh quay cinematic..." → TVC
- "Op1: xxx Op2: yyy Op3: zzz" → KHÔNG, chỉ 1 text overlay
- "Home Security app" generic → Phải dùng tên app thật (Ring, SimpliSafe...)

✅ PHẢI ĐẠT ĐƯỢC:
- Đọc xong phải THẤY ĐƯỢC cảnh quay trong đầu
- Chi tiết 100% chuẩn US: đồ vật, app, bối cảnh, cách nói
- Biết AI NÓI GÌ, giọng điệu NÀO, cảm xúc GÌ
- Painpoint ĐÁNH THẲNG vào tâm lý — không trừu tượng
- Text overlay = 1 câu duy nhất

═══════════════════════════════════════
CẤU TRÚC VIDEO ${duration}
═══════════════════════════════════════
🎣 HOOK (3-5s): script kịch bản → TẠO ĐÚNG EMOTION MỤC TIÊU từ PAINPOINT
📖 BODY (10-25s): script kịch bản → DEMO PSP giải quyết Painpoint
🔥 CTA (3-5s): script kịch bản → KÊU GỌI HÀNH ĐỘNG

═══════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════
Trả về ĐÚNG ${quantity} objects trong JSON ARRAY.
KHÔNG markdown. KHÔNG giải thích thêm.
Explanation = TIẾNG VIỆT. Script phần voice/text = ${targetLang}.

[{
  "id": 1,
  "title": "Tên concept ngắn (VD: 'POV - Camera an ninh bị treo')",
  "duration": "${duration}",
  "creativeType": "UGC / POV / Interview / Breaking News / ...",
  "framework": {
    "coreUser": "Chân dung user cụ thể (tiếng Việt)",
    "painpoint": "Nỗi đau CỤ THỂ, không trừu tượng (tiếng Việt)",
    "emotion": "Cảm xúc mà hook TẠO RA CHO NGƯỜI XEM (tiếng Việt)",
    "psp": "Tính năng giải quyết (tiếng Việt)"
  },
  "explanation": "Tại sao idea hiệu quả + concept hook lấy cảm hứng từ đâu (tiếng Việt)",
  "hook": {
    "script": "KỊCH BẢN LIỀN MẠCH hook 3-5s. GỘP visual + [VOICE] + [TEXT OVERLAY] + [SFX]. CHI TIẾT như ví dụ trên.",
    "textOverlay": "1 câu text overlay duy nhất bằng ${targetLang}"
  },
  "body": {
    "script": "KỊCH BẢN LIỀN MẠCH body 10-25s. Demo app, [VOICE] giải thích, [TEXT OVERLAY] kết quả.",
    "textOverlay": "Text kết quả/con số bằng ${targetLang}"
  },
  "cta": {
    "script": "KỊCH BẢN CTA 3-5s. [VOICE] kêu gọi, [TEXT OVERLAY] call to action.",
    "textOverlay": "CTA bold 2-5 words bằng ${targetLang}",
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
