import { NextRequest, NextResponse } from 'next/server';
import { callAI } from '@/lib/aiClient';
import {
  buildIdeaOutputSpec,
  CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT,
  CREATIVE_PROMPT_RULES,
  normalizeIdeaOutput,
  TOOL_COMPATIBILITY_GUARDRAILS,
} from '@/lib/creativePromptSystem';

export const maxDuration = 120;

function asList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  const text = String(value).trim();
  return text ? [text] : [];
}

function joinList(value: unknown, fallback = '-', maxItems = 4): string {
  const items = asList(value);
  if (items.length === 0) return fallback;
  const shown = items.slice(0, maxItems).join(' + ');
  return items.length > maxItems ? `${shown} + ${items.length - maxItems} more` : shown;
}

function truncate(value: unknown, max = 140): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function resultLabel(result: string | null | undefined): string {
  if (result === 'win') return 'WIN';
  if (result === 'failed') return 'FAILED';
  if (result === 'monitoring') return 'MONITORING';
  return 'NO_RESULT';
}

function summarizeRecentIdeas(recentIdeas: Array<Record<string, unknown>>): string {
  if (!recentIdeas.length) return '(Chưa có recent ideas)';

  return recentIdeas.slice(0, 12).map((idea, index) => {
    const content = (idea.content || {}) as Record<string, any>;
    const framework = (content.framework || {}) as Record<string, string>;
    const filters = (idea.filters_snapshot || {}) as Record<string, unknown>;
    return `${index + 1}. [${resultLabel((idea.result as string | null) || null)}] "${truncate(idea.title, 90)}" (${idea.duration || '-'})
   framework: user="${truncate(framework.coreUser, 70)}" | pain="${truncate(framework.painpoint, 80)}" | emotion="${truncate(framework.emotion, 60)}" | PSP="${truncate(framework.psp, 80)}"
   selectedFilters: coreUser="${joinList(filters.coreUser, framework.coreUser || '-')}" | pain="${joinList(filters.painPoint, framework.painpoint || '-')}" | emotion="${joinList(filters.emotion, framework.emotion || '-')}" | solution="${joinList(filters.solution, framework.psp || '-')}" | angle="${joinList(filters.angle)}" | market="${joinList(filters.targetMarket)}" | visual="${joinList(filters.visualType, content.creativeType || '-')}"
   creativeType="${content.creativeType || '-'}" | hook="${truncate(content.hook?.textOverlay || content.hook?.text || content.hook?.voice || '', 100)}"`;
  }).join('\n');
}

function summarizeRecentFilterCombos(recentIdeas: Array<Record<string, unknown>>): string {
  if (!recentIdeas.length) return '(Chưa có filter combo history)';

  const comboMap = new Map<string, { count: number; win: number; failed: number; monitoring: number; label: string }>();
  recentIdeas.forEach(idea => {
    const content = (idea.content || {}) as Record<string, any>;
    const framework = (content.framework || {}) as Record<string, string>;
    const filters = (idea.filters_snapshot || {}) as Record<string, unknown>;
    const label = `coreUser="${joinList(filters.coreUser, framework.coreUser || '-')}" | pain="${joinList(filters.painPoint, framework.painpoint || '-')}" | emotion="${joinList(filters.emotion, framework.emotion || '-')}" | solution="${joinList(filters.solution, framework.psp || '-')}" | angle="${joinList(filters.angle)}" | market="${joinList(filters.targetMarket)}" | visual="${joinList(filters.visualType, content.creativeType || '-')}"`;
    if (!comboMap.has(label)) comboMap.set(label, { count: 0, win: 0, failed: 0, monitoring: 0, label });
    const row = comboMap.get(label)!;
    row.count++;
    if (idea.result === 'win') row.win++;
    else if (idea.result === 'failed') row.failed++;
    else if (idea.result === 'monitoring') row.monitoring++;
  });

  return [...comboMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((row, index) => `${index + 1}. count=${row.count} | win=${row.win}, failed=${row.failed}, monitoring=${row.monitoring}
   ${row.label}`)
    .join('\n');
}

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
        contextParts.push(`[RECENT IDEA HISTORY]\n${summarizeRecentIdeas(appContext.recentIdeas as Array<Record<string, unknown>>)}`);
        contextParts.push(`[RECENT FILTER COMBOS]\n${summarizeRecentFilterCombos(appContext.recentIdeas as Array<Record<string, unknown>>)}`);
      }

      if (appContext.hooks?.length) {
        const hooksSummary = appContext.hooks.slice(0, 8).map((h: { title: string; hook_concept?: string; creative_type?: string }, i: number) =>
          `${i + 1}. "${h.title}" - ${h.hook_concept || ''}`
        ).join('\n');
        contextParts.push(`[THƯ VIỆN HOOK]\n${hooksSummary}`);
      }

      if (appContext.filters) {
        const f = appContext.filters;
        contextParts.push(`[FILTER OPTIONS CÓ SẴN]
Đối tượng: ${f.coreUser?.join(', ') || 'N/A'}
Pain Points: ${f.painPoint?.join(', ') || 'N/A'}
Emotion: ${f.emotion?.join(', ') || 'N/A'}
Tính năng: ${f.solution?.join(', ') || 'N/A'}
Angle: ${f.angle?.join(', ') || 'N/A'}
Visual Type: ${f.visualType?.join(', ') || 'N/A'}
Target Market: ${f.targetMarket?.join(', ') || 'N/A'}`);
      }
    }

    const agentInstructions = `${CREATIVE_IDEA_ENGINE_SYSTEM_PROMPT}

BẠN LÀ CHAT AGENT - CREATIVE STRATEGIST CỦA APP NÀY.

${contextParts.join('\n\n')}

CÁCH HOẠT ĐỘNG:
- Bạn có context từ app, AI Brain, hook library, recent idea history và filter combos ở trên
- AI Brain là strategic memory; recent idea history + filter combos là evidence mới hơn. Nếu có mâu thuẫn, ưu tiên evidence mới hơn.
- Bạn trả lời TRỰC TIẾP câu hỏi/yêu cầu của user
- Khi user yêu cầu tạo ideas, bạn TỰ CHỌN filter phù hợp nhất và tạo ideas
- Khi tạo ideas, phải nhìn recent ideas để tránh lặp lại cùng scene family, cùng hook opening và cùng blocker nếu user không yêu cầu lặp
- Khi user hỏi chiến lược, bạn phân tích dựa trên DỮ LIỆU THỰC TẾ của app
- Mỗi câu trả lời phải CỤ THỂ, ACTIONABLE, có ví dụ
- Khi user yêu cầu tạo ideas, phải tuân thủ prompt system, output spec, và rules bên dưới

ĐỊNH DẠNG OUTPUT:
- Khi tạo ideas: trả về JSON block trong \`\`\`json ... \`\`\`
- Khi tư vấn: trả lời text bình thường, bullet points
- Khi so sánh: dùng bảng so sánh
- Luôn viết tiếng Việt tự nhiên

NẾU USER YÊU CẦU TẠO IDEAS, tuân thủ đúng schema sau:
${buildIdeaOutputSpec({ quantity: 3, duration: '30s', appName: appContext?.name || 'App', language: 'the chosen market language', includeSelectedFilters: true })}

${CREATIVE_PROMPT_RULES}
${TOOL_COMPATIBILITY_GUARDRAILS}`;

    // Build messages array with history
    interface HistoryMessage {
      role: 'user' | 'assistant';
      content: string;
    }

    const messages: { role: string; content: string }[] = [
      { role: 'system', content: agentInstructions },
    ];

    if (chatHistory?.length) {
      const recent = chatHistory.slice(-10);
      recent.forEach((msg: HistoryMessage) => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }

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
    const rawJson = jsonMatch?.[1] || response.trim();
    if (rawJson.startsWith('[') || rawJson.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawJson);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        ideas = arr.map(item =>
          normalizeIdeaOutput(item, {
            duration: '30s',
            appName: appContext?.name || 'App',
            pillar: appContext?.filters?.painPoint?.[0] || 'General user friction',
          })
        );
      } catch {
        // Not valid JSON
      }
    }

    return NextResponse.json({
      success: true,
      response: response,
      ideas: ideas,
    });
  } catch (err) {
    console.error('[chat-agent] Error:', err);
    return NextResponse.json({ error: 'Lỗi hệ thống' }, { status: 500 });
  }
}
