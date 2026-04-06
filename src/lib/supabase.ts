import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy-initialized browser client (safe for build time)
let _browserClient: SupabaseClient | null = null;

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_browserClient) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error('Missing Supabase env vars');
      _browserClient = createClient(url, key);
    }
    return (_browserClient as any)[prop];
  }
});

// Server client (for API routes / cron jobs - uses service role key)
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceRoleKey);
}
