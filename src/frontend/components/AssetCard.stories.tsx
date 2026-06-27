import type { Story, StoryDefault } from '../component-stories/ladle-types';
import { makeAsset, makeVariant } from '../component-stories/fixtures';
import { AssetCard } from './AssetCard';

export default { title: 'Components / AssetCard' } satisfies StoryDefault;

const SILENT_WAV_KEY = 'media/story/audio-card.wav';

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

export const Audio: Story = () => {
  const asset = makeAsset({
    id: 'audio-cue',
    name: 'Merchant greeting',
    type: 'dialogue',
    media_kind: 'audio',
  });
  const variant = makeVariant({
    id: 'audio-cue-v1',
    asset_id: asset.id,
    media_kind: 'audio',
    status: 'completed',
    media_key: SILENT_WAV_KEY,
    media_mime_type: 'audio/wav',
    media_duration_ms: 1800,
    recipe: JSON.stringify({
      name: 'Rachel',
      prompt: 'Merchant: Fresh apples and clean maps for the road. Come closer before the rain starts.',
      model: 'eleven_v3',
      dialogueVoiceIds: ['voice-ada', 'voice-ben'],
    }),
    provider_metadata: JSON.stringify({
      provider: 'elevenlabs',
      model: 'eleven_v3',
      voices: [
        { speaker: 'Merchant', voiceId: 'voice-ada', name: 'Rachel' },
        { speaker: 'Traveler', voiceId: 'voice-ben', name: 'Adam' },
      ],
    }),
  });
  asset.active_variant_id = variant.id;

  return (
    <div style={{ width: 260 }}>
      <AssetCard
        asset={asset}
        variants={[variant]}
        spaceId="space-1"
        canEdit
      />
    </div>
  );
};
