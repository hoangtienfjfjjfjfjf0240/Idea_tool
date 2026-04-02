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

    const prompt = `Bạn là một chuyên gia phân tích quảng cáo TikTok/Meta Ads.

Phân tích hình ảnh/frame video này và trả về thông tin HOOK dưới dạng JSON.

Hãy xác định:
1. "title": Nhãn hook ngắn gọn (2-5 từ tiếng Việt), mô tả kiểu hook đang dùng
2. "subtitle": Loại hook (VD: "UGC Hook", "Shock Hook", "Problem Hook", "Before-After", "Curiosity Gap")
3. "description": Mô tả ngắn gọn nội dung/bối cảnh của hook (1-2 câu tiếng Việt)
4. "hook_concept": Phân tích concept tâm lý/chiến lược đằng sau hook này (tiếng Việt)
5. "visual_detail": Mô tả chi tiết visual đang xảy ra trong khung hình (tiếng Việt)

OUTPUT JSON ONLY (no markdown, no code fences):
{"title":"...","subtitle":"...","description":"...","hook_concept":"...","visual_detail":"..."}`;

    const text = await askAIWithImage(prompt, rawBase64, mimeType, { temperature: 0.3 });
    
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
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[analyze-hook] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
