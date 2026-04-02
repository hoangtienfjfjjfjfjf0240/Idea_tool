import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { scanAppForSync } from '@/lib/geminiService';

// POST /api/sync-apps — Sync all apps or a specific app
// Also called by Vercel Cron daily
export async function POST(request: NextRequest) {
  const supabase = createServerClient();
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!geminiKey) {
    return NextResponse.json({ success: false, error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  }

  // Optional: sync specific app
  let targetAppId: string | null = null;
  try {
    const body = await request.json();
    targetAppId = body.appId || null;
  } catch {
    // No body = sync all apps
  }

  // Get apps with store links
  let query = supabase.from('apps').select('*').not('store_link', 'is', null);
  if (targetAppId) {
    query = query.eq('id', targetAppId);
  }
  const { data: apps, error } = await query;

  if (error || !apps?.length) {
    return NextResponse.json({ success: false, error: 'No apps with store links found', details: error?.message }, { status: 404 });
  }

  const results: { appId: string; name: string; updated: boolean; changes?: Record<string, unknown>; error?: string }[] = [];

  for (const app of apps) {
    if (!app.store_link) continue;

    // Create pending sync log
    const { data: logEntry } = await supabase
      .from('sync_logs')
      .insert({ app_id: app.id, sync_type: targetAppId ? 'manual' : 'auto', status: 'pending' })
      .select()
      .single();

    try {
      // Call Gemini to scan store page
      const scannedData = await scanAppForSync(geminiKey, app.store_link);

      if (!scannedData) {
        if (logEntry) {
          await supabase.from('sync_logs').update({ status: 'failed', error_message: 'Gemini returned null' }).eq('id', logEntry.id);
        }
        results.push({ appId: app.id, name: app.name, updated: false, error: 'Scan returned null' });
        continue;
      }

      // Detect changes
      const changes: Record<string, { old: string; new: string }> = {};
      let hasChanges = false;

      if (scannedData.name && scannedData.name !== app.name) {
        changes.name = { old: app.name, new: scannedData.name };
        hasChanges = true;
      }
      if (scannedData.category && scannedData.category !== app.category) {
        changes.category = { old: app.category, new: scannedData.category };
        hasChanges = true;
      }
      if (scannedData.icon && scannedData.icon.startsWith('http') && scannedData.icon !== app.icon_url) {
        changes.icon_url = { old: app.icon_url, new: scannedData.icon };
        hasChanges = true;
      }

      // Update app
      if (hasChanges) {
        const updatePayload: Record<string, string> = {};
        if (changes.name) updatePayload.name = changes.name.new;
        if (changes.category) updatePayload.category = changes.category.new;
        if (changes.icon_url) updatePayload.icon_url = changes.icon_url.new;

        await supabase.from('apps').update({
          ...updatePayload,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', app.id);
      } else {
        await supabase.from('apps').update({
          last_synced_at: new Date().toISOString(),
        }).eq('id', app.id);
      }

      // Sync features
      if (scannedData.features?.length) {
        const { data: existingFeatures } = await supabase.from('features').select('name').eq('app_id', app.id);
        const existingNames = new Set((existingFeatures || []).map((f: { name: string }) => f.name));

        const newFeatures = scannedData.features
          .filter((f: { name: string; desc?: string }) => !existingNames.has(f.name))
          .map((f: { name: string; desc?: string }) => ({
            app_id: app.id,
            name: f.name,
            description: f.desc || '',
          }));

        if (newFeatures.length > 0) {
          await supabase.from('features').insert(newFeatures);
          changes['new_features'] = { old: '0', new: String(newFeatures.length) };
          hasChanges = true;

          const { count } = await supabase.from('features').select('*', { count: 'exact', head: true }).eq('app_id', app.id);
          await supabase.from('apps').update({ features_count: count || 0 }).eq('id', app.id);
        }
      }

      // Update sync log
      if (logEntry) {
        await supabase.from('sync_logs').update({
          status: 'success',
          changes: hasChanges ? changes : null,
        }).eq('id', logEntry.id);
      }

      results.push({ appId: app.id, name: app.name, updated: hasChanges, changes });

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      if (logEntry) {
        await supabase.from('sync_logs').update({ status: 'failed', error_message: errMsg }).eq('id', logEntry.id);
      }
      results.push({ appId: app.id, name: app.name, updated: false, error: errMsg });
    }
  }

  return NextResponse.json({ success: true, synced: results.length, results });
}

// GET /api/sync-apps — Called by Vercel Cron
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fakeRequest = new NextRequest(request.url, { method: 'POST' });
  return POST(fakeRequest);
}
