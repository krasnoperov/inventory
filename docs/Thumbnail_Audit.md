# Thumbnail Audit

> TODO: Think about thumbnail sizes - consider if 512px is optimal or if we need different sizes for different contexts.

## Current Thumbnail Generation

Thumbnails are generated at **512x512px** in WebP format with:
- `fit: cover`
- `gravity: auto` (saliency-based smart crop)
- `quality: 80`

Generated in `src/backend/services/generationConsumer.ts` using Cloudflare Image Resizing.

## Component Thumbnail Sizes

| Component | Location | CSS Size | Actual px | 512px Coverage |
|-----------|----------|----------|-----------|----------------|
| **AssetCard** | Main grid (SpacePage) | `--thumb-size-lg` | 150-280px | 1.8-3.4x |
| **AssetDetailPage** | Variant strip | `--thumb-size-lg` | 150px | 3.4x |
| **AssetDetailPage** | Mobile variants | `--thumb-size-sm` | 75px | 6.8x |
| **AssetDetailPage** | Child asset grid | `--thumb-size-lg` | 150px | 3.4x |
| **ForgeTray** | Input slots | `--forge-slot-size` | 75px | 6.8x |
| **ForgeSlots** | Standalone slots | `--forge-slot-size` | 75px | 6.8x |
| **AssetPickerModal** | Asset grid | `--thumb-size-sm` | 75px | 6.8x |
| **AssetPicker** | Dropdown | `--thumb-size-xs` | 48px | 10.6x |
| **LineageTree** | Parent/child nodes | `--thumb-size-sm` | 75px | 6.8x |
| **LineageTree** | Current (center) | `--thumb-size-md` | 100px | 5.1x |
| **LineageTree** | Graph nodes | `--thumb-size-sm` | 75px | 6.8x |
| **ChatSidebar** | Context thumb | hardcoded | 48px | 10.6x |
| **ChatSidebar** | Message images | max-width | 200px | 2.6x |

## CSS Variables

Defined in `src/frontend/styles/theme.css`:

```css
--thumb-size-lg: 150px;   /* Main asset cards, variants */
--thumb-size-md: 100px;   /* Lineage current image */
--thumb-size-sm: 75px;    /* Forge slots, lineage nodes */
--thumb-size-xs: 48px;    /* Tiny previews, picker items */
--forge-slot-size: var(--thumb-size-sm);  /* 75px */
```

## DPR Coverage Analysis

For high-DPI displays:

| Display Size | 1x DPR | 2x DPR | 3x DPR |
|--------------|--------|--------|--------|
| 150px (lg) | 150px | 300px | 450px |
| 100px (md) | 100px | 200px | 300px |
| 75px (sm) | 75px | 150px | 225px |
| 48px (xs) | 48px | 96px | 144px |
| 280px (stretched) | 280px | 560px | 840px |

**512px thumbnail provides:**
- Perfect coverage for 2x DPR at all sizes
- Good coverage for 3x DPR up to ~170px display size
- Acceptable quality for 3x DPR at larger sizes (stretched grid)

## Fallback Behavior

When `thumb_key` is missing (older variants or failed generation), components fall back to `image_key` (full resolution image).

Helper function in `src/frontend/hooks/useSpaceWebSocket.ts`:
```typescript
export function getVariantThumbnailUrl(variant: Variant): string {
  return `/api/images/${variant.thumb_key || variant.image_key}`;
}
```
