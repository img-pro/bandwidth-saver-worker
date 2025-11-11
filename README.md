# Image CDN Worker for WordPress

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com/)

Cloudflare Worker that caches WordPress images in R2 and serves them globally via CDN.

Part of the [Image CDN by ImgPro](https://github.com/img-pro/wp-image-cdn) WordPress plugin.

## Overview

This worker acts as a caching proxy for WordPress images:
1. Fetches images from WordPress origin servers
2. Stores them in Cloudflare R2
3. Redirects to R2 public CDN URL
4. Future requests bypass the worker entirely (served from R2 CDN)

**Result:** 99% of traffic served directly from R2 with zero worker invocations.

## Features

- ✅ **Origin Fetch** - Pull images from any WordPress site
- ✅ **R2 Caching** - Permanent storage in Cloudflare R2
- ✅ **Public CDN** - Direct serving via R2's public bucket
- ✅ **Smart Routing** - First request caches, subsequent requests bypass worker
- ✅ **CORS Support** - Configurable cross-origin resource sharing
- ✅ **Image Validation** - Verify content types and file sizes
- ✅ **Hotlink Protection** - Optional domain whitelist
- ✅ **Error Handling** - Graceful fallbacks for failed requests

## How It Works

```
First Request:
Browser → worker.yourdomain.com → WordPress Origin
              ↓
          R2 Storage
              ↓
     Redirect to cdn.yourdomain.com

Subsequent Requests:
Browser → cdn.yourdomain.com (Direct from R2)
```

**Key Point:** After the first request, images are served directly from R2's CDN. The worker is never invoked again for that image.

## URL Structure

### Worker URL (First Request Only)
```
https://worker.yourdomain.com/{origin-domain}/{path}
```

### CDN URL (Cached, Direct Access)
```
https://cdn.yourdomain.com/{origin-domain}/{path}
```

### Example Flow

**Original WordPress Image:**
```
https://example.com/wp-content/uploads/2024/01/photo.jpg
```

**First Request (via Worker):**
```
https://worker.yourdomain.com/example.com/wp-content/uploads/2024/01/photo.jpg
→ Fetches from origin
→ Stores in R2
→ Redirects to CDN URL
```

**Future Requests (Direct CDN):**
```
https://cdn.yourdomain.com/example.com/wp-content/uploads/2024/01/photo.jpg
→ Served instantly from R2 (no worker invocation)
```

## Prerequisites

- Cloudflare account
- Node.js 18+ installed
- Wrangler CLI (`npm install -g wrangler`)
- Domain on Cloudflare (for custom domains)

## Installation

### 1. Clone Repository

```bash
git clone https://github.com/img-pro/wp-image-cdn-worker.git
cd wp-image-cdn-worker
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create R2 Bucket

```bash
# Login to Cloudflare
wrangler login

# Create R2 bucket
wrangler r2 bucket create imgpro-cdn

# Enable public access via Cloudflare Dashboard:
# R2 → imgpro-cdn → Settings → Public Access → Enable
# Custom Domain → cdn.yourdomain.com
```

### 4. Configure Worker

Copy example configuration:
```bash
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml`:
```toml
name = "image-cdn-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# R2 Bucket Binding
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "imgpro-cdn"

# Environment Variables
[vars]
CDN_DOMAIN = "cdn.yourdomain.com"    # Your R2 public domain
ALLOWED_ORIGINS = "*"                 # Or comma-separated domains
MAX_FILE_SIZE = "50MB"               # Maximum image size
FETCH_TIMEOUT = "30000"              # 30 seconds
DEBUG = "false"                      # Enable debug logging
```

### 5. Deploy Worker

**Test Deployment:**
```bash
npm run deploy
```

**Add Custom Domain:**
```
Cloudflare Dashboard → Workers & Pages → image-cdn-worker
→ Settings → Triggers → Add Custom Domain
→ worker.yourdomain.com
```

## Configuration

### Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `CDN_DOMAIN` | R2 public bucket domain | Required | `cdn.yourdomain.com` |
| `ALLOWED_ORIGINS` | CORS allowed origins | `"*"` | `"example.com,site.com"` |
| `MAX_FILE_SIZE` | Maximum file size | `"50MB"` | `"100MB"` |
| `FETCH_TIMEOUT` | Origin fetch timeout (ms) | `"30000"` | `"60000"` |
| `DEBUG` | Enable debug logging | `"false"` | `"true"` |

### R2 Bucket Setup

1. **Create Bucket:**
   ```bash
   wrangler r2 bucket create imgpro-cdn
   ```

2. **Enable Public Access:**
   - Cloudflare Dashboard → R2 → imgpro-cdn
   - Settings → Public Access → Allow
   - Add Custom Domain: `cdn.yourdomain.com`

3. **Verify DNS:**
   ```bash
   dig cdn.yourdomain.com
   # Should point to Cloudflare R2
   ```

## Development

### Local Development

```bash
npm run dev
```

Worker available at `http://localhost:8787`

### Test Locally

```bash
# Test image fetch
curl http://localhost:8787/example.com/wp-content/uploads/image.jpg
```

### View Logs

```bash
wrangler tail
```

### TypeScript

Worker is written in TypeScript for type safety:

```typescript
// src/types.ts
export interface Env {
  R2_BUCKET: R2Bucket;
  CDN_DOMAIN: string;
  ALLOWED_ORIGINS?: string;
  MAX_FILE_SIZE?: string;
  FETCH_TIMEOUT?: string;
  DEBUG?: string;
}
```

## WordPress Plugin Integration

This worker is designed to work with the [Image CDN WordPress plugin](https://github.com/img-pro/wp-image-cdn).

**Plugin automatically:**
- Rewrites image URLs to use your CDN domain
- Adds fallback to worker domain on CDN failures
- Handles srcset and responsive images
- Provides debug mode for troubleshooting

**Manual URL Rewriting (if not using plugin):**
```php
// Replace WordPress image URLs
function my_cdn_url($url) {
    if (preg_match('/\.(jpg|jpeg|png|gif|webp)$/i', $url)) {
        $parsed = parse_url($url);
        $path = $parsed['host'] . $parsed['path'];
        return 'https://cdn.yourdomain.com/' . $path;
    }
    return $url;
}
add_filter('wp_get_attachment_url', 'my_cdn_url');
```

## Performance

**Metrics:**
- **Worker invocations:** ~1% of requests (cache misses only)
- **R2 direct access:** ~99% of requests
- **Cache miss latency:** 200-400ms (first request)
- **Cache hit latency:** 20-40ms (direct from R2)
- **Global coverage:** 300+ edge locations

## Cost Optimization

**Cloudflare Free Tier:**
- R2 Storage: 10 GB free
- R2 Operations: 1M reads/month free
- Worker Requests: 100k/day free
- Zero egress fees

**Typical Costs:**
- Small site (100k views/month): **$0/month**
- Medium site (500k views/month): **$0-2/month**
- Large site (3M views/month): **$0.68/month**

## Security

**Built-in Protections:**
- Image content-type validation
- File size limits
- Optional domain whitelist
- CORS configuration
- Error handling

**Recommended Settings:**
```toml
[vars]
ALLOWED_ORIGINS = "yourdomain.com,www.yourdomain.com"
MAX_FILE_SIZE = "50MB"
```

## Troubleshooting

### Images Not Caching

**Check:**
1. R2 bucket exists: `wrangler r2 bucket list`
2. Public access enabled (Dashboard → R2 → Settings)
3. Custom domain configured
4. DNS propagated: `dig cdn.yourdomain.com`

### CORS Errors

**Fix:**
```toml
[vars]
ALLOWED_ORIGINS = "*"  # Or specific domains
```

### Worker Errors

**View logs:**
```bash
wrangler tail
```

**Enable debug mode:**
```toml
[vars]
DEBUG = "true"
```

## Project Structure

```
wp-image-cdn-worker/
├── src/
│   ├── index.ts          # Main worker entry
│   ├── cache.ts          # R2 caching logic
│   ├── origin.ts         # Origin fetch
│   ├── validation.ts     # Image validation
│   ├── analytics.ts      # Analytics helpers
│   ├── utils.ts          # Utilities
│   ├── viewer.ts         # Debug viewer
│   └── types.ts          # TypeScript types
├── wrangler.toml.example # Configuration template
├── tsconfig.json         # TypeScript config
├── package.json          # Dependencies
└── README.md            # This file
```

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related Projects

- **WordPress Plugin:** [wp-image-cdn](https://github.com/img-pro/wp-image-cdn)

## Support

- **GitHub Issues:** https://github.com/img-pro/wp-image-cdn-worker/issues
- **WordPress Support:** https://wordpress.org/support/plugin/imgpro/

---

**Built with ❤️ by [ImgPro](https://img.pro)**
