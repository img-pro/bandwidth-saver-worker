/**
 * Origin fetching with timeout, redirects, and streaming support
 */

import type { Env } from './types';

/**
 * Fetch image from origin with timeout and redirect support
 */
export async function fetchFromOrigin(
  url: string,
  env: Env,
  timeout?: number
): Promise<Response> {
  const fetchTimeout = timeout || parseInt(env.FETCH_TIMEOUT || '30000');
  const userAgent = env.ORIGIN_USER_AGENT || 'ImgPro/1.0.3 CDN Cache';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
      },
      redirect: 'follow',
      // @ts-ignore - follow is not in TypeScript types but works in runtime
      follow: 5, // Max 5 redirects
    });

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
 * Fetch image data as ArrayBuffer with size validation
 */
export async function fetchImageData(
  response: Response,
  maxSize: number
): Promise<ArrayBuffer> {
  // Check content-length header first if available
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const size = parseInt(contentLength);
    if (size > maxSize) {
      throw new Error(`File too large: ${size} bytes (max ${maxSize} bytes)`);
    }
  }

  // Fetch the data
  const imageData = await response.arrayBuffer();

  // Validate actual size
  if (imageData.byteLength > maxSize) {
    throw new Error(`File too large: ${imageData.byteLength} bytes (max ${maxSize} bytes)`);
  }

  return imageData;
}
