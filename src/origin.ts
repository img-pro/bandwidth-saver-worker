/**
 * Origin fetching with timeout, redirects, and security validation
 *
 * PHILOSOPHY: Transparent CDN identity over WAF evasion
 * - Use honest User-Agent identifying the service
 * - Minimal headers, no browser fingerprint spoofing
 * - Rely on caching to minimize origin requests
 * - Let customers whitelist if their origin blocks us
 *
 * SECURITY: Validates redirects to prevent SSRF attacks.
 */

import type { Env } from './types';
import { validateUrlForFetch } from './validation';

/**
 * Fallback headers when user headers aren't available
 *
 * Used for non-browser requests (bots, curl, monitoring).
 * Identifies us honestly as a CDN service.
 */
const FALLBACK_HEADERS = {
  'User-Agent': 'ImgPro/1.0 (+https://img.pro/cdn)',
  'Accept': 'image/*',
} as const;

/**
 * Minimal headers to forward from user requests
 *
 * PHILOSOPHY: Forward real user data, don't fabricate.
 * - User-Agent: Real browser (natural variety)
 * - Accept: Content negotiation (what formats they support)
 * - Accept-Language: Language preference
 * - Referer: Where the image is embedded (helps bypass anti-hotlinking)
 *
 * NOT forwarded (by design):
 * - sec-ch-*: Client hints (WAF evasion territory)
 * - sec-fetch-*: Fetch metadata (inaccurate - we're a proxy)
 * - Cookie/Auth: Security risk
 *
 * NOTE: Use Pascal-Case to match FALLBACK_HEADERS. The Headers API
 * (request.headers.get) is case-insensitive, so this works for reading.
 * Using consistent casing prevents duplicate keys when objects are merged.
 */
const FORWARDED_HEADERS = [
  'User-Agent',
  'Accept',
  'Accept-Language',
  'Referer',  // Where the image is embedded (anti-hotlinking bypass)
] as const;

/**
 * Headers that must NEVER be forwarded (security)
 */
const BLOCKED_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'host',
  'connection',
  'upgrade',
  'te',
  'transfer-encoding',
]);

/**
 * Extract minimal headers from client request
 *
 * Returns real user headers when available, empty object otherwise.
 */
function getForwardedHeaders(clientRequest?: Request): Record<string, string> {
  if (!clientRequest) {
    return {};
  }

  const forwarded: Record<string, string> = {};

  for (const header of FORWARDED_HEADERS) {
    const value = clientRequest.headers.get(header);
    if (value) {
      forwarded[header] = value;
    }
  }

  return forwarded;
}

export interface FetchResult {
  response: Response;
  blocked: boolean;
  blockReason?: string;
}

/**
 * Detect if response is a block/challenge page instead of actual content
 *
 * WAFs often return 200 OK with HTML challenge pages.
 * This detects common patterns to avoid caching garbage.
 */
function detectBlockedResponse(response: Response, expectedType: 'image'): {
  blocked: boolean;
  reason?: string;
} {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const contentLength = response.headers.get('content-length');

  // Check for common WAF block status codes first
  if (response.status === 403 || response.status === 401) {
    return { blocked: true, reason: `http_${response.status}` };
  }

  // Check for rate limiting
  if (response.status === 429) {
    return { blocked: true, reason: 'rate_limited' };
  }

  // If we expected an image, validate content-type
  if (expectedType === 'image') {
    // HTML response = challenge/block page
    if (contentType.includes('text/html')) {
      // Small HTML responses are almost certainly challenge/block pages
      if (contentLength && parseInt(contentLength, 10) < 50000) {
        return { blocked: true, reason: 'html_challenge_page' };
      }
      return { blocked: true, reason: 'html_instead_of_image' };
    }

    // Any text/* response is wrong for images
    if (contentType.startsWith('text/')) {
      return { blocked: true, reason: 'text_instead_of_image' };
    }

    // JSON response (common for API errors)
    if (contentType.includes('application/json')) {
      return { blocked: true, reason: 'json_instead_of_image' };
    }

    // Must be image/* content-type (if present)
    if (contentType && !contentType.startsWith('image/')) {
      return { blocked: true, reason: 'non_image_content_type' };
    }
  }

  return { blocked: false };
}

/**
 * Fetch image from origin with timeout, redirect support, and security validation
 *
 * @param url - The source URL to fetch
 * @param env - Environment bindings
 * @param clientRequest - Optional original client request (for safe header forwarding)
 * @param timeout - Optional custom timeout in ms
 * @param validateRedirect - Optional function to validate the final URL after redirects
 * @returns FetchResult with response and block detection
 * @throws Error if timeout, invalid redirect, or fetch fails
 */
export async function fetchFromOrigin(
  url: string,
  env: Env,
  clientRequest?: Request,
  timeout?: number,
  validateRedirect?: (finalUrl: string) => Promise<boolean>
): Promise<Response> {
  // Validate URL before fetch (SSRF protection)
  const urlValidation = validateUrlForFetch(url);
  if (!urlValidation.valid) {
    throw new Error(`Invalid URL: ${urlValidation.reason}`);
  }

  const fetchTimeout = timeout || parseInt(env.FETCH_TIMEOUT || '30000', 10);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

  // Get minimal headers from user request
  const forwardedHeaders = getForwardedHeaders(clientRequest);

  // Build headers: fallbacks (for non-browser) + user headers (override if present)
  const headers: Record<string, string> = {
    ...FALLBACK_HEADERS,
    ...forwardedHeaders,
  };

  // Allow env override for User-Agent (for specific origin requirements)
  // This should be used sparingly and documented
  if (env.ORIGIN_USER_AGENT) {
    headers['User-Agent'] = env.ORIGIN_USER_AGENT;
  }

  // Optional: Forward client IP if explicitly enabled
  // Default: OFF (privacy + reduces proxy signals)
  if (env.FORWARD_CLIENT_IP === 'true' && clientRequest) {
    const clientIp = clientRequest.headers.get('cf-connecting-ip');
    if (clientIp) {
      headers['X-Forwarded-For'] = clientIp;
    }
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });

    // Security: Validate final URL after redirects
    const finalUrl = response.url;
    if (finalUrl && finalUrl !== url) {
      // URL changed due to redirect - validate the final destination
      const validation = validateUrlForFetch(finalUrl);

      if (!validation.valid) {
        throw new Error(`Redirect to invalid URL blocked: ${validation.reason}`);
      }

      // If custom validation provided (e.g., check against allowlist), use it
      if (validateRedirect) {
        const allowed = await validateRedirect(finalUrl);
        if (!allowed) {
          throw new Error(`Redirect to non-allowed origin blocked: ${finalUrl}`);
        }
      }
    }

    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${fetchTimeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch and validate image from origin
 *
 * Combines fetch with block detection and content validation.
 * Returns structured result indicating success or block reason.
 */
export async function fetchImageFromOrigin(
  url: string,
  env: Env,
  clientRequest?: Request,
  timeout?: number,
  validateRedirect?: (finalUrl: string) => Promise<boolean>
): Promise<FetchResult> {
  const response = await fetchFromOrigin(url, env, clientRequest, timeout, validateRedirect);

  // Detect if we got a block/challenge page
  const blockCheck = detectBlockedResponse(response, 'image');

  return {
    response,
    blocked: blockCheck.blocked,
    blockReason: blockCheck.reason,
  };
}

/**
 * Fetch image data as ArrayBuffer with size validation
 *
 * @param response - The fetch response
 * @param maxSize - Maximum allowed file size in bytes
 * @returns Image data as ArrayBuffer
 * @throws Error if file exceeds maxSize
 */
export async function fetchImageData(
  response: Response,
  maxSize: number
): Promise<ArrayBuffer> {
  // Check content-length header first if available
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > maxSize) {
      throw new Error(`File too large: ${size} bytes (max ${maxSize} bytes)`);
    }
  }

  // Fetch the data
  const imageData = await response.arrayBuffer();

  // Validate actual size (content-length can be spoofed or missing)
  if (imageData.byteLength > maxSize) {
    throw new Error(`File too large: ${imageData.byteLength} bytes (max ${maxSize} bytes)`);
  }

  return imageData;
}
