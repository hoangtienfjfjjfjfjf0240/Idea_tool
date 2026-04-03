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

    const prompt = `[ROLE] Senior Creative Strategist chuyên Meta/TikTok Video Ads.
Bạn đang MODIFY một Winning Hook có sẵn — tạo ${quantity} biến thể MỚI dựa trên hook gốc.

═══════════════════════════════════════
HOOK GỐC (WINNING — ĐÃ CHẠY TỐT)
═══════════════════════════════════════
📌 Tên: "${hook.title}"
📝 Mô tả: ${hook.description || 'N/A'}
🧠 Concept/Chiến lược: ${hook.hook_concept || 'N/A'}
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
NGUYÊN TẮC MODIFY (QUAN TRỌNG)
═══════════════════════════════════════
1. GIỮ NGUYÊN DNA CỦA HOOK GỐC:
   - Giữ cùng Core User, Painpoint, Emotion
   - Giữ cùng Creative Type (trừ khi user yêu cầu đổi)
   - Giữ cùng cấu trúc kể chuyện

2. THAY ĐỔI THEO CHỈ THỊ USER:
   - Đổi bối cảnh, người, góc quay, trang phục
   - Đổi voice/text theo ngôn ngữ hoặc style mới
   - Thêm/bớt nhân vật, đổi emotion intensity

3. VISUAL PHẢI CHI TIẾT NHƯ HOOK GỐC:
   ✅ Ghi rõ: ai (tuổi/giới/trang phục), ở đâu (bối cảnh cụ thể), đang làm gì, biểu cảm, góc quay
   ✅ Mỗi biến thể PHẢI khác visual (đổi bối cảnh/người/góc quay)
   ❌ KHÔNG viết chung chung: "Người dùng lo lắng"

4. VOICE & TEXT:
   - Giữ cùng ngôn ngữ với hook gốc (trừ khi user yêu cầu đổi)
   - Text = 3 options ngắn, BOLD, giật gân
   - Voice = đối thoại 2 người hoặc người + AI assistant

═══════════════════════════════════════
OUTPUT: JSON ARRAY, KHÔNG markdown
═══════════════════════════════════════
[{
  "id": 1,
  "title": "Tên biến thể (tiếng Việt, ghi rõ khác gì so với gốc)",
  "explanation": "Tại sao biến thể này hiệu quả + khác gì hook gốc (tiếng Việt)",
  "hook": {
    "visual": "Mô tả visual CHI TIẾT: ai, ở đâu, làm gì, biểu cảm, góc quay. TIẾNG VIỆT.",
    "text": "Op1: [headline]\\nOp2: [headline]\\nOp3: [headline]",
    "voice": "Đối thoại cụ thể — ghi rõ ai nói gì"
  }
}]`;

    const text = await askAI(prompt, { 
      model: 'gemini/gemini-2.5-pro', 
      temperature: 0.8, 
      max_tokens: 12288,
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
      hook: item.hook || { visual: '', text: '', voice: '' },
    }));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
