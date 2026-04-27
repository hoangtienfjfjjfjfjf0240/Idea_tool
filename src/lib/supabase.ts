import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy-initialized browser client (safe for build time)
let _browserClient: SupabaseClient | null = null;

const REQUIRED_BROWSER_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

const REQUIRED_SERVER_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

function getMissingEnvVars<T extends readonly string[]>(requiredEnvVars: T) {
  return requiredEnvVars.filter((name) => !(process.env[name] || '').trim());
}

export function getMissingBrowserSupabaseEnvVars() {
  const missing: string[] = [];

  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()) {
    missing.push('NEXT_PUBLIC_SUPABASE_URL');
  }

  if (!(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim()) {
    missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  return missing;
}

export function hasBrowserSupabaseConfig() {
  return getMissingBrowserSupabaseEnvVars().length === 0;
}

function getBrowserSupabaseConfigError() {
  const missing = getMissingBrowserSupabaseEnvVars();
  return missing.length > 0
    ? `Missing Supabase env vars: ${missing.join(', ')}`
    : 'Missing Supabase env vars';
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_browserClient) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error(getBrowserSupabaseConfigError());
      _browserClient = createClient(url, key);
    }

    const value = Reflect.get(_browserClient as object, prop);
    return typeof value === 'function' ? value.bind(_browserClient) : value;
  }
});

// Server client (for API routes / cron jobs - uses service role key)
export function createServerClient() {
  const missing = getMissingEnvVars(REQUIRED_SERVER_ENV_VARS);
  if (missing.length > 0) {
    throw new Error(`Missing Supabase server env vars: ${missing.join(', ')}`);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  return createClient(url, serviceRoleKey);
}
