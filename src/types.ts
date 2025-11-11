/**
 * Environment bindings and configuration
 */
export interface Env {
  R2: R2Bucket;
  ALLOWED_ORIGINS?: string;
  CDN_DOMAIN?: string;
  DEBUG?: string;
  MAX_FILE_SIZE?: string;
  FETCH_TIMEOUT?: string;
  ORIGIN_USER_AGENT?: string;
}

/**
 * Parsed URL information
 */
export interface ParsedUrl {
  domain: string;
  path: string;
  sourceUrl: string;
  cacheKey: string;
  forceReprocess: boolean;
  viewImage: boolean;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  errors: number;
  totalSize: number;
}

/**
 * Log entry for debugging
 */
export interface LogEntry {
  time: string;
  action: string;
  details?: string;
}

/**
 * HTML viewer options
 */
export interface HtmlViewerOptions {
  imageData: ArrayBuffer;
  contentType: string;
  status: string;
  imageSize: number;
  sourceUrl: string;
  cdnUrl: string;
  cacheKey: string;
  cachedAt?: string;
  processingTime: number;
  logs: LogEntry[];
  env: Env;
}
