/**
 * Returns a proxied icon URL for app icons from Apple/Google CDNs.
 * This bypasses hotlink protection that causes broken images.
 */
export function getProxiedIconUrl(iconUrl: string): string {
  if (!iconUrl || !iconUrl.startsWith('http')) return iconUrl;
  
  // Check if it's from a known CDN that needs proxying
  const needsProxy = 
    iconUrl.includes('mzstatic.com') || 
    iconUrl.includes('googleusercontent.com');
  
  if (!needsProxy) return iconUrl;
  
  return `/api/proxy-icon?url=${encodeURIComponent(iconUrl)}`;
}
