# Media CDN

Make Effects stores generated and uploaded artifacts in R2. The application can
serve immutable image previews through an R2 custom domain instead of routing
every thumbnail request through the main Worker.

## Scope

This CDN path is for legacy immutable image keys only:

- `images/{spaceId}/{variantId}.{ext}`
- `images/{spaceId}/{variantId}_thumb.webp`
- `thumbs/...`
- `styles/...`

The app still falls back to `/api/images/{key}` when no CDN hostname is
configured. Canonical audio/video/private media routes continue to use
`/api/spaces/:spaceId/variants/:variantId/media`.

## Cloudflare Setup

1. Add an R2 custom domain such as `cdn.makefx.app` to the production media
   bucket (`makefx-media-production`).
2. Disable the bucket's public `r2.dev` development URL.
3. Configure Cloudflare cache rules for the custom domain so these immutable
   object paths are cached aggressively. Responses should carry:

   ```http
   Cache-Control: public, max-age=31536000, immutable
   ```

4. Keep the production Worker environment variable in `wrangler.toml`:

   ```text
   MAKEFX_MEDIA_CDN_BASE_URL=https://cdn.makefx.app
   ```

Stage/local environments intentionally leave this unset until their R2 custom
domains exist; they continue using `/api/images/{key}` as a fallback.

## Privacy Model

This is intentionally a simple CDN path. The object names use unguessable Space
and variant IDs, bucket listing is not exposed, and users will only receive URLs
for media that appears in spaces they can open.

The URL is still a bearer URL: anyone who obtains the exact CDN URL can fetch
the object while it exists and remains cached. That is acceptable for normal
immutable previews and image artifacts. Use the authenticated variant media
route, or a future signed media-cookie Worker, for content that needs strict
revocation semantics.
