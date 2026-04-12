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
  return map[selected || ''] || 'gemini/gemini-2.5-pro';
}

export async function POST(request: NextRequest) {
  try {
    const { hook, quantity = 3, duration = '30s', appName, appCategory, selectedModel } = await request.json();

    const prompt = `[ROLE] Senior Creative Strategist chuyên tạo FULL Production Brief cho Meta/TikTok Video Ads.
Bạn nhận được 1 WINNING HOOK đã chạy tốt → PHÂN TÍCH sâu FRAMEWORK → Tạo ${quantity} FULL IDEAS MỚI (Hook + Body + CTA) lấy cảm hứng từ hook này.

═══════════════════════════════════════
🏆 WINNING HOOK GỐC — ĐÃ CHỨNG MINH HIỆU QUẢ
═══════════════════════════════════════
📌 Tên: "${hook.title}"
📝 Mô tả: ${hook.description || 'N/A'}
🧠 Hook Concept: ${hook.hook_concept || 'N/A'}
🎬 Creative Type: ${hook.creative_type || hook.subtitle || 'N/A'}
👁️ Visual chi tiết: ${hook.visual_detail || 'N/A'}
👤 Core User: ${hook.core_user || 'N/A'}
💔 Painpoint: ${hook.painpoint || 'N/A'}
😱 Emotion: ${hook.emotion || 'N/A'}
📱 App: "${appName}" (${appCategory || 'General'})

═══════════════════════════════════════
BƯỚC 1: PHÂN TÍCH FRAMEWORK — TẠI SAO HOOK NÀY WIN?
═══════════════════════════════════════
Trong MỖI idea output, BẮT BUỘC phải có "frameworkAnalysis":
1. "whyItWorks": Phân tích sâu 3-5 lý do TẠI SAO hook gốc hiệu quả (psychological triggers, tình huống, storytelling technique)
2. "targetAudience": Ai là viewer LÝ TƯỞNG? (chi tiết: tuổi, hành vi, bối cảnh, nhu cầu)
3. "emotionMechanism": Emotion trigger BẰNG CÁCH NÀO? (curiosity gap, social proof, shock, relatable moment...)
4. "painpointDepth": Painpoint đánh vào ĐỘ SÂU nào? (surface → deep → identity level)
5. "hookPattern": Pattern/cấu trúc hook gốc (VD: "reaction bất ngờ + reveal", "before/after tease", "người quen nói")

═══════════════════════════════════════
BƯỚC 2: TẠO ${quantity} FULL IDEAS MỚI
═══════════════════════════════════════
Mỗi idea PHẢI:
- Lấy cảm hứng từ FRAMEWORK + PATTERN của hook gốc
- KHÁC gốc về: tình huống, nhân vật, bối cảnh, góc tiếp cận
- GIỮ DNA: emotion mechanism, painpoint depth, hook pattern
- Có ĐẦY ĐỦ: Hook (3-5s) + Body (10-25s) + CTA (3-5s)
- Script viết LIỀN MẠCH như storyboard

═══════════════════════════════════════
RULES CHUNG
═══════════════════════════════════════
• EMOTION = cảm xúc VIEWER (không phải actor)
• PAINPOINT phải đúng, không thay thế
• VOICE tự nhiên, không giả tạo
• Không copy hook gốc — SÁNG TẠO MỚI dựa trên cùng framework
• Script = kịch bản hành động liền mạch + [VOICE] + [TEXT OVERLAY]
• Duration mỗi video: ${duration}

═══════════════════════════════════════
OUTPUT FORMAT — JSON ARRAY
═══════════════════════════════════════
[{
  "id": 1,
  "title": "Tên idea ngắn (tiếng Việt)",
  "duration": "${duration}",
  "creativeType": "UGC / POV / Interview / Reaction / ...",
  "frameworkAnalysis": {
    "whyItWorks": "3-5 lý do hook gốc hiệu quả (tiếng Việt, chi tiết)",
    "targetAudience": "Viewer lý tưởng: tuổi, hành vi, bối cảnh (tiếng Việt, 2-3 câu)",
    "emotionMechanism": "Emotion trigger bằng cách nào? (tiếng Việt, 2-3 câu)",
    "painpointDepth": "Painpoint đánh sâu đến mức nào? (tiếng Việt, 2 câu)",
    "hookPattern": "Pattern hook: cấu trúc + kỹ thuật (tiếng Việt, 1-2 câu)"
  },
  "framework": {
    "coreUser": "Chân dung viewer (tiếng Việt)",
    "painpoint": "Nỗi đau cụ thể (tiếng Việt)",
    "emotion": "Cảm xúc viewer phải cảm nhận (tiếng Việt)",
    "psp": "Tính năng app giải quyết painpoint (tiếng Việt)"
  },
  "explanation": "Tại sao idea này hiệu quả + so sánh với hook gốc (tiếng Việt, 3-5 câu)",
  "hook": {
    "script": "KỊCH BẢN HOOK liền mạch 3-5s: tình huống + [VOICE] + [TEXT OVERLAY]",
    "textOverlay": "1 câu text overlay",
    "viTranslation": "Bản dịch tiếng Việt",
    "viewerEmotion": "VIEWER cảm nhận gì? (tiếng Việt, 2-3 câu)",
    "painpointImpact": "VIEWER tự thấy mình ở đâu? (tiếng Việt, 2-3 câu)",
    "whyTheyStopScrolling": "Dừng scroll vì? (tiếng Việt, 1 câu)"
  },
  "body": {
    "script": "KỊCH BẢN BODY 10-25s: demo app + [VOICE] + [TEXT OVERLAY]",
    "textOverlay": "Text kết quả/con số",
    "viTranslation": "Bản dịch tiếng Việt"
  },
  "cta": {
    "script": "KỊCH BẢN CTA 3-5s: kêu gọi + [VOICE] + [TEXT OVERLAY]",
    "textOverlay": "CTA bold",
    "viTranslation": "Bản dịch tiếng Việt",
    "endCard": "${appName} + tagline"
  }
}]

Trả về ĐÚNG ${quantity} objects. KHÔNG markdown. KHÔNG giải thích thêm.`;

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
    const valid = arr.filter((i: any) => i?.hook).slice(0, quantity);

    if (valid.length === 0) {
      return NextResponse.json({ error: 'AI trả về format sai.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: valid });
  } catch (err) {
    console.error('[generate-ideas-from-hook] Exception:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
