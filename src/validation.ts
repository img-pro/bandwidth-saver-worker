/**
 * URL parsing and validation functions
 */

import type { ParsedUrl } from './types';

/**
 * Parse URL to extract domain, path, cache key, and parameters
 */
export function parseUrl(url: URL): ParsedUrl {
  const decodedPathname = decodeURIComponent(url.pathname);
  const pathParts = decodedPathname.replace(/^\/+/, '').split('/');

  if (pathParts.length < 2) {
    throw new Error('Invalid URL format: /domain.com/path/to/image.jpg');
  }

  const domain = pathParts[0];
  const path = '/' + pathParts.slice(1).join('/');

  if (!isValidDomain(domain)) {
    throw new Error(`Invalid domain: ${domain}`);
  }

  const encodedPath = path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  const sourceUrl = `https://${domain}${encodedPath}`;

  const cacheKey = `${domain}${path}`;

  const forceReprocess = url.searchParams.get('force') === 'true' ||
                         url.searchParams.get('force') === '1';

  const viewImage = url.searchParams.get('view') === 'true' ||
                    url.searchParams.get('view') === '1';

  return { domain, path, sourceUrl, cacheKey, forceReprocess, viewImage };
}

/**
 * Validate domain format
 */
export function isValidDomain(domain: string): boolean {
  // Allow localhost and IP addresses
  if (domain === 'localhost' || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
    return true;
  }

  // Validate standard domain format
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i.test(domain);
}

/**
 * Check if origin is allowed
 */
export function isAllowedOrigin(sourceUrl: string, allowedOrigins: string): boolean {
  if (allowedOrigins === '*') return true;

  try {
    const url = new URL(sourceUrl);
    const origins = allowedOrigins.split(',').map(o => o.trim().toLowerCase());

    return origins.some(origin => {
      if (origin === '*') return true;
      if (origin.startsWith('*.')) {
        return url.hostname.endsWith(origin.substring(2));
      }
      return url.hostname === origin;
    });
  } catch {
    return false;
  }
}

/**
 * Check if content type is an image
 */
export function isImageContentType(contentType: string): boolean {
  // Handle missing content-type
  if (!contentType) return false;

  const imageTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
    'image/webp', 'image/avif', 'image/svg+xml',
    'image/bmp', 'image/tiff', 'image/x-icon',
    'image/heic', 'image/heif', 'image/jxl'
  ];

  return imageTypes.some(type => contentType.toLowerCase().includes(type));
}
