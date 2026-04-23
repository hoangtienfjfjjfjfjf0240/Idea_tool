import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { guardApiRequest } from '@/lib/apiGuards';

export async function POST(request: NextRequest) {
  try {
    const guard = await guardApiRequest(request, { key: 'migrate', max: 5, windowMs: 10 * 60 * 1000 });
    if (guard instanceof NextResponse) return guard;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: 'public' } }
    );

    // Test if columns exist by trying to query them
    const { error: testError } = await supabase
      .from('generated_ideas')
      .select('session_id')
      .limit(1);

    if (testError && testError.message.includes('session_id')) {
      // Columns don't exist - provide SQL for manual execution
      return NextResponse.json({
        needsMigration: true,
        message: 'Chạy SQL sau trong Supabase Dashboard → SQL Editor:',
        sql: [
          "ALTER TABLE generated_ideas ADD COLUMN session_id UUID DEFAULT gen_random_uuid();",
          "ALTER TABLE generated_ideas ADD COLUMN filters_snapshot JSONB DEFAULT '{}'::jsonb;",
          "CREATE INDEX idx_generated_ideas_session ON generated_ideas(session_id);",
          "CREATE INDEX idx_generated_ideas_app_session ON generated_ideas(app_id, session_id);"
        ]
      });
    }

    return NextResponse.json({ success: true, message: 'Columns already exist!' });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
