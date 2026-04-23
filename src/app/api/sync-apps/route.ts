import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { askAI } from '@/lib/aiClient';
import { assertAllowedUrl, guardApiRequest, STORE_URL_HOSTS } from '@/lib/apiGuards';

// Helper: parse JSON from text
function parseJsonFromText(text: string): Record<string, unknown> | null {
  try {
    let cleanText = text.replace(/```json\s*|```/g, '').trim();
    const firstCurly = cleanText.indexOf('{');
    const lastCurly = cleanText.lastIndexOf('}');
    if (firstCurly !== -1 && lastCurly !== -1) {
      cleanText = cleanText.substring(firstCurly, lastCurly + 1);
    }
    return JSON.parse(cleanText);
  } catch {
    return null;
  }
}

// Fetch reliable icon URL from iTunes Lookup API (App Store) or scrape og:image (Google Play)
async function fetchReliableIconUrl(storeLink: string): Promise<string | null> {
  try {
    // App Store: extract app ID and use iTunes Lookup API
    const appStoreMatch = storeLink.match(/\/id(\d+)/);
    if (appStoreMatch) {
      const appId = appStoreMatch[1];
      const res = await fetch(`https://itunes.apple.com/lookup?id=${appId}&country=us`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.results?.[0]) {
          // artworkUrl512 or scale up artworkUrl100
          const artwork = data.results[0].artworkUrl512 
            || data.results[0].artworkUrl100?.replace('100x100', '512x512');
          if (artwork) return artwork;
        }
      }
    }

    // Google Play: scrape og:image from store page
    if (storeLink.includes('play.google.com')) {
      const res = await fetch(storeLink, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        cache: 'no-store',
      });
      if (res.ok) {
        const html = await res.text();
        const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
          || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
        if (ogMatch?.[1]) return ogMatch[1];
        const playMatch = html.match(/(https:\/\/play-lh\.googleusercontent\.com\/[^\s"'<>]+)/);
        if (playMatch?.[1]) return playMatch[1];
      }
    }

    return null;
  } catch (e) {
    console.error('[sync-apps] fetchReliableIconUrl error:', e instanceof Error ? e.message : e);
    return null;
  }
}

// Validate an icon URL actually returns 200
async function isIconUrlValid(url: string): Promise<boolean> {
  if (!url || !url.startsWith('http')) return false;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

// Scan app for sync using AI gateway
async function scanAppForSync(storeLink: string) {
  const prompt = `I have an App Store / Google Play URL: "${storeLink}"

YOUR TASK:
1. Based on this URL, identify the app and extract its details.
2. Extract: App Name, Category, and up to 5 key features.
3. Do NOT include icon URL - it will be fetched separately.
4. Map category to EXACTLY ONE: ["Sức khỏe & Thể hình", "Tiện ích", "Tổng hợp", "Trò chơi", "Tài chính", "Giáo dục", "Mạng xã hội"]
5. Features should be in Vietnamese.

OUTPUT JSON ONLY (no markdown, no explanation):
{"name":"...","category":"...","features":[{"name":"Feature (Vietnamese)","desc":"Short desc (Vietnamese)"}]}`;

  const models = ['gemini/gemini-2.5-flash', 'gemini/gemini-2.5-pro', 'gemini/gemini-2.0-flash'];

  for (const model of models) {
    try {
      const text = await askAI(prompt, {
        model,
        temperature: 0.2,
        useCreativePersona: false,
      });
      if (!text) continue;
      const parsed = parseJsonFromText(text);
      if (parsed) return parsed;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`scanAppForSync error with ${model}:`, errMsg);
      continue;
    }
  }

  return null;
}

// POST /api/sync-apps — Sync all apps or a specific app
// Also called by Vercel Cron daily
export async function POST(request: NextRequest) {
  const guard = await guardApiRequest(request, {
    key: 'sync-apps',
    max: 10,
    windowMs: 10 * 60 * 1000,
    allowCronSecret: true,
  });
  if (guard instanceof NextResponse) return guard;

  const supabase = createServerClient();

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
      assertAllowedUrl(app.store_link, STORE_URL_HOSTS, 'Store URL');
      // Fetch reliable icon URL and AI scan in parallel
      const [scannedData, reliableIconUrl] = await Promise.all([
        scanAppForSync(app.store_link),
        fetchReliableIconUrl(app.store_link),
      ]);

      if (!scannedData) {
        // Even if AI fails, still try to fix broken icons
        if (reliableIconUrl && reliableIconUrl !== app.icon_url) {
          const currentIconValid = await isIconUrlValid(app.icon_url);
          if (!currentIconValid) {
            await supabase.from('apps').update({
              icon_url: reliableIconUrl,
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq('id', app.id);
            if (logEntry) {
              await supabase.from('sync_logs').update({ status: 'success', changes: { icon_url: { old: app.icon_url, new: reliableIconUrl } } }).eq('id', logEntry.id);
            }
            results.push({ appId: app.id, name: app.name, updated: true, changes: { icon_url: { old: app.icon_url, new: reliableIconUrl } } });
            continue;
          }
        }
        if (logEntry) {
          await supabase.from('sync_logs').update({ status: 'failed', error_message: 'AI returned null' }).eq('id', logEntry.id);
        }
        results.push({ appId: app.id, name: app.name, updated: false, error: 'Scan returned null' });
        continue;
      }

      // Detect changes
      const changes: Record<string, { old: string; new: string }> = {};
      let hasChanges = false;

      if (scannedData.name && scannedData.name !== app.name) {
        changes.name = { old: app.name, new: scannedData.name as string };
        hasChanges = true;
      }
      if (scannedData.category && scannedData.category !== app.category) {
        changes.category = { old: app.category, new: scannedData.category as string };
        hasChanges = true;
      }

      // Use reliableIconUrl instead of AI-generated icon
      // Also check if current icon is broken and needs replacement
      if (reliableIconUrl) {
        const currentIconValid = await isIconUrlValid(app.icon_url);
        if (!currentIconValid || reliableIconUrl !== app.icon_url) {
          if (!currentIconValid) {
            // Current icon is broken, always replace
            changes.icon_url = { old: app.icon_url, new: reliableIconUrl };
            hasChanges = true;
          }
        }
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
      const features = scannedData.features as { name: string; desc?: string }[] | undefined;
      if (features?.length) {
        const { data: existingFeatures } = await supabase.from('features').select('name').eq('app_id', app.id);
        const existingNames = new Set((existingFeatures || []).map((f: { name: string }) => f.name));

        const newFeatures = features
          .filter((f) => !existingNames.has(f.name))
          .map((f) => ({
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

  const fakeRequest = new NextRequest(request.url, {
    method: 'POST',
    headers: { authorization: authHeader || '' },
  });
  return POST(fakeRequest);
}
