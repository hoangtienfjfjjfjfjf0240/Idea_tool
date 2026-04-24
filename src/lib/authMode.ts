export function isAuthDisabled() {
  return process.env.NEXT_PUBLIC_DISABLE_AUTH !== 'false';
}

export function isLocalHostname(hostname?: string | null) {
  if (!hostname) return false;
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function isHostnameAuthDisabled(hostname?: string | null) {
  return isAuthDisabled() || isLocalHostname(hostname);
}

export function isClientAuthDisabled() {
  if (isAuthDisabled()) return true;
  if (typeof window === 'undefined') return false;
  return isLocalHostname(window.location.hostname);
}
