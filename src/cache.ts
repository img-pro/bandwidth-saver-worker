/**
 * R2 cache operations with streaming support
 */

import type { Env } from './types';
import { getCORSHeaders } from './utils';

/**
 * Store image in R2 cache with streaming support
 */
export async function storeInCache(
  env: Env,
  cacheKey: string,
  imageData: ArrayBuffer | ReadableStream,
  contentType: string,
  sourceUrl: string,
  domain: string
): Promise<void> {
  const cachedAt = new Date().toISOString();

  await env.R2.put(cacheKey, imageData, {
    httpMetadata: {
      contentType: contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      sourceUrl: sourceUrl,
      domain: domain,
      cachedAt: cachedAt,
    },
  });
}

/**
 * Get cached image from R2
 */
export async function getFromCache(
  env: Env,
  cacheKey: string
): Promise<R2ObjectBody | null> {
  return await env.R2.get(cacheKey);
}

/**
 * Get cache metadata without downloading the full object
 */
export async function getCacheHead(
  env: Env,
  cacheKey: string
): Promise<R2Object | null> {
  return await env.R2.head(cacheKey);
}

/**
 * Delete image from cache
 */
export async function deleteFromCache(
  env: Env,
  cacheKey: string
): Promise<void> {
  await env.R2.delete(cacheKey);
}

/**
 * Handle HEAD request for cached image
 */
export async function handleHeadRequest(
  env: Env,
  cacheKey: string
): Promise<Response> {
  const cached = await getCacheHead(env, cacheKey);

  if (cached) {
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': cached.httpMetadata?.contentType || 'image/jpeg',
        'Content-Length': cached.size.toString(),
        'ETag': cached.etag,
        'Last-Modified': cached.uploaded.toUTCString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-ImgPro-Status': 'cached',
        'X-ImgPro-Cached-At': cached.customMetadata?.cachedAt || '',
        ...getCORSHeaders(),
      },
    });
  }

  return new Response(null, {
    status: 404,
    headers: getCORSHeaders(),
  });
}

/**
 * Check ETag for conditional requests
 */
export function handleConditionalRequest(
  request: Request,
  etag: string
): Response | null {
  const ifNoneMatch = request.headers.get('If-None-Match');

  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': etag,
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...getCORSHeaders(),
      },
    });
  }

  return null;
}
