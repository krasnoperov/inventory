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
  childAssets: ReturnType<typeof makeAsset>[];
  allVariants: ReturnType<typeof makeVariant>[];
} {
  const root = makeAsset({ id: 'hero', name: 'Hero Character', type: 'character' });
  const heroVariant = completedImage('hero');
  root.active_variant_id = heroVariant.id;

  const sword = makeAsset({ id: 'sword', name: 'Iron Sword', type: 'item', parent_asset_id: 'hero' });
  const swordVariant = completedImage('sword');
  sword.active_variant_id = swordVariant.id;

  const shield = makeAsset({ id: 'shield', name: 'Round Shield', type: 'item', parent_asset_id: 'hero' });
  const shieldVariant = completedImage('shield');
  shield.active_variant_id = shieldVariant.id;

  return {
    asset: root,
    variants: [heroVariant],
    childAssets: [sword, shield],
    allVariants: [heroVariant, swordVariant, shieldVariant],
  };
}

export const WithChildren: Story = () => {
  const { asset, variants, childAssets, allVariants } = scene();
  return (
    <AssetCard
      asset={asset}
      variants={variants}
      childAssets={childAssets}
      allAssets={[asset, ...childAssets]}
      allVariants={allVariants}
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
      childAssets={[]}
      allAssets={[root]}
      allVariants={[variant]}
      spaceId="space-1"
      canEdit
    />
  );
};
