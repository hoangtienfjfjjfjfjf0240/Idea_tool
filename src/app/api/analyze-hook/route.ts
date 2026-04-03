import { NextRequest, NextResponse } from 'next/server';
import { askAIWithImage } from '@/lib/aiClient';

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

Phân tích frame/ảnh quảng cáo này theo META VIDEO CREATIVE FRAMEWORK.

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

OUTPUT JSON ONLY (no markdown, no code fences):
{"title":"...","subtitle":"...","description":"...","hook_concept":"...","visual_detail":"...","core_user":"...","painpoint":"...","emotion":"...","creative_type":"..."}`;

    const text = await askAIWithImage(prompt, rawBase64, mimeType, { temperature: 0.3, useCreativePersona: false });
    
    if (!text) {
      return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 });
    }

    // Parse JSON from response
    let cleanText = text.replace(/```json\s*|```/g, '').trim();
    const firstCurly = cleanText.indexOf('{');
    const lastCurly = cleanText.lastIndexOf('}');
    if (firstCurly !== -1 && lastCurly !== -1) {
      cleanText = cleanText.substring(firstCurly, lastCurly + 1);
    }

    const analysis = JSON.parse(cleanText);
    
    return NextResponse.json({ 
      success: true, 
      data: {
        title: analysis.title || fileName?.replace(/\.[^/.]+$/, '') || 'Hook',
        subtitle: analysis.subtitle || 'Video Hook',
        description: analysis.description || '',
        hook_concept: analysis.hook_concept || '',
        visual_detail: analysis.visual_detail || '',
        core_user: analysis.core_user || '',
        painpoint: analysis.painpoint || '',
        emotion: analysis.emotion || '',
        creative_type: analysis.creative_type || analysis.subtitle || '',
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[analyze-hook] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
