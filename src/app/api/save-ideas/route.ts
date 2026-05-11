import { NextRequest, NextResponse } from 'next/server';
import { guardApiRequest } from '@/lib/apiGuards';
import { createServerClient } from '@/lib/supabase';

export const maxDuration = 60;

function readText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const guard = await guardApiRequest(request, { key: 'save-ideas', max: 30, windowMs: 10 * 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const appId = readText(body?.appId);
    const rawIdeas = Array.isArray(body?.ideas) ? body.ideas : [];
    const sessionId = readText(body?.sessionId, crypto.randomUUID());
    const requestFiltersSnapshot = readRecord(body?.filtersSnapshot);

    if (!appId) {
      return NextResponse.json({ success: false, error: 'appId is required' }, { status: 400 });
    }

    if (rawIdeas.length === 0) {
      return NextResponse.json({ success: false, error: 'ideas is required' }, { status: 400 });
    }

    if (rawIdeas.length > 50) {
      return NextResponse.json({ success: false, error: 'Too many ideas in one save request' }, { status: 400 });
    }

    const rows = rawIdeas.map((raw, index) => {
      const idea = readRecord(raw);
      return {
        app_id: appId,
        title: readText(idea.title, `Idea ${index + 1}`),
        duration: readText(idea.duration, 'Short social-first runtime'),
        content: readRecord(idea.content),
        session_id: sessionId,
        filters_snapshot: Object.keys(readRecord(idea.filtersSnapshot)).length > 0
          ? readRecord(idea.filtersSnapshot)
          : requestFiltersSnapshot,
      };
    });

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('generated_ideas')
      .insert(rows)
      .select();

    if (error) {
      console.error('[save-ideas] Insert error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    console.log('[save-ideas] Saved', `${data?.length || 0}/${rows.length}`, 'ideas in', `${Date.now() - startedAt}ms`);

    return NextResponse.json({
      success: true,
      data: data || [],
      count: data?.length || 0,
      sessionId,
    });
  } catch (error) {
    console.error('[save-ideas] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
