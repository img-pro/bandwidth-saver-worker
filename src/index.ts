/**
 * ImgPro - CDN Worker
 *
 * Single-domain CDN architecture: serves images directly from the worker.
 * - Cache hit: Returns image from R2 with long cache headers
 * - Cache miss: Fetches from origin, stores in R2, returns image
 *
 * No separate R2 public bucket domain needed - the worker IS the CDN.
 *
 * @version 1.1.0
 */

import type { Env, LogEntry } from './types';
import { parseUrl, isAllowedOrigin, isImageContentType } from './validation';
import { fetchFromOrigin, fetchImageData } from './origin';
import {
  getFromCache,
  handleHeadRequest,
  handleConditionalRequest,
  storeInCache,
  deleteFromCache,
} from './cache';
import { createHtmlViewer } from './viewer';
import { createStatsResponse, createLogger } from './analytics';
import { errorResponse, getCORSHeaders, formatBytes, parseFileSize } from './utils';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCORSHeaders(),
      });
    }

    // Health check
    if (url.pathname === '/health' || url.pathname === '/ping') {
      return new Response(JSON.stringify({
        status: 'healthy',
        version: '1.1.0',
        timestamp: new Date().toISOString(),
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...getCORSHeaders(),
        },
      });
    }

    // Stats endpoint
    if (url.pathname === '/stats') {
      return createStatsResponse(env);
    }

    try {
      // Parse URL: /example.com/wp-content/uploads/photo.jpg
      const parsed = parseUrl(url);

      // Workflow logs for HTML viewer
      const logs: LogEntry[] = [];
      const startTime = Date.now();
      const addLog = createLogger(logs, startTime, env.DEBUG === 'true');

      addLog('Request received', `${request.method} ${parsed.domain}${parsed.path}`);

      // Handle DELETE request (cache invalidation)
      if (request.method === 'DELETE') {
        addLog('DELETE request', 'Invalidating cache');

        const cached = await getFromCache(env, parsed.cacheKey);
        if (!cached) {
          return errorResponse('Image not found in cache', 404);
        }

        await deleteFromCache(env, parsed.cacheKey);
        addLog('Cache invalidated', 'Image deleted from R2');

        return new Response(JSON.stringify({
          success: true,
          message: 'Image deleted from cache',
          cacheKey: parsed.cacheKey,
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...getCORSHeaders(),
          },
        });
      }

      // Handle HEAD request
      if (request.method === 'HEAD') {
        addLog('HEAD request', 'Checking cache without download');
        return await handleHeadRequest(env, parsed.cacheKey);
      }

      // Only GET requests beyond this point
      if (request.method !== 'GET') {
        return errorResponse('Method not allowed', 405);
      }

      // Validate origin
      const allowedOrigins = env.ALLOWED_ORIGINS || '*';
      if (!isAllowedOrigin(parsed.sourceUrl, allowedOrigins)) {
        return errorResponse('Origin not allowed', 403);
      }
      addLog('Origin validated', allowedOrigins === '*' ? 'All origins allowed' : allowedOrigins);

      // Check R2 cache (skip if force parameter is set)
      if (!parsed.forceReprocess) {
        const cached = await getFromCache(env, parsed.cacheKey);
        if (cached) {
          addLog('Cache HIT', parsed.cacheKey);

          // Check ETag for conditional request (304 Not Modified)
          const conditionalResponse = handleConditionalRequest(request, cached.etag);
          if (conditionalResponse) {
            addLog('Conditional request', '304 Not Modified');
            return conditionalResponse;
          }

          const imageContentType = cached.httpMetadata?.contentType || 'image/jpeg';
          const metadata = cached.customMetadata || {};

          // If view parameter is set, return HTML viewer
          if (parsed.viewImage) {
            const imageData = await cached.arrayBuffer();
            const totalTime = Date.now() - startTime;
            addLog('Generating HTML viewer', `${imageData.byteLength} bytes in ${totalTime}ms`);

            return createHtmlViewer({
              imageData,
              contentType: imageContentType,
              status: 'cached',
              imageSize: imageData.byteLength,
              sourceUrl: parsed.sourceUrl,
              cdnUrl: request.url.split('?')[0], // Current URL without query params
              cacheKey: parsed.cacheKey,
              cachedAt: metadata.cachedAt,
              processingTime: totalTime,
              logs,
              env
            });
          }

          // Return the actual image with long cache headers
          addLog('Serving image', `${cached.size} bytes, ${imageContentType}`);
          return new Response(cached.body, {
            status: 200,
            headers: {
              'Content-Type': imageContentType,
              'Content-Length': cached.size.toString(),
              'Cache-Control': 'public, max-age=31536000, immutable',
              'ETag': cached.etag,
              'Last-Modified': cached.uploaded.toUTCString(),
              'X-ImgPro-Status': 'hit',
              'X-ImgPro-Cached-At': metadata.cachedAt || '',
              ...getCORSHeaders(),
            },
          });
        }
      } else {
        addLog('Cache bypass', 'Force reprocess requested');
      }

      // Cache miss (or forced reprocess) - fetch from origin
      addLog('Cache MISS', `Fetching from origin: ${parsed.sourceUrl}`);

      const response = await fetchFromOrigin(parsed.sourceUrl, env);

      if (!response.ok) {
        addLog('Origin fetch failed', `HTTP ${response.status}: ${response.statusText}`);
        if (response.status === 404) {
          return errorResponse(
            `Image not found: ${parsed.sourceUrl}`,
            404
          );
        } else {
          return errorResponse(
            `Origin error ${response.status}: ${response.statusText}`,
            503
          );
        }
      }

      addLog('Origin fetch success', `HTTP ${response.status}`);

      // Validate content type
      const contentType = response.headers.get('Content-Type') || '';
      if (!isImageContentType(contentType)) {
        addLog('Content type validation failed', contentType);
        return errorResponse(`Not an image: ${contentType}`, 415);
      }

      addLog('Content type validated', contentType);

      // Parse max file size
      const maxSize = parseFileSize(env.MAX_FILE_SIZE || '50MB');

      // Fetch image data with size validation
      let imageData: ArrayBuffer;
      try {
        imageData = await fetchImageData(response, maxSize);
        addLog('Image data fetched', `${formatBytes(imageData.byteLength)}`);
      } catch (error) {
        addLog('File size exceeded', error instanceof Error ? error.message : 'Unknown error');
        return errorResponse(
          error instanceof Error ? error.message : 'File too large',
          413
        );
      }

      // Store in R2
      await storeInCache(
        env,
        parsed.cacheKey,
        imageData,
        contentType,
        parsed.sourceUrl,
        parsed.domain
      );

      const cdnUrl = request.url.split('?')[0]; // Current URL without query params
      addLog('Stored in R2', `${formatBytes(imageData.byteLength)}`);

      // If view parameter is set, return HTML viewer
      if (parsed.viewImage) {
        const totalTime = Date.now() - startTime;
        addLog('Generating HTML viewer', `Processing complete in ${totalTime}ms`);

        return createHtmlViewer({
          imageData,
          contentType,
          status: 'fetched',
          imageSize: imageData.byteLength,
          sourceUrl: parsed.sourceUrl,
          cdnUrl,
          cacheKey: parsed.cacheKey,
          cachedAt: new Date().toISOString(),
          processingTime: totalTime,
          logs,
          env
        });
      }

      // Return the actual image (just fetched and cached)
      addLog('Serving image', `${formatBytes(imageData.byteLength)}, ${contentType}`);
      return new Response(imageData, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': imageData.byteLength.toString(),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-ImgPro-Status': 'miss',
          ...getCORSHeaders(),
        },
      });

    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Unknown error',
        500
      );
    }
  },
};
