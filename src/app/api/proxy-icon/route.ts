import { NextRequest, NextResponse } from 'next/server';

// Proxy icon images to bypass hotlink protection from Apple/Google CDNs
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  
  if (!url || !url.startsWith('http')) {
    return NextResponse.json({ error: 'Missing or invalid URL' }, { status: 400 });
  }

  // Only allow known CDN domains
  const allowedDomains = [
    'is1-ssl.mzstatic.com',
    'is2-ssl.mzstatic.com',
    'is3-ssl.mzstatic.com',
    'is4-ssl.mzstatic.com',
    'is5-ssl.mzstatic.com',
    'play-lh.googleusercontent.com',
  ];

  try {
    const parsed = new URL(url);
    if (!allowedDomains.some(d => parsed.hostname === d || parsed.hostname.endsWith('.mzstatic.com') || parsed.hostname.endsWith('.googleusercontent.com'))) {
      return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
    }

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
    const buffer = await response.arrayBuffer();

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
