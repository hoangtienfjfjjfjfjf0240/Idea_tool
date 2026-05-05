import { NextRequest, NextResponse } from 'next/server';
import { guardApiRequest } from '@/lib/apiGuards';
import { isInvalidStrategyIdea } from '@/lib/ideaStructure';
import { createServerClient } from '@/lib/supabase';
import type { GeneratedIdea } from '@/types/database';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest) {
  try {
    const guard = await guardApiRequest(request, { key: 'cleanup-invalid-ideas', max: 20, windowMs: 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const body = await request.json().catch(() => null) as { appId?: string; dryRun?: boolean } | null;
    const appId = body?.appId?.trim() || '';
    const dryRun = body?.dryRun === true;

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
        console.error('cleanup-invalid-ideas select error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      rows.push(...((data || []) as GeneratedIdea[]));
      if (!data || data.length < pageSize) break;
    }

    const invalidIdeas = rows.filter(isInvalidStrategyIdea);
    const invalidIds = invalidIdeas.map(idea => idea.id).filter(Boolean);

    if (!dryRun && invalidIds.length > 0) {
      for (let index = 0; index < invalidIds.length; index += 500) {
        const chunk = invalidIds.slice(index, index + 500);
        const { error: deleteError } = await supabase
          .from('generated_ideas')
          .delete()
          .eq('app_id', appId)
          .in('id', chunk);

        if (deleteError) {
          console.error('cleanup-invalid-ideas delete error:', deleteError);
          return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      deletedCount: invalidIds.length,
      deletedIds: invalidIds,
    });
  } catch (error) {
    console.error('cleanup-invalid-ideas route failed:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Cleanup invalid ideas failed.' },
      { status: 500 }
    );
  }
}
