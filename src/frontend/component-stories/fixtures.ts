import type { Asset, Variant } from '../hooks/useSpaceWebSocket';

// Mock data factories for stories. Keep these minimal but type-accurate so
// stories exercise the real component code paths without a backend.

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

/**
 * Build a Variant in any lifecycle state. Defaults to a pending image variant;
 * override `status` / `media_kind` / keys to reach completed / failed / audio /
 * video states. Note: a "completed" image's thumbnail resolves to /api/images/…,
 * which won't load in the static Ladle preview — the placeholder/loading/failed
 * states are the ones that render fully there.
 */
export function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: nextId('variant'),
    asset_id: 'asset-1',
    media_kind: 'image',
    workflow_id: null,
    status: 'pending',
    error_message: null,
    image_key: null,
    thumb_key: null,
    media_key: null,
    media_mime_type: null,
    media_size_bytes: null,
    media_width: null,
    media_height: null,
    media_duration_ms: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: 0,
    updated_at: null,
    description: null,
    ...overrides,
  };
}

/** Build an Asset. Defaults to a root image asset; override parent_asset_id /
 *  active_variant_id / type to nest or point at a specific variant. */
export function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: nextId('asset'),
    name: 'Hero Character',
    type: 'character',
    media_kind: 'image',
    tags: '',
    parent_asset_id: null,
    active_variant_id: null,
    created_by: 'user-1',
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}
