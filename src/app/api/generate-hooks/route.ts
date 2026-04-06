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
QUAN TRỌNG: FORMAT "SCRIPT" — KỊCH BẢN KỂ CHUYỆN
═══════════════════════════════════════
⚠️ KHÔNG viết tách rời Visual / Text / Voice như trước.
⚠️ KHÔNG viết 3 options cho text overlay. CHỈ 1 TEXT DUY NHẤT.

"script" = MỘT KỊCH BẢN LIỀN MẠCH cho 3-5 giây hook đầu tiên.
Viết như một đạo diễn ghi chú cho quay phim. Trong đó PHẢI GỘP:
→ Ai đang làm gì, biểu cảm gì (visual)
→ Ai nói gì, giọng điệu/cảm xúc nào (voice)  
→ Text overlay hiện lên khi nào (text)
→ Âm thanh/tiếng động nếu có

VÍ DỤ SCRIPT CHUẨN (Hãy viết y như này):
---
"Góc quay POV từ mắt một người phụ nữ (55-60 tuổi). Bà đang đứng trong phòng khách tối, chỉ có ánh sáng yếu ớt từ TV. Tay bà (hơi run, có đeo nhẫn cưới) đang cầm iPhone. Màn hình điện thoại đang hiển thị app 'Home Security' bị treo cứng.

[SFX] Tiếng cành cây gãy 'RẮC!' từ bên ngoài.
Bà giật mình, thở gấp.

[VOICE — Người phụ nữ, giọng thì thầm sợ hãi]: 'Oh my god... mở đi... MỞ ĐI!'
Tay bà liên tục bấm vào màn hình trong vô vọng.

[TEXT OVERLAY] 'It always fails when you need it most.'"
---

VÍ DỤ 2 (UGC style):
---
"Quay kiểu selfie UGC. Một cô con gái (25-30 tuổi) ngồi cạnh bố (55-65 tuổi, đeo kính, ngồi sofa phòng khách). Cô gái tỏ vẻ bất lực. Ông bố khoanh tay, tự ái.

[VOICE — Con gái]: 'Bố, con đang cứu điện thoại bố đấy. Nó đầy rồi!'
[VOICE — Bố, giọng quả quyết]: 'Đầy gì! Bố xóa ảnh mỗi tuần!'
[VOICE — Con gái, thở dài]: 'Okay bố, thế 2,849 cái screenshot app thời tiết này là gì?'

Cô giơ điện thoại bố về phía camera.
[TEXT OVERLAY] 'My dad, the digital hoarder.'"
---

❌ TUYỆT ĐỐI KHÔNG VIẾT KIỂU NÀY:
- "Người dùng lo lắng nhìn điện thoại" → QUÁ CHUNG CHUNG
- "Cảnh quay cinematic...", "Một diễn viên trong trang phục..." → TVC
- "Op1: xxx Op2: xxx Op3: xxx" → KHÔNG, chỉ 1 text overlay

✅ PHẢI ĐẠT ĐƯỢC:
- Đọc xong phải THẤY ĐƯỢC cảnh quay trong đầu
- Phải biết AI NÓI GÌ, giọng điệu NÀO, cảm xúc GÌ
- Painpoint phải ĐÁNH THẲNG vào tâm lý người xem, không trừu tượng
- Text overlay = 1 câu duy nhất, bold, giật gân

═══════════════════════════════════════
OUTPUT: JSON ARRAY, KHÔNG markdown
═══════════════════════════════════════
[{
  "id": 1,
  "title": "Tên biến thể (tiếng Việt, ghi rõ khác gì so với gốc)",
  "explanation": "Tại sao biến thể này hiệu quả + khác gì hook gốc (tiếng Việt)",
  "hook": {
    "script": "KỊCH BẢN LIỀN MẠCH gộp visual + voice + text. GHI RÕ [VOICE — Ai, giọng gì], [TEXT OVERLAY], [SFX]. CHI TIẾT như ví dụ trên.",
    "textOverlay": "1 câu text overlay duy nhất hiện trên màn hình (ngôn ngữ target)"
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
