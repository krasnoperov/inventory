import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

const asset = (id: string, name: string) => ({
  id,
  name,
  type: 'sprite',
  media_kind: 'image',
  tags: '',
  parent_asset_id: null,
  active_variant_id: `${id}-v`,
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
});

const readyVariant = (assetId: string) => ({
  id: `${assetId}-v`,
  asset_id: assetId,
  media_kind: 'image',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: `images/space/${assetId}.png`,
  thumb_key: `images/space/${assetId}_thumb.webp`,
  media_key: `images/space/${assetId}.png`,
  media_mime_type: 'image/png',
  media_size_bytes: 1,
  media_width: 512,
  media_height: 512,
  media_duration_ms: null,
  recipe: '{}',
  starred: false,
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
  description: null,
});

const pendingVariant = (assetId: string) => ({
  ...readyVariant(assetId),
  status: 'pending',
  image_key: null,
  thumb_key: null,
  media_key: null,
});

const composition = {
  id: 'c1',
  name: 'Arbol scene',
  description: null,
  status: 'draft',
  output_asset_id: null,
  output_variant_id: null,
  metadata: '{}',
  sort_index: 0,
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
};

const audioAsset = {
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

const audioVariant = {
  id: 'audio-variant',
  asset_id: audioAsset.id,
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

const deliverables = {
  id: 'deliverables',
  name: 'a1-gender-trap - final',
  kind: 'deliverables',
  color: null,
  description: null,
  sort_index: 0,
  created_at: baseTime,
  updated_at: baseTime,
};

const audioCollectionItem = {
  id: 'deliverable-audio',
  collection_id: deliverables.id,
  subject_type: 'asset',
  asset_id: audioAsset.id,
  variant_id: null,
  pinned_variant_id: audioVariant.id,
  role: 'dialogue',
  sort_index: 0,
  created_at: baseTime,
  updated_at: baseTime,
};

const legacyAudioAsset = {
  ...audioAsset,
  id: 'legacy-audio-asset',
  name: 'Legacy ambience',
  active_variant_id: 'legacy-audio-variant',
};

const legacyAudioVariant = {
  ...audioVariant,
  id: 'legacy-audio-variant',
  asset_id: legacyAudioAsset.id,
  recipe: '{}',
  provider_metadata: null,
};

const legacyAudioCollectionItem = {
  ...audioCollectionItem,
  id: 'deliverable-legacy-audio',
  asset_id: legacyAudioAsset.id,
  pinned_variant_id: legacyAudioVariant.id,
  sort_index: 1,
};

const regeneratingAudioVariant = {
  ...audioVariant,
  id: 'audio-regenerating-variant',
  workflow_id: 'workflow-audio-regenerating',
  status: 'processing',
  media_key: null,
  media_mime_type: null,
  media_size_bytes: null,
  media_duration_ms: null,
  created_at: baseTime + 1,
  updated_at: baseTime + 1,
};

async function selectDropdown(page: import('@playwright/test').Page, label: string, optionName: string, index = 0) {
  await page.getByRole('combobox', { name: label, exact: true }).nth(index).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

async function resolvedBackground(page: import('@playwright/test').Page, value: string) {
  return page.evaluate((backgroundValue) => {
    const probe = document.createElement('div');
    probe.style.background = backgroundValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
  }, value);
}

async function expectNoOverlap(
  first: import('@playwright/test').Locator,
  second: import('@playwright/test').Locator,
) {
  await expect.poll(async () => {
    const firstBox = await first.boundingBox();
    const secondBox = await second.boundingBox();
    if (!firstBox || !secondBox) return false;
    return !(
      firstBox.x + firstBox.width <= secondBox.x ||
      secondBox.x + secondBox.width <= firstBox.x ||
      firstBox.y + firstBox.height <= secondBox.y ||
      secondBox.y + secondBox.height <= firstBox.y
    );
  }).toBe(false);
}

async function expectWithinViewport(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
) {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    if (!box) return false;
    const viewport = page.viewportSize();
    if (!viewport) return false;
    return box.x >= 8 && box.x + box.width <= viewport.width - 8;
  }).toBe(true);
}

// Composition placement points a composition at a finished render. A pending /
// failed variant has no usable media, so the post-generation control must not
// offer to place it. Guard that only the ready card exposes the action.
test('composition placement is gated to finished variants', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [asset('ready', 'Ready sprite'), asset('pending', 'Pending sprite')],
    variants: [readyVariant('ready'), pendingVariant('pending')],
    collections: [],
    collectionItems: [],
    canEdit: true,
    onAssetClick: '__noop__',
    onPlaceInComposition: '__noop__',
    compositions: [composition],
    compositionItems: [],
    createCollection: '__noop__',
    updateCollection: '__noop__',
    deleteCollection: '__noop__',
    addCollectionItem: '__noop__',
    updateCollectionItem: '__noop__',
    reorderCollectionItems: '__noop__',
    deleteCollectionItem: '__noop__',
  });

  // Only the finished variant's card renders the placement control once its
  // controlled action menu is open.
  await page.getByTitle('Actions for Ready sprite').click();
  await expect(page.getByText('Add to composition')).toHaveCount(1);
  await expect(page.locator('[class*="starterPanel"]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[class*="starterPanel"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('[class*="starterPanel"]')).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('[class*="starterPanel"]')).toHaveCSS('border-left-width', '0px');
  await expect(page.locator('[class*="starterPanel"]')).toHaveCSS('border-radius', '0px');
  await screenshot(page, 'space-board-starter-panel', { fullPage: true });
});

test('media triggers open image assets without changing thumbnail chrome', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [asset('hero', 'Hero sprite'), audioAsset],
    variants: [readyVariant('hero'), audioVariant],
    collections: [deliverables],
    collectionItems: [audioCollectionItem],
    canEdit: true,
    onAssetClick: '__record__:assetClick',
    createCollection: '__noop__',
    updateCollection: '__noop__',
    deleteCollection: '__noop__',
    addCollectionItem: '__noop__',
    updateCollectionItem: '__noop__',
    reorderCollectionItems: '__noop__',
    deleteCollectionItem: '__noop__',
  });

  const imageThumbnailTrigger = page.locator('button[class*="thumbnailButton"][title="Hero sprite"]');
  await expect(imageThumbnailTrigger).toBeVisible();
  await expect(page.locator('section[class*="collection"]').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('section[class*="collection"]').first()).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('section[class*="collection"]').first()).toHaveCSS('border-left-width', '0px');
  await expect(page.locator('section[class*="collection"]').first()).toHaveCSS('border-radius', '0px');
  await expect(page.locator('[class*="collectionEyebrow"]').first()).toHaveCSS('text-transform', 'none');
  await expect(page.locator('[class*="collectionEyebrow"]').first()).toHaveCSS('letter-spacing', 'normal');
  await expect.poll(() => page.locator('section[class*="collection"]').first().evaluate(
    (element) => getComputedStyle(element, '::before').backgroundImage,
  )).toBe('none');
  await expect(imageThumbnailTrigger).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(imageThumbnailTrigger).toHaveCSS('padding', '0px');
  await expect(imageThumbnailTrigger).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('[class*="colorDot"]').first()).toHaveCSS('box-shadow', 'none');

  await expect(page.locator('div[class*="thumbnailButton"][title="Merchant greeting"]')).toBeVisible();
  await expect(page.locator('button[class*="thumbnailButton"][title="Merchant greeting"]')).toHaveCount(0);

  await imageThumbnailTrigger.hover();
  await expect(imageThumbnailTrigger).toHaveCSS('box-shadow', 'none');
  await expect(imageThumbnailTrigger).toHaveCSS('transform', 'none');
  const imageCaption = page.locator('[class*="caption"]').filter({ hasText: 'Hero sprite' });
  await expect(imageCaption).toBeVisible();
  await expect(imageCaption).toHaveCSS('opacity', '1');
  await expect(imageCaption).toHaveCSS('transform', 'none');
  await expect(imageCaption).toHaveCSS('transition-property', 'all');
  await expectNoOverlap(imageCaption, imageThumbnailTrigger);
  await screenshot(page, 'space-board-media-triggers', { fullPage: true });
  await imageThumbnailTrigger.click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toHaveLength(1);
  expect(calls[0].eventName).toBe('assetClick');
  expect((calls[0].args[0] as { id: string }).id).toBe('hero');
});

test('asset name triggers open image and audio assets', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [asset('hero', 'Hero sprite'), audioAsset],
    variants: [readyVariant('hero'), audioVariant],
    collections: [deliverables],
    collectionItems: [audioCollectionItem],
    canEdit: true,
    onAssetClick: '__record__:assetClick',
    createCollection: '__noop__',
    updateCollection: '__noop__',
    deleteCollection: '__noop__',
    addCollectionItem: '__noop__',
    updateCollectionItem: '__noop__',
    reorderCollectionItems: '__noop__',
    deleteCollectionItem: '__noop__',
  });

  const imageNameTrigger = page.locator('button[class*="assetName"]').filter({ hasText: 'Hero sprite' });
  const audioNameTrigger = page.locator('button[class*="audioAssetName"]').filter({ hasText: 'Merchant greeting' });

  await expect(imageNameTrigger).toBeVisible();
  await expect(audioNameTrigger).toBeVisible();

  await page.getByTitle('Hero sprite').first().hover();
  await expect(imageNameTrigger).toHaveCSS('color', 'rgb(19, 22, 29)');
  await imageNameTrigger.click();
  await audioNameTrigger.click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.map((call) => call.eventName)).toEqual(['assetClick', 'assetClick']);
  expect((calls[0].args[0] as { id: string }).id).toBe('hero');
  expect((calls[1].args[0] as { id: string }).id).toBe('audio-asset');
});

test('audio collection cards surface playback and compact metadata', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [audioAsset, legacyAudioAsset],
    variants: [audioVariant, legacyAudioVariant],
    collections: [deliverables],
    collectionItems: [audioCollectionItem, legacyAudioCollectionItem],
    canEdit: true,
    onAssetClick: '__noop__',
    createCollection: '__noop__',
    updateCollection: '__noop__',
    deleteCollection: '__noop__',
    addCollectionItem: '__noop__',
    updateCollectionItem: '__noop__',
    reorderCollectionItems: '__noop__',
    deleteCollectionItem: '__noop__',
  });

  await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(2);
  await expect(page.locator('section[class*="collection"]').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('article[class*="audioAssetCard"]').first()).toHaveCSS('border-top-color', await resolvedBackground(page, 'var(--color-border)'));
  await expect(page.getByRole('button', { name: 'Merchant greeting', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Legacy ambience', exact: true })).toBeVisible();
  await expect(page.locator('[title="Rachel"]')).toBeVisible();
  await expect(page.getByText('eleven_v3')).toBeVisible();
  await expect(page.getByText('Merchant: Rachel, Traveler: Adam')).toBeVisible();
  await expect(page.getByText('Model', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Voice', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Fresh apples and clean maps/)).toBeVisible();

  await screenshot(page, 'space-board-audio-collection', { fullPage: true });
});

test('audio cards keep completed playback while a sibling regeneration is running', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [audioAsset],
    variants: [audioVariant, regeneratingAudioVariant],
    collections: [deliverables],
    collectionItems: [audioCollectionItem],
    canEdit: true,
    onAssetClick: '__noop__',
    onRegenerateVariant: '__record__:regenerate',
    createCollection: '__noop__',
    updateCollection: '__noop__',
    deleteCollection: '__noop__',
    addCollectionItem: '__noop__',
    updateCollectionItem: '__noop__',
    reorderCollectionItems: '__noop__',
    deleteCollectionItem: '__noop__',
  });

  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByText('New take generating')).toBeVisible();
  await expect(page.getByText('Generating', { exact: true })).toHaveCount(0);

  await page.getByTitle('Actions for Merchant greeting').click();
  await page.getByRole('button', { name: 'Regenerate audio' }).click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toHaveLength(1);
  expect(calls[0].eventName).toBe('regenerate');
  expect((calls[0].args[0] as { id: string }).id).toBe('audio-variant');
});

test('collection menus use shared form controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 780 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [asset('hero', 'Hero sprite'), asset('background', 'Forest background')],
    variants: [readyVariant('hero'), { ...readyVariant('hero'), id: 'hero-alt-v', starred: true }, readyVariant('background')],
    collections: [
      {
        id: 'cast',
        name: 'Cast',
        kind: 'cast',
        color: null,
        description: null,
        sort_index: 0,
        created_at: baseTime,
        updated_at: baseTime,
      },
      {
        id: 'backgrounds',
        name: 'Backgrounds',
        kind: 'backgrounds',
        color: null,
        description: null,
        sort_index: 1,
        created_at: baseTime,
        updated_at: baseTime,
      },
    ],
    collectionItems: [
      {
        id: 'cast-hero',
        collection_id: 'cast',
        subject_type: 'asset',
        asset_id: 'hero',
        variant_id: null,
        pinned_variant_id: null,
        role: 'character',
        sort_index: 0,
        created_at: baseTime,
        updated_at: baseTime,
      },
    ],
    canEdit: true,
    onAssetClick: '__noop__',
    createCollection: '__record__:createCollection',
    updateCollection: '__record__:updateCollection',
    deleteCollection: '__record__:deleteCollection',
    addCollectionItem: '__record__:addCollectionItem',
    updateCollectionItem: '__record__:updateCollectionItem',
    reorderCollectionItems: '__record__:reorderCollectionItems',
    deleteCollectionItem: '__record__:deleteCollectionItem',
  });

  const createTrigger = page.getByRole('button', { name: 'Create collection' });
  await expect(page.getByText('New collection', { exact: true })).toHaveCount(0);
  await expect(page.locator('[class*="createControls"] summary')).toHaveCount(0);
  await createTrigger.click();
  await expect(createTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(createTrigger).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(createTrigger).toHaveCSS('backdrop-filter', 'none');
  await expect(createTrigger).toHaveCSS('background-color', await resolvedBackground(page, 'var(--button-ghost-bg-hover)'));
  const createPanel = page.locator('[class*="createPanel"]');
  const createNameInput = page.getByPlaceholder('Collection name');
  await expect(createPanel).toHaveCSS('box-shadow', 'none');
  await expect(createNameInput).toHaveCSS('grid-column-start', '1');
  await expect(createNameInput).toHaveCSS('grid-column-end', '-1');
  await expect.poll(async () => (await createNameInput.boundingBox())?.width ?? 0).toBeGreaterThan(240);
  await screenshot(page, 'space-board-create-panel', { fullPage: true });
  await page.keyboard.press('Escape');
  await expect(createTrigger).toHaveAttribute('aria-expanded', 'false');
  await createTrigger.click();
  await page.getByPlaceholder('Collection name').fill('Props');
  await selectDropdown(page, 'New collection kind', 'Style References');
  await page.getByLabel('New collection color').fill('#123456');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(createTrigger).toHaveAttribute('aria-expanded', 'false');
  await createTrigger.click();

  const collectionMenu = page.locator('[class*="collectionMenu"]').first();
  const collectionMenuTrigger = page.getByRole('button', { name: 'Manage collection Cast' });
  await expect(collectionMenu.locator('summary')).toHaveCount(0);
  await expect(collectionMenuTrigger).not.toContainText('...');
  await expect(collectionMenuTrigger.locator('svg')).toHaveCount(1);
  await collectionMenuTrigger.click();
  await expect(collectionMenuTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(collectionMenuTrigger).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(createTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[class*="createPanel"]')).toHaveCount(0);
  await expect(page.locator('[class*="collectionMenuPanel"]').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('[class*="collectionMenuPanel"]').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.getByRole('textbox', { name: 'Collection name' }).first().fill('Cast updated');
  await selectDropdown(page, 'Collection kind', 'Scenes');
  await page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Cast' }) })
    .getByLabel('Collection color')
    .fill('#654321');
  await selectDropdown(page, 'Asset to add to Cast', 'Forest background');
  const collectionMenuPanel = page.locator('[class*="collectionMenuPanel"]').first();
  await expect(collectionMenuPanel.getByRole('button', { name: 'Add selected asset to Cast' })).toBeVisible();
  await expect(collectionMenuPanel.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await collectionMenuPanel.getByRole('button', { name: 'Add selected asset to Cast' }).click();
  await expect(page.locator('[class*="collectionMenuPanel"]').first().getByRole('button', { name: 'Move collection up' })).toBeVisible();
  await expect(page.locator('[class*="collectionMenuPanel"]').first().getByRole('button', { name: 'Move collection down' })).toBeVisible();
  await expect(page.locator('[class*="collectionMenuPanel"]').first().getByText('Move up', { exact: true })).toHaveCount(0);
  await expect(page.locator('[class*="collectionMenuPanel"]').first().getByText('Move down', { exact: true })).toHaveCount(0);
  await expect(collectionMenuPanel.getByRole('button', { name: 'Delete collection' })).toHaveCSS('justify-content', 'flex-start');
  const emptyCollectionState = page.locator('[class*="emptyCollection"]').first();
  await expect(emptyCollectionState).toHaveText('No items yet');
  await expect(emptyCollectionState).toHaveCSS('flex-basis', '100%');
  await expect(emptyCollectionState).toHaveCSS('border-top-style', 'none');
  await screenshot(page, 'space-board-collection-manage-menu', { fullPage: true });
  await page.keyboard.press('Escape');
  await expect(collectionMenuTrigger).toHaveAttribute('aria-expanded', 'false');

  const cardMenu = page.locator('[class*="cardMenu"]').first();
  const cardMenuTrigger = page.getByRole('button', { name: 'Actions for Hero sprite' });
  await expect(cardMenu.locator('summary')).toHaveCount(0);
  await expect(cardMenuTrigger).not.toContainText('...');
  await expect(cardMenuTrigger.locator('svg')).toHaveCount(1);
  await cardMenuTrigger.click();
  await expect(cardMenuTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(cardMenuTrigger).toHaveAttribute('aria-haspopup', 'dialog');
  const cardMenuPanel = page.locator('[class*="cardMenuPanel"]').first();
  await expect(cardMenuPanel).toHaveCSS('box-shadow', 'none');
  await expect(cardMenuPanel.getByRole('button', { name: 'Add asset to collection' })).toBeVisible();
  await expect(cardMenuPanel.getByRole('button', { name: 'Add asset', exact: true })).toHaveCount(0);
  await expect(cardMenuPanel.getByRole('button', { name: 'Mark style ref' })).toHaveCount(0);
  await expect(cardMenuPanel.getByRole('button', { name: 'Move up' })).toBeVisible();
  await expect(cardMenuPanel.getByRole('button', { name: 'Move down' })).toBeVisible();
  await expect(cardMenuPanel.getByText('Move up', { exact: true })).toHaveCount(0);
  await expect(cardMenuPanel.getByText('Move down', { exact: true })).toHaveCount(0);
  await expect(cardMenuPanel.getByRole('button', { name: 'Remove from collection' })).toHaveCSS('justify-content', 'flex-start');
  await expect(cardMenuPanel.locator('label').filter({ hasText: 'Pinned variant' })).toHaveCSS('grid-template-columns', /80px/);
  const heroCard = cardMenuTrigger.locator('xpath=ancestor::article[1]');
  const cardPreview = heroCard.locator('[class*="thumbnailButton"]').first();
  const cardCaption = heroCard.locator('[class*="caption"]').first();
  await expect(cardCaption).toBeVisible();
  await expectNoOverlap(cardCaption, cardPreview);
  await expectNoOverlap(cardMenuTrigger, cardPreview);
  await expectNoOverlap(cardMenuPanel, cardPreview);
  await expectNoOverlap(cardMenuPanel, page.locator('button[class*="thumbnailButton"][title="Forest background"]').first());
  await expectWithinViewport(page, cardMenuPanel);
  await page.getByLabel('Role for Hero sprite').fill('lead');
  await selectDropdown(page, 'Collection target for Hero sprite', 'Backgrounds');
  await selectDropdown(page, 'Pinned variant for Hero sprite', 'Variant 2 star');
  await screenshot(page, 'space-board-collection-menus', { fullPage: true });
  await page.getByRole('heading', { name: 'Collections' }).click();
  await expect(cardMenuTrigger).toHaveAttribute('aria-expanded', 'false');

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.some((call) => call.eventName === 'createCollection')).toBe(true);
  expect(calls.some((call) => call.eventName === 'updateCollection')).toBe(true);
  expect(calls.some((call) => {
    const patch = call.args[1] as { color?: string } | undefined;
    return call.eventName === 'updateCollection' && patch?.color === '#654321';
  })).toBe(true);
  expect(calls.some((call) => call.eventName === 'addCollectionItem')).toBe(true);
  expect(calls.some((call) => call.eventName === 'updateCollectionItem')).toBe(true);
});

test('collection create panel stacks cleanly on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [asset('hero', 'Hero sprite')],
    variants: [readyVariant('hero')],
    collections: [],
    collectionItems: [],
    canEdit: true,
    onAssetClick: '__noop__',
    createCollection: '__record__:createCollection',
    updateCollection: '__noop__',
    deleteCollection: '__noop__',
    addCollectionItem: '__noop__',
    updateCollectionItem: '__noop__',
    reorderCollectionItems: '__noop__',
    deleteCollectionItem: '__noop__',
  });

  const createTrigger = page.getByRole('button', { name: 'Create collection' });
  await createTrigger.click();
  const createPanel = page.locator('[class*="createPanel"]');
  await expect(createPanel).toBeVisible();
  await expect(page.getByPlaceholder('Collection name')).toBeVisible();
  await expect.poll(async () => (await page.getByPlaceholder('Collection name').boundingBox())?.width ?? 0).toBeGreaterThan(280);
  await expect(page.getByLabel('New collection kind')).toBeVisible();
  await expect(page.getByLabel('New collection color')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
  await screenshot(page, 'space-board-create-panel-mobile', { fullPage: true });

  await page.getByPlaceholder('Collection name').fill('Props');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(createTrigger).toHaveAttribute('aria-expanded', 'false');
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.some((call) => call.eventName === 'createCollection')).toBe(true);
});

test('space board exposes direct Forge Tray state without opening an empty card menu', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [asset('hero', 'Hero sprite')],
    variants: [readyVariant('hero')],
    collections: [],
    collectionItems: [],
    canEdit: false,
    onAssetClick: '__noop__',
    onAddToTray: '__record__:addToTray',
    createCollection: '__noop__',
    updateCollection: '__noop__',
    deleteCollection: '__noop__',
    addCollectionItem: '__noop__',
    updateCollectionItem: '__noop__',
    reorderCollectionItems: '__noop__',
    deleteCollectionItem: '__noop__',
  });

  const addToTray = page.getByRole('button', { name: 'Add Hero sprite to Forge Tray' });
  await expect(addToTray).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions for Hero sprite' })).toHaveCount(0);
  await addToTray.click();
  let calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.map((call) => call.eventName)).toEqual(['addToTray']);

  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [asset('hero', 'Hero sprite')],
    variants: [readyVariant('hero')],
    collections: [],
    collectionItems: [],
    canEdit: false,
    onAssetClick: '__noop__',
    onAddToTray: '__record__:addToTray',
    isVariantInForgeTray: '__variantInForgeTray__:hero-v',
    createCollection: '__noop__',
    updateCollection: '__noop__',
    deleteCollection: '__noop__',
    addCollectionItem: '__noop__',
    updateCollectionItem: '__noop__',
    reorderCollectionItems: '__noop__',
    deleteCollectionItem: '__noop__',
  });

  const inTray = page.getByRole('button', { name: 'Hero sprite is in Forge Tray' });
  await expect(inTray).toBeVisible();
  await expect(inTray).toBeDisabled();
  await expect(inTray).toHaveCSS('color', await resolvedBackground(page, 'var(--color-success)'));
  await expect(page.getByRole('button', { name: 'Add Hero sprite to Forge Tray' })).toHaveCount(0);
  await screenshot(page, 'space-board-direct-forge-tray-state', { fullPage: true });

  await inTray.click({ force: true });
  calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual([]);
});
