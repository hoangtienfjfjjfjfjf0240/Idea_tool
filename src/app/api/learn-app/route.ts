import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { askAI } from '@/lib/aiClient';

export async function POST(request: NextRequest) {
  try {
    const { appId, appName, appCategory, newIdeas, existingKnowledge, hooks } = await request.json();
    if (!appId) return NextResponse.json({ error: 'appId required' }, { status: 400 });

    const hooksSummary = hooks?.length 
      ? `\nHOOKS đã lưu cho app:\n${hooks.map((h: { title: string; hook_concept?: string }) => `- "${h.title}": ${h.hook_concept || ''}`).join('\n')}`
      : '';

    const ideasSummary = newIdeas?.length
      ? `\nIDEAS vừa tạo:\n${newIdeas.map((idea: { title: string; content?: { explanation?: string; hook?: { text?: string; visual?: string }; cta?: { voice?: string } } }) => {
          const c = idea.content;
          return `- "${idea.title}": ${c?.explanation || ''}\n  Hook: "${c?.hook?.text || ''}" | Visual: "${c?.hook?.visual || ''}"`;
        }).join('\n')}`
      : '';

    const prompt = `Bạn là AI Marketing Strategist chuyên phân tích và học hỏi từ dữ liệu sáng tạo.

APP: "${appName}" (${appCategory || 'General'})

${existingKnowledge ? `[BỘ NHỚ HIỆN TẠI]\n${existingKnowledge}\n` : '[ĐÂY LÀ LẦN HỌC ĐẦU TIÊN]'}

${ideasSummary}
${hooksSummary}

NHIỆM VỤ: Phân tích TẤT CẢ dữ liệu trên và tạo bản tổng hợp kiến thức CẬP NHẬT cho app này.

Bản tổng hợp phải bao gồm:
1. **Audience Insights**: Đối tượng nào phản hồi tốt, pain points hiệu quả nhất
2. **Hook Patterns**: Kiểu hook nào hoạt động tốt cho app này
3. **Story Structure**: Cấu trúc kể chuyện phù hợp nhất
4. **Demo Flow**: Cách demo app hiệu quả nhất
5. **Tone & Voice**: Giọng nói/phong cách copywriting ăn điểm
6. **CTA Patterns**: Call-to-action convert tốt
7. **Gợi ý cho lần sau**: Hướng triển khai nên thử tiếp

GIỮ LẠI insights cũ nếu vẫn đúng, BỔ SUNG mới, LOẠI BỎ lỗi thời.
Viết ngắn gọn, bullet points. Tối đa 500 từ. OUTPUT: text thuần, không JSON.`;

    const knowledge = await askAI(prompt, { temperature: 0.3 });

    if (!knowledge) {
      return NextResponse.json({ error: 'AI learning failed' }, { status: 500 });
    }

    // Save to database
    const supabase = createServerClient();
    const timestamp = new Date().toLocaleDateString('vi-VN');
    const updatedKnowledge = `[Cập nhật: ${timestamp}]\n${knowledge.trim()}`;

    const { error: dbError } = await supabase
      .from('apps')
      .update({ app_knowledge: updatedKnowledge })
      .eq('id', appId);

    if (dbError) {
      console.error('[learn-app] DB error:', dbError);
      return NextResponse.json({ error: 'Failed to save knowledge' }, { status: 500 });
    }

    return NextResponse.json({ success: true, knowledge: updatedKnowledge });
  } catch (err) {
    console.error('[learn-app] Error:', err);
    return NextResponse.json({ error: 'Unknown error' }, { status: 500 });
  }
}
