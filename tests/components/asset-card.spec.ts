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

const imageAsset = {
  id: 'image-asset',
  name: 'Crystal Gate',
  type: 'prop',
  media_kind: 'image',
  tags: '',
  parent_asset_id: null,
  active_variant_id: 'image-variant',
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
};

const imageVariant = {
  id: 'image-variant',
  asset_id: imageAsset.id,
  media_kind: 'image',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: 'images/space/image-variant.png',
  thumb_key: 'images/space/image-variant_thumb.webp',
  media_key: 'images/space/image-variant.png',
  media_mime_type: 'image/png',
  media_size_bytes: 123,
  media_width: 240,
  media_height: 180,
  media_duration_ms: null,
  recipe: '{}',
  generation_provenance: null,
  starred: false,
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
  description: null,
};

async function mockMedia(page: import('@playwright/test').Page) {
  await page.route('**/api/images/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#668cff"/><circle cx="120" cy="90" r="42" fill="#ffffff"/></svg>',
    }),
  );
}

async function resolvedColor(page: import('@playwright/test').Page, value: string) {
  return page.evaluate((colorValue) => {
    const probe = document.createElement('div');
    probe.style.color = colorValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);
}

test('audio asset card surfaces playback, model, voice, and prompt', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 560 });
  await mountComponent(page, 'AssetCard', {
    asset,
    variants: [variant],
    spaceId: 'space-1',
    canEdit: true,
    onAssetClick: '__record__:open',
    onAddToTray: '__noop__',
  });

  const titleButton = page.locator('button[class*="titleButton"]');
  await expect(titleButton).toBeVisible();
  await expect(titleButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(titleButton.locator('[class*="audioDetails"]')).toHaveCount(0);
  await expect(page.locator('button[class*="thumbnailButton"]')).toHaveCount(0);
  await expect(page.locator('[class*="thumbnailArea"]').first()).toHaveCSS('cursor', 'auto');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByText('Name')).toBeVisible();
  await expect(page.locator('[title="Rachel"]')).toBeVisible();
  await expect(page.getByText('Model')).toBeVisible();
  await expect(page.getByText('eleven_v3')).toBeVisible();
  await expect(page.getByText('Voice')).toBeVisible();
  await expect(page.getByText('Merchant: Rachel, Traveler: Adam')).toBeVisible();
  await expect(page.getByText(/Fresh apples and clean maps/)).toBeVisible();

  await titleButton.click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toHaveLength(1);
  expect(calls[0].eventName).toBe('open');
  expect((calls[0].args[0] as { id: string }).id).toBe('audio-asset');

  await screenshot(page, 'asset-card-audio');
});

test('asset card add action uses shared icon button outside media', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 380 });
  await mockMedia(page);
  await mountComponent(page, 'AssetCard', {
    asset: {
      ...imageAsset,
      name: 'Crystal Gate With An Extremely Long Decorative Production Name',
    },
    variants: [imageVariant],
    spaceId: 'space-1',
    canEdit: true,
    onAssetClick: '__record__:open',
    onAddToTray: '__record__:tray',
  });

  const addToTray = page.getByRole('button', { name: 'Add to Forge Tray' });
  await expect(addToTray).toBeVisible();
  const thumbnailButton = page.getByRole('button', {
    name: 'Open Crystal Gate With An Extremely Long Decorative Production Name',
  });
  await expect(thumbnailButton).toBeVisible();
  await expect(thumbnailButton).toHaveClass(/thumbnailButton/);
  await expect(thumbnailButton).toHaveCSS('cursor', 'pointer');
  const titleButton = page.locator('button[class*="titleButton"]');
  await expect(titleButton).toBeVisible();
  const nameLabel = titleButton.locator('[class*="name"]');
  await expect.poll(() => nameLabel.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await titleButton.click();
  await thumbnailButton.click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.map((call) => call.eventName)).toEqual(['open', 'open']);
  expect((calls[0].args[0] as { id: string }).id).toBe('image-asset');
  expect((calls[1].args[0] as { id: string }).id).toBe('image-asset');

  await page.locator('[class*="thumbnailArea"]').hover();
  await expect(page.locator('[class*="card"]').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('[class*="card"]').first()).toHaveCSS(
    'transition-property',
    'border-color',
  );
  await addToTray.hover();
  await expect(addToTray).toHaveCSS(
    'color',
    await resolvedColor(page, 'var(--button-primary-text)'),
  );
  await expect(page.getByRole('button', { name: 'View' })).toHaveCount(0);
  await screenshot(page, 'asset-card-shared-actions', { fullPage: true });
});
