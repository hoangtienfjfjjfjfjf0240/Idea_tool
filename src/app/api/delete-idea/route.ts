import { NextRequest, NextResponse } from 'next/server';
import { guardApiRequest } from '@/lib/apiGuards';
import { createServerClient } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest) {
  try {
    const guard = await guardApiRequest(request, { key: 'delete-idea', max: 60, windowMs: 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const body = await request.json().catch(() => null) as { ideaId?: string; appId?: string } | null;
    const ideaId = body?.ideaId?.trim() || '';
    const appId = body?.appId?.trim() || '';

    if (!UUID_RE.test(ideaId)) {
      return NextResponse.json({ success: false, error: 'Invalid idea id.' }, { status: 400 });
    }

    if (appId && !UUID_RE.test(appId)) {
      return NextResponse.json({ success: false, error: 'Invalid app id.' }, { status: 400 });
    }

    const supabase = createServerClient();
    let query = supabase
      .from('generated_ideas')
      .delete()
      .eq('id', ideaId);

    if (appId) query = query.eq('app_id', appId);

    const { data, error } = await query.select('id');
    if (error) {
      console.error('delete-idea error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ success: false, error: 'Idea not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('delete-idea route failed:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Delete idea failed.' },
      { status: 500 }
    );
  }
}
