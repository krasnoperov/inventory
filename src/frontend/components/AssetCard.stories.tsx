import type { Story, StoryDefault } from '../component-stories/ladle-types';
import { makeAsset, makeVariant } from '../component-stories/fixtures';
import { AssetCard } from './AssetCard';

export default { title: 'Components / AssetCard' } satisfies StoryDefault;

// Completed image variants render via the /api/images route-mock in the
// style-reference capture (broken image in the dev `stories` server).
const completedImage = (assetId: string) =>
  makeVariant({
    asset_id: assetId,
    status: 'completed',
    image_key: `${assetId}.png`,
    thumb_key: `${assetId}-thumb.png`,
    media_width: 400,
    media_height: 400,
  });

function scene(): {
  asset: ReturnType<typeof makeAsset>;
  variants: ReturnType<typeof makeVariant>[];
} {
  const root = makeAsset({ id: 'hero', name: 'Hero Character', type: 'character' });
  const heroVariant = completedImage('hero');
  root.active_variant_id = heroVariant.id;

  return {
    asset: root,
    variants: [heroVariant],
  };
}

export const Default: Story = () => {
  const { asset, variants } = scene();
  return (
    <AssetCard
      asset={asset}
      variants={variants}
      spaceId="space-1"
      canEdit
    />
  );
};

export const Leaf: Story = () => {
  const root = makeAsset({ id: 'scene', name: 'Forest Backdrop', type: 'scene' });
  const variant = completedImage('scene');
  root.active_variant_id = variant.id;
  return (
    <AssetCard
      asset={root}
      variants={[variant]}
      spaceId="space-1"
      canEdit
    />
  );
};
