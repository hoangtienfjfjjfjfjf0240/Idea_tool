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
  return map[selected || ''] || 'openai/gpt-4.1';
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
⚠️ RULE #1: EMOTION = CẢM XÚC CỦA VIEWER, KHÔNG PHẢI ACTOR
═══════════════════════════════════════
Emotion gốc: ${hook.emotion || 'theo hook gốc'}
→ Đây là emotion mà NGƯỜI ĐANG LƯỚT FEED phải CẢM NHẬN.
→ KHÔNG mô tả nhân vật "run rẩy, hoảng sợ, khóc" → đó là DIỄN XUẤT actor.
→ PHẢI thiết kế CÁCH KỂ CHUYỆN để VIEWER tự cảm nhận emotion:
  • Tò mò → curiosity gap, CẮT NGANG trước reveal
  • Sợ hãi → tình huống relatable viewer tự liên tưởng đến mình
  • FOMO → "mọi người biết trừ tôi"
  • Shock → before/after contrast mạnh

═══════════════════════════════════════
RULE #2: PAINPOINT ĐÚNG + VOICE TỰ NHIÊN
═══════════════════════════════════════
⚠️ Hook hay = PAINPOINT ĐÚNG (khớp filter đã chọn) + VOICE TỰ NHIÊN + VIEWER EMOTION đúng.

📌 PAINPOINT PHẢI ĐÚNG VỚI FILTER ĐÃ CHỌN — không thay thế bằng painpoint khác:
- Đọc painpoint từ hook gốc → modify PHẢI giữ ĐÚNG painpoint đó
- KHÔNG tự suy diễn sang vấn đề liên quan nhưng KHÁC BẢN CHẤT
- VD: Painpoint "ăn mất kiểm soát" ≠ "tốn tiền ăn ngoài", "ko biết thiết kế" ≠ "tốn tiền contractor"

📌 PAINPOINT PHẢI TỪ ĐỜI THỰC — tình huống core user THỰC SỰ gặp hàng ngày:
✅ Khoảnh khắc tự nhiên: đang scroll phone, nói chuyện, dọn nhà, nấu ăn → painpoint bật ra
❌ Setup giả tạo: cầm giấy rồi tự nói, đứng trong phòng thở dài, monologue trước camera

📌 VOICE PHẢI TỰ NHIÊN — như người thật nói:
✅ Có ngập ngừng, đứt quãng, reaction thật
❌ Concept name trong voice, quá formal, mở đầu kiểu youtuber

═══════════════════════════════════════
RULE #3: NGUYÊN TẮC MODIFY — CHỈ ĐỔI VISUAL, GIỮ DNA + CẤU TRÚC
═══════════════════════════════════════
⚠️ KHÔNG ĐỔI: Concept hook, painpoint, emotion, core user (trừ khi user yêu cầu).
⚠️ CHỈ ĐỔI: VISUAL — nhân vật, bối cảnh, tình huống, cách kể.

📐 GIỮ CẤU TRÚC TƯƠNG TÁC:
🎭 SỐ NGƯỜI: Gốc bao nhiêu → modify bấy nhiêu.
🗣️ KIỂU TƯƠNG TÁC: Gốc A nói với B → modify X nói với Y (khác người, cùng pattern).
📝 CHẤT LƯỢNG: Modify PHẢI hay bằng hoặc hơn gốc — painpoint thật, voice tự nhiên.

🎬 VISUAL VARIATION MATRIX — Mỗi biến thể khác gốc tối thiểu 3/5:
① TÌNH HUỐNG khác ② NHÂN VẬT khác ③ BỐI CẢNH khác ④ PAINPOINT ANGLE khác ⑤ MOOD khác

═══════════════════════════════════════
FORMAT SCRIPT — KỊCH BẢN HÀNH ĐỘNG LIỀN MẠCH
═══════════════════════════════════════
"script" = KỊCH BẢN STORYBOARD cho 3-5 giây hook.
Viết theo timeline: MỖI CÂU = 1 HÀNH ĐỘNG. Voice xen kẽ trong flow, KHÔNG tách riêng.
Painpoint phải HIỆN qua HÀNH ĐỘNG + LỜI NÓI TỰ NHIÊN — không setup giả tạo.

📝 Mô tả cảnh liền mạch + [VOICE tiếng Anh xen kẽ đúng lúc] + [TEXT OVERLAY tiếng Anh].
🔄 viTranslation = dịch lại sang tiếng Việt.

═══════════════════════════════════════
OUTPUT: JSON ARRAY — MỖI BIẾN THỂ = 1 VISUAL HOOK MỚI
═══════════════════════════════════════
[{
  "id": 1,
  "title": "Tên biến thể (tiếng Việt)",
  "explanation": "So sánh visual gốc vs mới + tại sao hiệu quả (tiếng Việt, 3-5 câu)",
  "hook": {
    "script": "KỊCH BẢN liền mạch: tình huống ĐỜI THƯỜNG + painpoint THẬT qua hành động + [VOICE tự nhiên như người thật nói, tiếng Anh] + [TEXT OVERLAY tiếng Anh]. KHÔNG setup giả tạo. KHÔNG copy ví dụ cũ.",
    "textOverlay": "1 câu text overlay tiếng Anh",
    "viTranslation": "Bản dịch tiếng Việt của voice + text overlay",
    "visualDiff": "KHÁC GỐC: gốc [...] → biến thể này [...]. Khác về: [liệt kê]",
    "viewerEmotion": "VIEWER cảm nhận gì? Họ tự hỏi gì? (tiếng Việt, 2-3 câu)",
    "painpointImpact": "VIEWER tự thấy mình ở đâu? (tiếng Việt, 2-3 câu)",
    "whyTheyStopScrolling": "VIEWER dừng scroll vì? 1 câu (tiếng Việt)"
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
