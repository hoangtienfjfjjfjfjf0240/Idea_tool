import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { askAI } from '@/lib/aiClient';
import { guardApiRequest } from '@/lib/apiGuards';

export const maxDuration = 180;

type SupabaseClient = ReturnType<typeof createServerClient>;

type IdeaRow = {
  id: string;
  title: string | null;
  duration: string | null;
  content: {
    framework?: {
      coreUser?: string;
      painpoint?: string;
      emotion?: string;
      psp?: string;
    };
    hook?: {
      visual?: string;
      script?: string;
      voice?: string;
      textOverlay?: string;
      text?: string;
    };
    creativeType?: string;
  } | null;
  result: string | null;
  created_at: string | null;
  session_id: string | null;
  filters_snapshot: Record<string, unknown> | null;
};

type HookRow = {
  title: string | null;
  hook_concept: string | null;
  visual_detail: string | null;
  painpoint: string | null;
  emotion: string | null;
  core_user: string | null;
  creative_type: string | null;
  created_at: string | null;
};

const FETCH_PAGE_SIZE = 500;
const MAX_FETCH_IDEAS = 2000;
const MAX_DETAIL_LINES = 120;
const MAX_COMBO_LINES = 40;
const MAX_SESSION_LINES = 40;

function asStringList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean);
  }
  const str = String(value).trim();
  return str ? [str] : [];
}

function joinList(value: unknown, fallback = '-', maxItems = 4): string {
  const items = asStringList(value);
  if (items.length === 0) return fallback;
  const shown = items.slice(0, maxItems).join(' + ');
  return items.length > maxItems ? `${shown} + ${items.length - maxItems} more` : shown;
}

function truncate(value: unknown, max = 180): string {
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

function getFramework(idea: IdeaRow) {
  const fw = idea.content?.framework || {};
  return {
    coreUser: fw.coreUser || '',
    painpoint: fw.painpoint || '',
    emotion: fw.emotion || '',
    psp: fw.psp || '',
  };
}

function getFilterSummary(idea: IdeaRow) {
  const filters = idea.filters_snapshot || {};
  const fw = getFramework(idea);
  return {
    coreUser: joinList(filters.coreUser, fw.coreUser || '-'),
    painPoint: joinList(filters.painPoint, fw.painpoint || '-'),
    solution: joinList(filters.solution, fw.psp || '-'),
    emotion: joinList(filters.emotion, fw.emotion || '-'),
    angle: joinList(filters.angle),
    targetMarket: joinList(filters.targetMarket),
    visualType: joinList(filters.visualType, idea.content?.creativeType || '-'),
  };
}

function buildComboKey(summary: ReturnType<typeof getFilterSummary>): string {
  return [
    summary.coreUser,
    summary.painPoint,
    summary.emotion,
    summary.solution,
    summary.angle,
    summary.targetMarket,
    summary.visualType,
  ].join('|||');
}

function countResults(ideas: IdeaRow[]) {
  return ideas.reduce(
    (acc, idea) => {
      if (idea.result === 'win') acc.win++;
      else if (idea.result === 'failed') acc.failed++;
      else if (idea.result === 'monitoring') acc.monitoring++;
      else acc.noResult++;
      return acc;
    },
    { win: 0, failed: 0, monitoring: 0, noResult: 0 }
  );
}

async function fetchAllIdeas(supabase: SupabaseClient, appId: string) {
  const { count } = await supabase
    .from('generated_ideas')
    .select('id', { count: 'exact', head: true })
    .eq('app_id', appId);

  const rows: IdeaRow[] = [];
  for (let from = 0; from < MAX_FETCH_IDEAS; from += FETCH_PAGE_SIZE) {
    const to = from + FETCH_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('generated_ideas')
      .select('id, title, duration, content, result, created_at, session_id, filters_snapshot')
      .eq('app_id', appId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`generated_ideas query failed: ${error.message}`);
    }

    const page = (data || []) as IdeaRow[];
    rows.push(...page);
    if (page.length < FETCH_PAGE_SIZE) break;
  }

  const totalCount = count ?? rows.length;
  return {
    ideas: rows,
    totalCount,
    truncated: rows.length < totalCount,
  };
}

async function fetchHooks(supabase: SupabaseClient, appId: string): Promise<HookRow[]> {
  const { data, error } = await supabase
    .from('hooks')
    .select('title, hook_concept, visual_detail, painpoint, emotion, core_user, creative_type, created_at')
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.warn('[learn-app] hooks query failed:', error.message);
    return [];
  }

  return (data || []) as HookRow[];
}

function buildComboSummary(ideas: IdeaRow[]): string {
  const comboMap = new Map<string, {
    filters: ReturnType<typeof getFilterSummary>;
    ideas: IdeaRow[];
  }>();

  ideas.forEach(idea => {
    const filters = getFilterSummary(idea);
    const key = buildComboKey(filters);
    if (!comboMap.has(key)) comboMap.set(key, { filters, ideas: [] });
    comboMap.get(key)!.ideas.push(idea);
  });

  const combos = [...comboMap.values()].sort((a, b) => b.ideas.length - a.ideas.length);
  if (combos.length === 0) return '(No filter combinations found)';

  return combos.slice(0, MAX_COMBO_LINES).map((combo, index) => {
    const stats = countResults(combo.ideas);
    const firstTitle = truncate(combo.ideas[0]?.title, 90);
    return `${index + 1}. count=${combo.ideas.length} | win=${stats.win}, failed=${stats.failed}, monitoring=${stats.monitoring}, no_result=${stats.noResult}
   filters: coreUser="${combo.filters.coreUser}" | pain="${combo.filters.painPoint}" | emotion="${combo.filters.emotion}" | PSP="${combo.filters.solution}" | angle="${combo.filters.angle}" | market="${combo.filters.targetMarket}" | visual="${combo.filters.visualType}"
   latest_example="${firstTitle}"`;
  }).join('\n');
}

function buildSessionSummary(ideas: IdeaRow[], focusSessionId?: string): string {
  const sessionMap = new Map<string, IdeaRow[]>();
  ideas.forEach(idea => {
    const key = idea.session_id || `legacy-${idea.id}`;
    if (!sessionMap.has(key)) sessionMap.set(key, []);
    sessionMap.get(key)!.push(idea);
  });

  const sessions = [...sessionMap.entries()].sort((a, b) => {
    if (focusSessionId && a[0] === focusSessionId) return -1;
    if (focusSessionId && b[0] === focusSessionId) return 1;
    return (b[1][0]?.created_at || '').localeCompare(a[1][0]?.created_at || '');
  });

  if (sessions.length === 0) return '(No generation sessions found)';

  return sessions.slice(0, MAX_SESSION_LINES).map(([sessionId, sessionIdeas], index) => {
    const filters = getFilterSummary(sessionIdeas[0]);
    const stats = countResults(sessionIdeas);
    const focus = focusSessionId && sessionId === focusSessionId ? ' [NEW_SESSION]' : '';
    const titles = sessionIdeas.slice(0, 4).map(idea => truncate(idea.title, 70)).join(' | ');
    return `${index + 1}. session=${sessionId}${focus} | ideas=${sessionIdeas.length} | win=${stats.win}, failed=${stats.failed}, monitoring=${stats.monitoring}, no_result=${stats.noResult}
   selected_filters: coreUser="${filters.coreUser}" | pain="${filters.painPoint}" | emotion="${filters.emotion}" | PSP="${filters.solution}" | angle="${filters.angle}" | market="${filters.targetMarket}" | visual="${filters.visualType}"
   titles="${titles}"`;
  }).join('\n');
}

function buildIdeaDetails(ideas: IdeaRow[]): string {
  const sorted = [...ideas].sort((a, b) => {
    const priority: Record<string, number> = { win: 0, failed: 1, monitoring: 2 };
    const left = priority[a.result || ''] ?? 3;
    const right = priority[b.result || ''] ?? 3;
    if (left !== right) return left - right;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  return sorted.slice(0, MAX_DETAIL_LINES).map((idea, index) => {
    const c = idea.content || {};
    const fw = getFramework(idea);
    const filters = getFilterSummary(idea);
    const hookVisual = c.hook?.visual || c.hook?.script || '';
    const hookVoice = c.hook?.voice || '';
    const hookText = c.hook?.textOverlay || c.hook?.text || '';
    return `${index + 1}. [${resultLabel(idea.result)}] "${truncate(idea.title, 90)}" (${idea.duration || '-'})
   framework: user="${truncate(fw.coreUser, 80)}" | pain="${truncate(fw.painpoint, 90)}" | emotion="${truncate(fw.emotion, 70)}" | PSP="${truncate(fw.psp, 90)}"
   selected_filters: coreUser="${filters.coreUser}" | pain="${filters.painPoint}" | emotion="${filters.emotion}" | PSP="${filters.solution}" | angle="${filters.angle}" | market="${filters.targetMarket}" | visual="${filters.visualType}"
   creativeType="${c.creativeType || filters.visualType}" | hookVisual="${truncate(hookVisual, 140)}" | hookVoice="${truncate(hookVoice, 120)}" | hookText="${truncate(hookText, 90)}"`;
  }).join('\n');
}

function buildHooksSummary(hooks: HookRow[]): string {
  if (hooks.length === 0) return '(No saved hooks found)';
  return hooks.slice(0, 80).map((hook, index) => {
    return `${index + 1}. "${truncate(hook.title, 90)}" | type="${hook.creative_type || '-'}" | user="${hook.core_user || '-'}" | pain="${hook.painpoint || '-'}" | emotion="${hook.emotion || '-'}"
   concept="${truncate(hook.hook_concept || hook.visual_detail, 150)}"`;
  }).join('\n');
}
export async function POST(request: NextRequest) {
  try {
    const guard = await guardApiRequest(request, { key: 'learn-app', max: 20, windowMs: 10 * 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const { appId, appName, appCategory, existingKnowledge, sessionId } = await request.json();
    if (!appId) return NextResponse.json({ error: 'appId required' }, { status: 400 });

    const supabase = createServerClient();

    const [{ ideas: allIdeas, totalCount, truncated }, allHooks] = await Promise.all([
      fetchAllIdeas(supabase, appId),
      fetchHooks(supabase, appId),
    ]);

    const stats = countResults(allIdeas);
    const sessionIds = new Set(allIdeas.map(idea => idea.session_id || `legacy-${idea.id}`));
    const comboKeys = new Set(allIdeas.map(idea => buildComboKey(getFilterSummary(idea))));
    const coverageLine = `Learned ideas: ${allIdeas.length}/${totalCount}${truncated ? ' (truncated by safety cap)' : ''} | sessions: ${sessionIds.size} | filter_combos: ${comboKeys.size} | hooks: ${allHooks.length}`;
    const comboSummary = buildComboSummary(allIdeas);
    const sessionSummary = buildSessionSummary(allIdeas, sessionId);
    const ideaDetails = buildIdeaDetails(allIdeas);
    const hooksSummary = buildHooksSummary(allHooks);

    const prompt = `Bạn là AI Marketing Strategist. Hãy học từ dữ liệu sáng tạo của app theo cách có cấu trúc, không suy diễn quá dữ liệu.

APP: "${appName}" (${appCategory || 'General'})

${existingKnowledge ? `[BỘ NHỚ CŨ - chỉ giữ lại nếu còn đúng với data mới]\n${existingKnowledge}\n` : '[ĐÂY LÀ LẦN HỌC ĐẦU TIÊN]'}

===== DATA COVERAGE =====
${coverageLine}
Result mix: win=${stats.win}, failed=${stats.failed}, monitoring=${stats.monitoring}, no_result=${stats.noResult}

===== FILTER COMBINATION MAP - HỌC CẤU TRÚC CHỌN BỘ LỌC =====
${comboSummary}

===== GENERATION SESSION MAP - MỖI PHIÊN USER ĐÃ CHỌN GÌ =====
${sessionSummary}

===== IDEA DETAILS - ƯU TIÊN WIN / FAILED / MONITORING / GẦN ĐÂY =====
${ideaDetails || '(Chưa có idea)'}

===== SAVED HOOK LIBRARY =====
${hooksSummary}

NHIỆM VỤ:
Tạo "Bộ Não AI" cập nhật cho app này. Bắt buộc phải học cả 2 lớp:
1. Lớp chiến lược: core user, painpoint, emotion, PSP, target market, angle, visual type đã được chọn như thế nào.
2. Lớp creative execution: title, hook visual, voice, text overlay, creativeType và scene family của các idea đã tạo.

OUTPUT PHẢI CÓ CẤU TRÚC:
1. **Data Coverage**: nêu rõ đã học từ bao nhiêu ideas, bao nhiêu phiên, bao nhiêu filter combos, bao nhiêu hooks. Nếu data bị truncated thì nói rõ.
2. **Filter Map**: combo filter nào đã test nhiều, combo nào có win/fail/monitoring, combo nào chưa đủ data.
3. **Creative Patterns**: những scene family, hook formula, creative type đang lặp lại hoặc đang hiệu quả.
4. **Win/Loss Learning**: nếu có WIN/FAILED thì rút pattern; nếu chưa có kết quả thì nói "chưa đủ result data", không bịa.
5. **Avoid List**: những hướng không nên lặp lại, nhất là scene/hook quá giống nhau.
6. **Next Strategy**: đề xuất 3 hướng test tiếp, dựa trên filter gaps và idea history.

QUY TẮC:
- Không chỉ tóm tắt vài idea gần nhất. Phải dùng FILTER COMBINATION MAP và GENERATION SESSION MAP.
- Không nói "tất cả" nếu coverage bị truncated.
- Nếu nhiều idea giống nhau, gọi thẳng đó là duplication risk.
- Viết tiếng Việt, bullet rõ, tối đa 1000 từ. OUTPUT: text thuần, không JSON.`;

    const knowledge = await askAI(prompt, {
      temperature: 0.25,
      max_tokens: 12000,
      priority: sessionId ? 'low' : 'normal',
      timeoutMs: 240000,
    });

    if (!knowledge) {
      return NextResponse.json({ error: 'AI learning failed' }, { status: 500 });
    }

    // Save to database
    const timestamp = new Date().toLocaleDateString('vi-VN');
    const updatedKnowledge = `[Cập nhật: ${timestamp}] [${coverageLine}]\n${knowledge.trim()}`;

    const { error: dbError } = await supabase
      .from('apps')
      .update({ app_knowledge: updatedKnowledge })
      .eq('id', appId);

    if (dbError) {
      console.error('[learn-app] DB error:', dbError);
      return NextResponse.json({ error: 'Failed to save knowledge' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      knowledge: updatedKnowledge,
      coverage: {
        learnedIdeas: allIdeas.length,
        totalIdeas: totalCount,
        truncated,
        sessions: sessionIds.size,
        filterCombos: comboKeys.size,
        hooks: allHooks.length,
      },
    });
  } catch (err) {
    console.error('[learn-app] Error:', err);
    return NextResponse.json({ error: 'Unknown error' }, { status: 500 });
  }
}
