import { NextRequest, NextResponse } from 'next/server';
import { callAI, CREATIVE_SYSTEM_PROMPT } from '@/lib/aiClient';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { message, appContext, chatHistory } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    // Build rich context from app data
    const contextParts: string[] = [];

    if (appContext) {
      contextParts.push(`[APP ĐANG LÀM VIỆC]
App: "${appContext.name}" | Category: ${appContext.category}
Features: ${appContext.features?.join(', ') || 'Chưa có'}
Store: ${appContext.storeLink || 'N/A'}`);

      if (appContext.appKnowledge) {
        contextParts.push(`[BỘ NÃO AI - Kiến thức đã học cho app này]\n${appContext.appKnowledge}`);
      }

      if (appContext.recentIdeas?.length) {
        const ideasSummary = appContext.recentIdeas.slice(0, 5).map((idea: { title: string; content?: { hook?: { text?: string }; explanation?: string } }, i: number) => 
          `${i + 1}. "${idea.title}" - Hook: "${idea.content?.hook?.text || ''}" | ${idea.content?.explanation || ''}`
        ).join('\n');
        contextParts.push(`[IDEAS GẦN ĐÂY]\n${ideasSummary}`);
      }

      if (appContext.hooks?.length) {
        const hooksSummary = appContext.hooks.slice(0, 5).map((h: { title: string; hook_concept?: string }, i: number) =>
          `${i + 1}. "${h.title}" - ${h.hook_concept || ''}`
        ).join('\n');
        contextParts.push(`[THƯ VIỆN HOOK]\n${hooksSummary}`);
      }

      if (appContext.filters) {
        const f = appContext.filters;
        contextParts.push(`[FILTER OPTIONS CÓ SẴN]
Đối tượng: ${f.coreUser?.join(', ') || 'N/A'}
Pain Points: ${f.painPoint?.join(', ') || 'N/A'}
Động lực: ${f.motivation?.join(', ') || 'N/A'}
Tính năng: ${f.solution?.join(', ') || 'N/A'}`);
      }
    }

    const agentInstructions = `${CREATIVE_SYSTEM_PROMPT}

BẠN LÀ CHAT AGENT - CREATIVE STRATEGIST CỦA APP NÀY.

${contextParts.join('\n\n')}

CÁCH HOẠT ĐỘNG:
- Bạn có toàn bộ context về app, brain, hooks, ideas, filters ở trên
- Bạn trả lời TRỰC TIẾP câu hỏi/yêu cầu của user
- Khi user yêu cầu tạo ideas, bạn TỰ CHỌN filter phù hợp nhất và tạo ideas
- Khi user hỏi chiến lược, bạn phân tích dựa trên DỮ LIỆU THỰC TẾ của app
- Mỗi câu trả lời phải CỤ THỂ, ACTIONABLE, có ví dụ

ĐỊNH DẠNG OUTPUT:
- Khi tạo ideas: trả về JSON block trong \`\`\`json ... \`\`\` 
- Khi tư vấn: trả lời text bình thường, bullet points
- Khi so sánh: dùng bảng so sánh
- Luôn viết tiếng Việt tự nhiên

NẾU USER YÊU CẦU TẠO IDEAS, trả JSON dạng:
\`\`\`json
[{"id":1,"title":"...","duration":"30s","explanation":"...","hook":{"visual":"...","text":"...","voice":"..."},"demo":{"step1_prep":{"visual":"...","voice":"..."},"step2_action":{"visual":"...","voice":"..."},"step3_result":{"visual":"...","voice":"..."}},"cta":{"voice":"...","text":"..."}}]
\`\`\``;

    // Build messages array with history
    interface HistoryMessage {
      role: 'user' | 'assistant';
      content: string;
    }
    
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: agentInstructions },
    ];

    // Add chat history (last 10 messages for context window)
    if (chatHistory?.length) {
      const recent = chatHistory.slice(-10);
      recent.forEach((msg: HistoryMessage) => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    const response = await callAI(
      messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
      { model: 'gemini/gemini-2.5-pro', temperature: 0.7, useCreativePersona: false }
    );

    if (!response) {
      return NextResponse.json({ error: 'AI không phản hồi, thử lại sau' }, { status: 500 });
    }

    // Check if response contains JSON ideas
    let ideas = null;
    const jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        ideas = JSON.parse(jsonMatch[1]);
      } catch {
        // Not valid JSON, that's fine - it's just a text response
      }
    }

    return NextResponse.json({
      success: true,
      response: response,
      ideas: ideas, // null if just text, array if ideas generated
    });
  } catch (err) {
    console.error('[chat-agent] Error:', err);
    return NextResponse.json({ error: 'Lỗi hệ thống' }, { status: 500 });
  }
}
