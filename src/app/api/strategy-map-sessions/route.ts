import { NextRequest, NextResponse } from 'next/server';
import { guardApiRequest } from '@/lib/apiGuards';
import { createServerClient } from '@/lib/supabase';
import { isHookLibraryIdeaLike, isInvalidStrategyIdea } from '@/lib/ideaStructure';
import type { GeneratedIdea } from '@/types/database';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    const guard = await guardApiRequest(request, { key: 'strategy-map-sessions', max: 60, windowMs: 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const appId = (request.nextUrl.searchParams.get('appId') || '').trim();
    if (!UUID_RE.test(appId)) {
      return NextResponse.json({ success: false, error: 'Invalid app id.' }, { status: 400 });
    }

    const supabase = createServerClient();
    const pageSize = 1000;
    const rows: GeneratedIdea[] = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('generated_ideas')
        .select('id,app_id,title,duration,content,session_id,filters_snapshot,result,created_at')
        .eq('app_id', appId)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      rows.push(...((data || []) as GeneratedIdea[]));
      if (!data || data.length < pageSize) break;
    }

    const visibleRows = rows.filter(idea => !isHookLibraryIdeaLike(idea) && !isInvalidStrategyIdea(idea));
    const sessions = new Map<string, GeneratedIdea[]>();

    visibleRows.forEach(idea => {
      const sessionId = idea.session_id || `legacy:${idea.id}`;
      if (!sessions.has(sessionId)) sessions.set(sessionId, []);
      sessions.get(sessionId)!.push(idea);
    });

    return NextResponse.json({
      success: true,
      sessions: Array.from(sessions.entries()).map(([sessionId, ideas]) => ({
        sessionId,
        filters: ideas[0]?.filters_snapshot || null,
        ideas,
        createdAt: ideas[0]?.created_at || '',
        ideaCount: ideas.length,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load strategy map sessions.' },
      { status: 500 }
    );
  }
}
