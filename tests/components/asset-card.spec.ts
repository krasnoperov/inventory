import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

const asset = {
  id: 'audio-asset',
  name: 'Merchant greeting',
  type: 'dialogue',
  media_kind: 'audio',
  tags: '',
  parent_asset_id: null,
  active_variant_id: 'audio-variant',
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
};

const variant = {
  id: 'audio-variant',
  asset_id: asset.id,
  media_kind: 'audio',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: null,
  thumb_key: null,
  media_key: 'media/space/audio-variant.wav',
  media_mime_type: 'audio/wav',
  media_size_bytes: 44,
  media_width: null,
  media_height: null,
  media_duration_ms: 1800,
  recipe: JSON.stringify({
    name: 'Rachel',
    prompt: 'Merchant: Fresh apples and clean maps for the road. Come closer before the rain starts.',
    model: 'requested-model',
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
  generation_provenance: null,
  starred: false,
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
  description: null,
};

test('audio asset card surfaces playback, model, voice, and prompt', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 560 });
  await mountComponent(page, 'AssetCard', {
    asset,
    variants: [variant],
    spaceId: 'space-1',
    canEdit: true,
    onAssetClick: '__noop__',
    onAddToTray: '__noop__',
  });

  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByText('Name')).toBeVisible();
  await expect(page.locator('[title="Rachel"]')).toBeVisible();
  await expect(page.getByText('Model')).toBeVisible();
  await expect(page.getByText('eleven_v3')).toBeVisible();
  await expect(page.getByText('Voice')).toBeVisible();
  await expect(page.getByText('Merchant: Rachel, Traveler: Adam')).toBeVisible();
  await expect(page.getByText(/Fresh apples and clean maps/)).toBeVisible();

  await screenshot(page, 'asset-card-audio');
});
