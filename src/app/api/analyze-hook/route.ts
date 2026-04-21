import { NextRequest, NextResponse } from 'next/server';
import { askAIWithImage } from '@/lib/aiClient';
import { parseJsonLoose } from '@/lib/creativePromptSystem';

export const maxDuration = 120;

function readText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export async function POST(request: NextRequest) {
  try {
    const { imageBase64, fileName } = await request.json();
    if (!imageBase64) {
      return NextResponse.json({ error: 'imageBase64 is required' }, { status: 400 });
    }

    // Extract mime type and raw base64
    const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match ? match[1] : 'image/jpeg';
    const rawBase64 = match ? match[2] : imageBase64;

    const prompt = `Bạn là Senior Creative Strategist chuyên Meta/TikTok Video Ads cho Mobile App.

Phân tích ảnh quảng cáo này theo META VIDEO CREATIVE FRAMEWORK.
Nếu ảnh là contact sheet gồm nhiều frame của video, hãy suy luận từ toàn bộ tiến trình opening -> middle -> later, không chỉ nhìn frame đầu.

HOOK FORMULA: Hook = Nơi CORE USER cảm thấy EMOTION khi thấy PAINPOINT qua visual/text/voice.

Hãy phân tích và trả về JSON:
1. "title": Tên hook ngắn gọn (2-5 từ). VD: "Hook hỏi Alexa", "UGC Thợ sửa ĐT", "Hook Bệnh viện"
2. "subtitle": Creative Type. Chọn 1: UGC / POV / Split Screen / Interview / Reaction / Hỏi AI / ASMR / Breaking News / Social Proof / Scale
3. "description": Mô tả ngắn nội dung hook (1-2 câu tiếng Việt)
4. "hook_concept": Phân tích chiến lược tâm lý — tại sao hook này dừng scroll? Cảm xúc nào được trigger?
5. "visual_detail": Mô tả CHI TIẾT visual: ai (tuổi/giới/trang phục), ở đâu (bối cảnh), đang làm gì, biểu cảm, góc quay
6. "core_user": Chân dung Core User mà hook này nhắm tới (VD: "Người già 45+, EN, lowtech, sợ mất dữ liệu")
7. "painpoint": Painpoint đang được thể hiện (VD: "Điện thoại đầy bộ nhớ, không thể update")
8. "emotion": Cảm xúc hook tạo ra cho người xem (VD: "Sợ hãi + Lo lắng", "Tò mò + FOMO")
9. "creative_type": Phân loại creative type cụ thể hơn. VD: "UGC Expert Apple", "Hỏi Alexa", "Interview đường phố"

Yêu cầu:
- Không để trống core_user, painpoint, emotion, creative_type nếu vẫn có thể suy luận tương đối chắc từ visual/text/context.
- Ưu tiên cụ thể, không dùng placeholder chung chung kiểu "N/A", "Unknown", "General user" trừ khi bất khả thi.

OUTPUT JSON ONLY (no markdown, no code fences):
{"title":"...","subtitle":"...","description":"...","hook_concept":"...","visual_detail":"...","core_user":"...","painpoint":"...","emotion":"...","creative_type":"..."}`;

    const text = await askAIWithImage(prompt, rawBase64, mimeType, { temperature: 0.3, useCreativePersona: false });
    
    if (!text) {
      return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 });
    }

    const analysis = parseJsonLoose(text);
    if (!analysis || Array.isArray(analysis)) {
      return NextResponse.json({ error: 'AI analysis parse failed' }, { status: 500 });
    }
    
    return NextResponse.json({ 
      success: true, 
      data: {
        title: readText(analysis.title, fileName?.replace(/\.[^/.]+$/, '') || 'Hook'),
        subtitle: readText(analysis.subtitle, 'Video Hook'),
        description: readText(analysis.description),
        hook_concept: readText(analysis.hook_concept),
        visual_detail: readText(analysis.visual_detail),
        core_user: readText(analysis.core_user),
        painpoint: readText(analysis.painpoint),
        emotion: readText(analysis.emotion),
        creative_type: readText(analysis.creative_type, readText(analysis.subtitle)),
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[analyze-hook] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
