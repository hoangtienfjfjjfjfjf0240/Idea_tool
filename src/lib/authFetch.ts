'use client';

import { supabase } from './supabase';

export async function getAuthenticatedHeaders(headers?: HeadersInit): Promise<Headers> {
  const nextHeaders = new Headers(headers);
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.access_token) {
    nextHeaders.set('Authorization', `Bearer ${session.access_token}`);
  }

  return nextHeaders;
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    headers: await getAuthenticatedHeaders(init.headers),
  });
}
