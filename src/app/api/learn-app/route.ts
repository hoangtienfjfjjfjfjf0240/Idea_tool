import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { askAI } from '@/lib/aiClient';

export const maxDuration = 120;
export async function POST(request: NextRequest) {
  try {
    const { appId, appName, appCategory, existingKnowledge } = await request.json();
    if (!appId) return NextResponse.json({ error: 'appId required' }, { status: 400 });

    const supabase = createServerClient();

    // 1) Fetch ALL ideas for this app (not just the ones passed in)
    const { data: allIdeas } = await supabase
      .from('generated_ideas')
      .select('title, duration, content, result, created_at')
      .eq('app_id', appId)
      .order('created_at', { ascending: false })
      .limit(50);

    // 2) Fetch ALL hooks for this app
    const { data: allHooks } = await supabase
      .from('hooks')
      .select('title, hook_concept, framework_analysis, source_type')
      .eq('app_id', appId)
      .limit(30);

    // Build comprehensive ideas summary with results
    const ideasSummary = allIdeas?.length
      ? allIdeas.map((idea: any) => {
          const c = idea.content || {};
          const fw = c.framework || {};
          const result = idea.result ? ` [KẾT QUẢ: ${idea.result === 'win' ? '🏆 WIN' : idea.result === 'failed' ? '❌ FAILED' : '👁 MONITORING'}]` : '';
          return `- "${idea.title}" (${idea.duration})${result}
  Framework: User=${fw.coreUser || '?'} | Pain=${fw.painpoint || '?'} | Emotion=${fw.emotion || '?'} | PSP=${fw.psp || '?'}
  Hook: ${(c.hook?.script || '').substring(0, 100)}
  Explanation: ${(c.explanation || '').substring(0, 100)}`;
        }).join('\n')
      : '';

    // Build hooks summary with framework
    const hooksSummary = allHooks?.length
      ? allHooks.map((h: any) => {
          const fw = h.framework_analysis || {};
          return `- "${h.title}" (${h.source_type || 'manual'})
  Concept: ${h.hook_concept || ''}
  Framework: User=${fw.coreUser || '?'} | Pain=${fw.painpoint || '?'} | Emotion=${fw.emotion || '?'}`;
        }).join('\n')
      : '';

    // Count results for strategy context
    const wins = allIdeas?.filter((i: any) => i.result === 'win').length || 0;
    const fails = allIdeas?.filter((i: any) => i.result === 'failed').length || 0;
    const monitoring = allIdeas?.filter((i: any) => i.result === 'monitoring').length || 0;

    const prompt = `Bạn là AI Marketing Strategist chuyên phân tích và học hỏi từ dữ liệu sáng tạo.

APP: "${appName}" (${appCategory || 'General'})

${existingKnowledge ? `[BỘ NHỚ HIỆN TẠI]\n${existingKnowledge}\n` : '[ĐÂY LÀ LẦN HỌC ĐẦU TIÊN]'}

===== TỔNG QUAN CHIẾN LƯỢC =====
Tổng ideas: ${allIdeas?.length || 0} | 🏆 Win: ${wins} | ❌ Fail: ${fails} | 👁 Monitoring: ${monitoring}
Tổng hooks: ${allHooks?.length || 0}

===== TẤT CẢ IDEAS ĐÃ TẠO =====
${ideasSummary || '(Chưa có)'}

===== TẤT CẢ HOOKS ĐÃ LƯU =====
${hooksSummary || '(Chưa có)'}

NHIỆM VỤ: Phân tích TOÀN BỘ dữ liệu trên và tạo bản tổng hợp kiến thức CẬP NHẬT cho app này.

Bản tổng hợp phải bao gồm:
1. **Audience Insights**: Đối tượng nào phản hồi tốt, pain points hiệu quả nhất (dựa trên WIN/FAIL results)
2. **Chiến lược hiện tại**: Tổng hợp hướng đi đang triển khai, combo framework nào WIN nhiều nhất
3. **Hook Patterns**: Kiểu hook nào hoạt động tốt/xấu cho app này
4. **Story Structure**: Cấu trúc kể chuyện phù hợp nhất
5. **Demo Flow**: Cách demo app hiệu quả nhất
6. **Tone & Voice**: Giọng nói/phong cách copywriting ăn điểm
7. **CTA Patterns**: Call-to-action convert tốt
8. **Bài học từ FAILED ideas**: Những hướng đi KHÔNG nên lặp lại
9. **Gợi ý chiến lược tiếp theo**: Hướng triển khai mới dựa trên data

CHÚ Ý ĐẶC BIỆT:
- Phân tích sâu ideas có kết quả WIN → tìm pattern chung
- Phân tích ideas FAILED → rút bài học tránh lặp lại
- So sánh framework combos khác nhau → đề xuất combo tốt nhất
- Dựa trên tất cả hooks đã lưu → tổng hợp hook formula hiệu quả

GIỮ LẠI insights cũ nếu vẫn đúng, BỔ SUNG mới, LOẠI BỎ lỗi thời.
Viết ngắn gọn, bullet points. Tối đa 800 từ. OUTPUT: text thuần, không JSON.`;

    const knowledge = await askAI(prompt, { temperature: 0.3 });

    if (!knowledge) {
      return NextResponse.json({ error: 'AI learning failed' }, { status: 500 });
    }

    // Save to database
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
