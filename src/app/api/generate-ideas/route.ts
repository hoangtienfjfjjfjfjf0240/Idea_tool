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
    const { appName, appCategory, filters, config, previousIdeas, appKnowledge } = await request.json();
    const featureContext = filters?.solution?.length ? filters.solution.join(', ') : "General App Features";
    const quantity = config?.quantity || 3;
    const duration = config?.duration || '30s';

    const knowledgeBlock = appKnowledge
      ? `\n[APP BRAIN - Kiến thức AI đã tích lũy cho app này. ĐÂY LÀ NGUỒN THAM KHẢO QUAN TRỌNG NHẤT.]\n${appKnowledge}\n`
      : '';

    const ideasBlock = previousIdeas 
      ? `\n[IDEAS GẦN ĐÂY - Tham khảo phong cách & cách triển khai, học hỏi và nâng cấp]\n${previousIdeas}\n`
      : '';

    const prompt = `[ROLE] Senior Creative Strategist chuyên Meta Video Ads cho Mobile App.
${knowledgeBlock}
[INPUT DATA]
App: "${appName}", Category: "${appCategory || 'General'}"
Tính năng/Giải pháp (PSP): "${featureContext}"
Context bổ sung: "${config?.ideaDescription || "Creative Freedom"}"
Đối tượng (Core User): ${filters?.coreUser?.join(', ') || "General"}
Nỗi đau (Painpoint): ${filters?.painPoint?.join(', ') || "General"}
Cảm xúc (Emotion): ${filters?.emotion?.join(', ') || "General"}
Cấu trúc: ${filters?.videoStructure?.join(', ') || "Cơ bản"}
Số lượng: ${quantity}
${ideasBlock}

[META VIDEO CREATIVE FRAMEWORK]
Mỗi idea phải xây dựng từ 4 yếu tố nền tảng:
1. CORE USER — Chân dung cụ thể: ai xem? (tuổi, giới tính, hành vi)
2. PAINPOINT — Nỗi đau / nhu cầu cụ thể của user
3. EMOTION — Cảm xúc HOOK tạo ra (sợ hãi, tò mò, FOMO, thỏa mãn, shock...)
4. PSP — Product Solution: tính năng CỤ THỂ giải quyết painpoint

[CẤU TRÚC VIDEO ${duration}]
🎣 HOOK (3-5s): Nhắm Core User → Trigger Emotion → Thể hiện Painpoint qua visual + content
📖 BODY (10-25s): PSP giải quyết Painpoint từ Hook → Demo giải pháp thực tế
🔥 CTA (3-5s): Voice kêu gọi + Text on screen + End Card

[OUTPUT FORMAT] 
Trả về ĐÚNG ${quantity} objects trong JSON ARRAY. KHÔNG có markdown, KHÔNG giải thích.
Mỗi object theo format:
[{
  "id": 1,
  "title": "Tiêu đề idea (tiếng Việt)",
  "duration": "${duration}",
  "framework": {
    "coreUser": "Mô tả chân dung user cụ thể",
    "painpoint": "Nỗi đau / nhu cầu cụ thể",
    "emotion": "Cảm xúc hook tạo ra",
    "psp": "Tính năng/giải pháp cụ thể"
  },
  "explanation": "Tại sao idea này hiệu quả (WHY IT WORKS)",
  "hook": {
    "visual": "Mô tả visual cụ thể, dễ quay",
    "content": "Text hiện trên màn hình",
    "voice": "Voice-over tiếng Việt tự nhiên"
  },
  "body": {
    "visual": "Mô tả visual demo PSP giải quyết painpoint",
    "content": "Text hiện trên màn hình",
    "voice": "Voice-over giải thích giải pháp"
  },
  "cta": {
    "voice": "Voice kêu gọi hành động",
    "text": "Text CTA trên màn hình",
    "endCard": "Nội dung end card (tên app, nút tải...)"
  }
}]`;

    const text = await askAI(prompt, { model: 'gemini/gemini-2.5-pro', temperature: 0.8 });
    if (!text) return NextResponse.json({ error: 'No AI response' }, { status: 500 });

    const parsed = parseJson(text);
    if (!parsed) return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valid = arr.filter((i: any) => i?.hook && i?.body).slice(0, quantity);

    return NextResponse.json({ success: true, data: valid });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
