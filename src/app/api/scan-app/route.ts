import { NextRequest, NextResponse } from 'next/server';
import { askAI } from '@/lib/aiClient';

// Scrape icon from store page HTML (og:image meta tag)
async function scrapeStoreIcon(storeUrl: string): Promise<string | null> {
  try {
    const res = await fetch(storeUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Try og:image first (works for both Google Play and App Store)
    const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
    if (ogMatch?.[1]) return ogMatch[1];

    // Try itemprop="image" (Google Play fallback)
    const itemMatch = html.match(/<img[^>]*itemprop=["']image["'][^>]*src=["']([^"']+)["']/i);
    if (itemMatch?.[1]) return itemMatch[1];

    // Try to find play-lh.googleusercontent.com icon URL
    const playMatch = html.match(/(https:\/\/play-lh\.googleusercontent\.com\/[^\s"'<>]+)/);
    if (playMatch?.[1]) return playMatch[1];

    return null;
  } catch (e) {
    console.error('[scan-app] scrapeStoreIcon error:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Run icon scrape and AI call in parallel
    const iconPromise = scrapeStoreIcon(url);

    const prompt = `I have an App Store / Google Play URL: "${url}"

Identify the app and extract its details. Output JSON ONLY (no markdown, no code fences, no explanation):
{"name":"...","category":"...","features":[{"name":"Feature in Vietnamese","desc":"Short desc in Vietnamese"}]}

Map category to ONE of: ["Sức khỏe & Thể hình", "Tiện ích", "Tổng hợp", "Trò chơi", "Tài chính", "Giáo dục", "Mạng xã hội"]
Extract up to 5 key features. All feature names and descriptions must be in Vietnamese.`;

    // Use shared AI client (OpenAI-compatible gateway)
    const models = ['gemini/gemini-2.5-flash', 'gemini/gemini-2.5-pro', 'gemini/gemini-2.0-flash'];

    for (const model of models) {
      try {
        const text = await askAI(prompt, {
          model,
          temperature: 0.2,
          useCreativePersona: false,
        });
        if (!text) continue;

        let cleanText = text.replace(/```json\s*|```/g, '').trim();
        const firstCurly = cleanText.indexOf('{');
        const lastCurly = cleanText.lastIndexOf('}');
        if (firstCurly !== -1 && lastCurly !== -1) {
          cleanText = cleanText.substring(firstCurly, lastCurly + 1);
        }

        const data = JSON.parse(cleanText);
        
        // Merge scraped icon
        const scrapedIcon = await iconPromise;
        data.icon = scrapedIcon || '📱';
        
        return NextResponse.json({ success: true, data });
      } catch (e) {
        console.error(`[scan-app] ${model} parse error:`, e instanceof Error ? e.message : e);
        continue;
      }
    }

    return NextResponse.json({ error: 'Could not scan app info' }, { status: 422 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
