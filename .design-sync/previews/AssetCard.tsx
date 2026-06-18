import { AssetCard } from 'makefx';

// Use 'processing' variants so child thumbnails render their generating state
// (the design tool has no media server to load completed images from).
const variant = (id) => ({
  id: `${id}-v`, asset_id: id, media_kind: 'image', workflow_id: null, status: 'processing',
  error_message: null, image_key: null, thumb_key: null, media_key: null, media_mime_type: null,
  media_size_bytes: null, media_width: null, media_height: null, media_duration_ms: null,
  recipe: '{}', starred: false, created_by: 'u', created_at: 0, updated_at: null, description: null,
});
const asset = (id, name, type, parent) => ({
  id, name, type, media_kind: 'image', tags: '', parent_asset_id: parent,
  active_variant_id: `${id}-v`, created_by: 'u', created_at: 0, updated_at: 0,
});

export const WithChildren = () => {
  const hero = asset('hero', 'Hero Character', 'character', null);
  const sword = asset('sword', 'Iron Sword', 'item', 'hero');
  const shield = asset('shield', 'Round Shield', 'item', 'hero');
  return (
    <AssetCard
      asset={hero}
      variants={[variant('hero')]}
      childAssets={[sword, shield]}
      allAssets={[hero, sword, shield]}
      allVariants={[variant('hero'), variant('sword'), variant('shield')]}
      spaceId="space-1"
      canEdit
    />
  );
};

export const Leaf = () => {
  const scene = asset('scene', 'Forest Backdrop', 'scene', null);
  return (
    <AssetCard
      asset={scene}
      variants={[variant('scene')]}
      childAssets={[]}
      allAssets={[scene]}
      allVariants={[variant('scene')]}
      spaceId="space-1"
      canEdit
    />
  );
};
