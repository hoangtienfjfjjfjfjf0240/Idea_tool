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
    const { hook, quantity = 3, duration = '30s', appName, appCategory, ideaDirection, selectedModel } = await request.json();

    const cappedQty = Math.min(quantity, 5);

    const prompt = `[ROLE] Bạn là Senior Creative Strategist chuyên tạo Production Brief cho Meta/TikTok Video Ads.
Output PHẢI giống hệt một dòng trong Google Sheet production — team editor đọc xong có thể quay/gen ngay.

═══════════════════════════════════════
🏆 WINNING HOOK GỐC — ĐÃ CHỨNG MINH HIỆU QUẢ
═══════════════════════════════════════
📌 Tên: "${hook.title}"
📝 Mô tả: ${hook.description || 'N/A'}
🧠 Hook Concept: ${hook.hook_concept || 'N/A'}
🎬 Creative Type: ${hook.creative_type || hook.subtitle || 'N/A'}
👁️ Visual: ${hook.visual_detail || 'N/A'}
👤 Core User: ${hook.core_user || 'N/A'}
💔 Painpoint: ${hook.painpoint || 'N/A'}
😱 Emotion: ${hook.emotion || 'N/A'}
📱 App: "${appName}" (${appCategory || 'General'})

${ideaDirection ? `═══════════════════════════════════════
📝 HƯỚNG ĐI TỪ USER
═══════════════════════════════════════
"${ideaDirection}"
→ Kết hợp hướng đi này VỚI framework từ hook gốc.
→ Hướng đi user ĐƯỢC ƯU TIÊN — nhưng vẫn giữ DNA hook gốc.
` : ''}
═══════════════════════════════════════
NHIỆM VỤ: Tạo ${cappedQty} FULL IDEAS MỚI lấy cảm hứng từ hook gốc
═══════════════════════════════════════
Mỗi idea PHẢI:
- Lấy DNA + framework + pattern từ winning hook
- KHÁC gốc: tình huống, nhân vật, bối cảnh, góc tiếp cận
- Có ĐẦY ĐỦ: Hook (3-5s) + Body (10-25s) + CTA (3-5s)

═══════════════════════════════════════
RULE #1: EMOTION = CẢM XÚC CỦA VIEWER, KHÔNG PHẢI ACTOR
═══════════════════════════════════════
Emotion gốc: ${hook.emotion || 'theo hook gốc'}
→ Đây là emotion NGƯỜI ĐANG LƯỚT FEED phải CẢM NHẬN.
→ KHÔNG mô tả nhân vật "run rẩy, hoảng sợ, khóc" → đó là DIỄN XUẤT actor.

📌 CÁCH TẠO EMOTION CHO VIEWER:
🔍 TÒ MÒ → curiosity gap, CẮT NGANG trước reveal
😱 SỢ HÃI → tình huống relatable viewer tự liên tưởng
🤩 FOMO → "mọi người biết trừ mình"
🤯 SHOCK → contrast mạnh, before/after
😢 ĐỒNG CẢM → tình huống quen thuộc

═══════════════════════════════════════
RULE #2: PAINPOINT ĐÁNH ĐÚNG — KHÔNG THAY THẾ
═══════════════════════════════════════
Painpoint gốc: "${hook.painpoint || 'N/A'}"
→ PHẢI đánh ĐÚNG painpoint này. KHÔNG thay thế dù liên quan.
→ Painpoint hiện qua HÀNH ĐỘNG + LỜI NÓI TỰ NHIÊN − không setup giả tạo.

═══════════════════════════════════════
RULE #3: VOICE TỰ NHIÊN
═══════════════════════════════════════
✅ Có ngập ngừng, đứt quãng, reaction thật
❌ Không concept name, không formal, không youtuber opening

═══════════════════════════════════════
RULE #4: SCRIPT = KỊCH BẢN HÀNH ĐỘNG LIỀN MẠCH
═══════════════════════════════════════
MỖI CÂU = 1 HÀNH ĐỘNG. Voice/text xen kẽ trong flow.
[VOICE] chèn đúng lúc nhân vật nói
[TEXT OVERLAY] chèn rõ text hiện lúc nào
Painpoint = KHOẢNH KHẮC, không phải mô tả suông.

═══════════════════════════════════════
CẤU TRÚC VIDEO ${duration}
═══════════════════════════════════════
🎣 HOOK (3-5s): script → TẠO EMOTION CHO VIEWER
📖 BODY (10-25s): script → DEMO PSP giải quyết Painpoint
🔥 CTA (3-5s): script → KÊU GỌI HÀNH ĐỘNG

═══════════════════════════════════════
OUTPUT FORMAT — JSON ARRAY (GIỐNG HỆT GENERATE-IDEAS)
═══════════════════════════════════════
[{
  "id": 1,
  "title": "Tên concept ngắn tiếng Việt",
  "duration": "${duration}",
  "creativeType": "UGC / POV / Interview / Reaction / ...",
  "framework": {
    "coreUser": "Chân dung viewer TARGET (tiếng Việt, 2-3 câu)",
    "painpoint": "Nỗi đau CỤ THỂ (tiếng Việt, 2-3 câu)",
    "emotion": "Cảm xúc VIEWER khi xem hook (tiếng Việt, 2-3 câu)",
    "psp": "Tính năng app giải quyết painpoint (tiếng Việt)"
  },
  "explanation": "Tại sao idea hiệu quả + so sánh hook gốc (tiếng Việt, 3-5 câu)",
  "hook": {
    "script": "KỊCH BẢN LIỀN MẠCH 3-5s: tình huống ĐỜI THƯỜNG → painpoint → [VOICE tự nhiên] + [TEXT OVERLAY]. Tối thiểu 4-6 câu hành động.",
    "textOverlay": "1 câu text overlay",
    "viTranslation": "Bản dịch tiếng Việt",
    "viewerProfile": "VIEWER LƯỚT FEED là ai? (tiếng Việt, 2 câu)",
    "viewerEmotion": "VIEWER CẢM NHẬN GÌ? TỰ HỎI gì? (tiếng Việt, 2-3 câu)",
    "painpointImpact": "VIEWER tự thấy mình ở đâu? (tiếng Việt, 2-3 câu)",
    "whyTheyStopScrolling": "VIEWER dừng scroll vì? (tiếng Việt, 1 câu)"
  },
  "body": {
    "script": "KỊCH BẢN body 10-25s + [VOICE] + [TEXT OVERLAY]",
    "textOverlay": "Text kết quả/con số",
    "viTranslation": "Bản dịch tiếng Việt"
  },
  "cta": {
    "script": "KỊCH BẢN CTA 3-5s + [VOICE] + [TEXT OVERLAY]",
    "textOverlay": "CTA bold",
    "viTranslation": "Bản dịch tiếng Việt",
    "endCard": "${appName} + tagline"
  }
}]

Trả về ĐÚNG ${cappedQty} objects. KHÔNG markdown. KHÔNG giải thích thêm.`;

    console.log('[generate-ideas-from-hook] Prompt length:', prompt.length, 'chars, model:', selectedModel || 'gemini-2.5-pro');
    const text = await askAI(prompt, {
      model: resolveModel(selectedModel),
      temperature: 0.8,
      max_tokens: 16384,
      useCreativePersona: false,
    });

    if (!text) {
      console.error('[generate-ideas-from-hook] AI returned null');
      return NextResponse.json({ error: 'AI không phản hồi. Thử lại.' }, { status: 500 });
    }

    const parsed = parseJson(text);
    if (!parsed) {
      console.error('[generate-ideas-from-hook] Failed to parse:', text.substring(0, 300));
      return NextResponse.json({ error: 'Không parse được response.' }, { status: 500 });
    }

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = arr.filter((i: any) => i?.hook).slice(0, cappedQty);

    if (valid.length === 0) {
      return NextResponse.json({ error: 'AI trả về format sai.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: valid });
  } catch (err) {
    console.error('[generate-ideas-from-hook] Exception:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
