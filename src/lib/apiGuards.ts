import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from './supabase';

type AuthResult = {
  userId: string;
  email?: string;
};

type RateLimitOptions = {
  key: string;
  identifier?: string;
  max: number;
  windowMs: number;
};

type GuardOptions = Omit<RateLimitOptions, 'identifier'> & {
  allowCronSecret?: boolean;
};

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function bearerToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function requestIp(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
  );
}

export async function requireApiAuth(
  request: NextRequest,
  options?: { allowCronSecret?: boolean }
): Promise<AuthResult | NextResponse> {
  const token = bearerToken(request);

  if (
    options?.allowCronSecret
    && process.env.CRON_SECRET
    && token === process.env.CRON_SECRET
  ) {
    return { userId: 'cron' };
  }

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return { userId: data.user.id, email: data.user.email || undefined };
}

export function checkRateLimit(request: NextRequest, options: RateLimitOptions): NextResponse | null {
  const now = Date.now();
  const identifier = options.identifier || requestIp(request);
  const key = `${options.key}:${identifier}`;
  const current = rateBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return null;
  }

  if (current.count >= options.max) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      }
    );
  }

  current.count += 1;
  return null;
}

export async function guardApiRequest(
  request: NextRequest,
  options: GuardOptions
): Promise<{ auth: AuthResult } | NextResponse> {
  const auth = await requireApiAuth(request, { allowCronSecret: options.allowCronSecret });
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, {
    key: options.key,
    identifier: auth.userId,
    max: options.max,
    windowMs: options.windowMs,
  });
  if (limited) return limited;

  return { auth };
}

export function assertAllowedUrl(
  rawUrl: string,
  allowedHosts: string[],
  label = 'URL'
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is invalid.`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} only supports http/https.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowed = allowedHosts.some(host => {
    const normalized = host.toLowerCase();
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });

  if (!allowed) {
    throw new Error(`${label} is not from an allowed domain.`);
  }

  return parsed;
}

function envHosts(name: string) {
  return (process.env[name] || '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);
}

export const STORE_URL_HOSTS = [
  'apps.apple.com',
  'itunes.apple.com',
  'play.google.com',
  ...envHosts('ALLOWED_STORE_URL_HOSTS'),
];

export const TREND_VIDEO_URL_HOSTS = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'tiktokcdn.com',
  'tiktokv.com',
  'tiktokcdn-us.com',
  'byteoversea.com',
  'muscdn.com',
  'akamaized.net',
  'vm.tiktok.com',
  'vt.tiktok.com',
  'instagram.com',
  'cdninstagram.com',
  'facebook.com',
  'fbcdn.net',
  'fb.watch',
  'vimeo.com',
  ...envHosts('ALLOWED_TREND_VIDEO_HOSTS'),
];

export const HOOK_MEDIA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

export function maxUploadBytes() {
  const parsed = Number(process.env.MAX_HOOK_UPLOAD_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 60 * 1024 * 1024;
}

export function maxThumbBytes() {
  const parsed = Number(process.env.MAX_HOOK_THUMB_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5 * 1024 * 1024;
}
