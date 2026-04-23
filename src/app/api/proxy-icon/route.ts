import { NextRequest, NextResponse } from 'next/server';
import { assertAllowedUrl, checkRateLimit } from '@/lib/apiGuards';

const ICON_HOSTS = ['mzstatic.com', 'googleusercontent.com'];
const MAX_ICON_BYTES = 5 * 1024 * 1024;

// Proxy icon images to bypass hotlink protection from Apple/Google CDNs
export async function GET(request: NextRequest) {
  const limited = checkRateLimit(request, { key: 'proxy-icon', max: 120, windowMs: 60 * 1000 });
  if (limited) return limited;

  const url = request.nextUrl.searchParams.get('url');
  
  if (!url || !url.startsWith('http')) {
    return NextResponse.json({ error: 'Missing or invalid URL' }, { status: 400 });
  }

  try {
    const parsed = assertAllowedUrl(url, ICON_HOSTS, 'Icon URL');

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/*,*/*',
        'Referer': parsed.origin,
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch icon' }, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Unsupported icon content type' }, { status: 415 });
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_ICON_BYTES) {
      return NextResponse.json({ error: 'Icon too large' }, { status: 413 });
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_ICON_BYTES) {
      return NextResponse.json({ error: 'Icon too large' }, { status: 413 });
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800, immutable', // Cache 7 days
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[proxy-icon] Error:', err);
    return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
  }
}
