import { expect, test } from '@playwright/test';
import { MEDIA_OPERATION_MATRIX } from '../../src/shared/mediaOperationMatrix';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

function asset(id: string, name: string, type: string, mediaKind: 'image' | 'audio' | 'video') {
  return {
    id,
    name,
    type,
    media_kind: mediaKind,
    tags: '',
    parent_asset_id: null,
    active_variant_id: `${id}-variant`,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
  };
}

function variant(assetId: string, mediaKind: 'image' | 'audio' | 'video') {
  const isImage = mediaKind === 'image';
  return {
    id: `${assetId}-variant`,
    asset_id: assetId,
    media_kind: mediaKind,
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: isImage ? `images/space/${assetId}.png` : null,
    thumb_key: isImage ? `images/space/${assetId}_thumb.webp` : null,
    media_key: isImage ? `images/space/${assetId}.png` : `media/space/${assetId}.${mediaKind === 'audio' ? 'mp3' : 'mp4'}`,
    media_mime_type: mediaKind === 'audio' ? 'audio/mpeg' : mediaKind === 'video' ? 'video/mp4' : 'image/png',
    media_size_bytes: 123,
    media_width: mediaKind === 'audio' ? null : 100,
    media_height: mediaKind === 'audio' ? null : 100,
    media_duration_ms: mediaKind === 'image' ? null : 1200,
    transcript_key: null,
    transcript_mime_type: null,
    transcript_size_bytes: null,
    word_timings_key: null,
    word_timings_mime_type: null,
    word_timings_size_bytes: null,
    render_metadata_key: null,
    render_metadata_mime_type: null,
    render_metadata_size_bytes: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
    description: null,
    quality_rating: null,
    rated_at: null,
  };
}

const matrixAssets = [
  asset('asset-image', 'Hero Image', 'character', 'image'),
  asset('asset-video', 'Hero Video', 'animation', 'video'),
  asset('asset-audio', 'Hero Speech', 'speech', 'audio'),
];

const matrixVariants = matrixAssets.map((entry) => variant(entry.id, entry.media_kind));

const imageReferenceAssets = [
  asset('image-ref-1', 'Image Ref One', 'character', 'image'),
  asset('image-ref-2', 'Image Ref Two', 'prop', 'image'),
  asset('image-ref-3', 'Image Ref Three', 'scene', 'image'),
  asset('image-ref-4', 'Image Ref Four', 'style-sheet', 'image'),
];

const imageReferenceVariants = imageReferenceAssets.map((entry) => variant(entry.id, 'image'));

const activeStyle = {
  id: 'style-1',
  name: 'House Style',
  description: 'Painterly house style',
  imageKeys: ['styles/space/style-1.png'],
  enabled: true,
  createdBy: 'user-1',
  createdAt: baseTime,
  updatedAt: baseTime,
};

const overflowingStyle = {
  ...activeStyle,
  id: 'style-2',
  imageKeys: ['styles/space/style-1.png', 'styles/space/style-2.png'],
};

const composition = {
  id: 'composition-1',
  name: 'Scene X composition',
  description: null,
  status: 'draft',
  output_asset_id: null,
  output_variant_id: null,
  metadata: '{}',
  sort_index: 0,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

const styleCollection = {
  id: 'collection-style',
  name: 'Russafa refs',
  kind: 'style_refs',
  color: '#d14c6d',
  description: null,
  sort_index: 0,
  item_count: 1,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

const styleCollectionItem = {
  id: 'style-item-1',
  collection_id: styleCollection.id,
  subject_type: 'asset',
  asset_id: imageReferenceAssets[0].id,
  variant_id: null,
  role: 'style_ref',
  pinned_variant_id: imageReferenceVariants[0].id,
  sort_index: 0,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

const russafaPreset = {
  id: 'preset-russafa',
  name: 'Russafa watercolor',
  description: 'Warm market washes',
  style_prompt: 'loose watercolor adventure game art',
  collection_id: styleCollection.id,
  enabled: true,
  is_default: true,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
  collection_name: styleCollection.name,
  reference_count: 3,
  style_reference_variant_ids: ['style-v1', 'style-v2', 'style-v3'],
  style_reference_image_keys: ['images/style-v1.png', 'images/style-v2.png', 'images/style-v3.png'],
};

async function disableAnimations(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }',
  });
}

function groupLabel(mode: string): 'Image' | 'Video' | 'Audio' {
  if (mode === 'image') return 'Image';
  if (mode === 'video') return 'Video';
  return 'Audio';
}

/** Pick a media mode: open the popover, choose the group, then the audio sub-mode. */
async function selectMode(page: import('@playwright/test').Page, config: typeof MEDIA_OPERATION_MATRIX[number]) {
  const group = groupLabel(config.mode);
  await page.getByTitle('Media type', { exact: true }).click();
  await page.getByTitle(`${group} media`).click();
  if (group === 'Audio') {
    await page.getByTitle(`${config.label} mode`).click();
  }
}

test('forge tray renders a screenshot matrix for every media mode', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
    sendChatMessage: '__noop__',
  });
  await disableAnimations(page);

  for (const config of MEDIA_OPERATION_MATRIX) {
    await selectMode(page, config);

    // Name is auto-generated per media group (Image N / Video N / Audio N).
    await expect(page.getByLabel('Asset name')).toHaveValue(`${groupLabel(config.mode)} 1`);

    const buttonLabel = config.mode === 'image' ? 'Generate' : `Generate ${config.shortLabel}`;
    await expect(page.getByRole('button', { name: buttonLabel })).toBeVisible();

    await page.mouse.move(0, 0);
    await screenshot(page, `forge-tray-media-mode-${config.mode}`, { fullPage: true });
  }
});

test('forge tray collapses the media type into a popover trigger', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  const trigger = page.getByTitle('Media type', { exact: true });
  await expect(trigger).toBeVisible();
  // Choices are hidden until the trigger is clicked.
  await expect(page.getByTitle('Video media')).toHaveCount(0);

  await trigger.click();
  await expect(page.getByTitle('Image media')).toBeVisible();
  await expect(page.getByTitle('Video media')).toBeVisible();
  await expect(page.getByTitle('Audio media')).toBeVisible();
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-mode-popover', { fullPage: true });

  await page.getByTitle('Video media').click();
  await expect(page.getByTitle('Video media')).toHaveCount(0); // popover closed
  await expect(page.getByLabel('Asset name')).toHaveValue('Video 1');
});

test('forge tray makes the prompt the hero above the controls', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  const prompt = page.getByLabel('Prompt');
  const trigger = page.getByTitle('Media type', { exact: true });
  const submit = page.getByRole('button', { name: 'Generate' });

  const promptBox = await prompt.boundingBox();
  const triggerBox = await trigger.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();
  expect(promptBox!.y).toBeLessThan(triggerBox!.y);

  await expect(submit).toBeDisabled();
  await prompt.fill('A cozy campfire at dusk');
  await expect(submit).toBeEnabled();
});

test('forge tray auto-names by media group and stays editable', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  const name = page.getByLabel('Asset name');
  await expect(name).toHaveValue('Image 1');

  await page.getByTitle('Media type', { exact: true }).click();
  await page.getByTitle('Audio media').click();
  await expect(name).toHaveValue('Audio 1');

  await name.fill('My jingle');
  await page.getByTitle('Media type', { exact: true }).click();
  await page.getByTitle('Image media').click();
  await expect(name).toHaveValue('My jingle');
});

test('forge tray image options expose batch count', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  await page.getByLabel('Prompt').fill('Four explorations of a logo');
  await page.getByRole('button', { name: '×4', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Explore' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate ×4/ })).toBeVisible();

  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-batch', { fullPage: true });
});

test('forge tray submits a generate-to-composition output shortcut', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    compositions: [composition],
    compositionItems: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  await page.getByLabel('Prompt').fill('Wide scene background');
  await page.getByLabel('Composition shortcut').selectOption('output:composition-1');
  await page.getByRole('button', { name: 'Generate' }).click();

  const details = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(details[0].eventName).toBe('forge-submit');
  expect(details[0].args[0]).toMatchObject({
    prompt: 'Wide scene background',
    shortcut: {
      composition: { kind: 'output', compositionId: 'composition-1' },
    },
  });
});

test('forge tray image model selection enforces reference budget', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: imageReferenceAssets,
    allVariants: imageReferenceVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  await page.getByLabel('Prompt').fill('Combine these references');
  await page.getByTitle('Add reference').click();
  await page.getByRole('button', { name: /Image Ref One/ }).click();
  await page.getByRole('button', { name: /Image Ref Two/ }).click();
  await page.getByRole('button', { name: /Done/i }).click();

  await expect(page.getByRole('button', { name: 'Derive' })).toBeEnabled();

  await page.getByRole('button', { name: 'Flash' }).click();

  await expect(page.getByText('Flash supports 1 reference. Remove references or switch Pro.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Derive' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '2K' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '4K' })).toBeDisabled();

  await page.getByTitle('Remove').first().click();
  await expect(page.getByText('Flash supports 1 reference. Remove references or switch Pro.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Derive' })).toBeEnabled();
});

test('forge tray keeps one fork setup slot when style consumes Flash reference budget', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: imageReferenceAssets,
    allVariants: imageReferenceVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
    __styleStore: activeStyle,
  });
  await disableAnimations(page);

  await page.getByRole('button', { name: 'Flash' }).click();
  await expect(page.getByTitle('Add reference')).toBeVisible();

  await page.getByTitle('Add reference').click();
  await page.getByRole('button', { name: /Image Ref One/ }).click();
  await page.getByRole('button', { name: /Done/i }).click();

  await expect(page.getByRole('button', { name: 'Fork' })).toBeEnabled();
  await expect(page.getByTitle('Add reference')).toHaveCount(0);

  await page.getByLabel('Prompt').fill('Turn this into a finished scene');
  await expect(page.getByText('Flash supports 1 reference including style. Remove references or switch Pro.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Derive' })).toBeDisabled();
});

test('forge tray counts style-only references against the selected model budget', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: imageReferenceAssets,
    allVariants: imageReferenceVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
    __styleStore: overflowingStyle,
  });
  await disableAnimations(page);

  await page.getByRole('button', { name: 'Flash' }).click();
  await page.getByLabel('Prompt').fill('Create a finished asset in the active style');

  await expect(page.getByText('Flash supports 1 reference including style. Reduce style images or switch Pro.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate' })).toBeDisabled();
});

test('forge tray video mode exposes Veo options and audio default-on status', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  await page.getByTitle('Media type', { exact: true }).click();
  await page.getByTitle('Video media').click();

  await expect(page.getByRole('group', { name: 'Video resolution' })).toBeVisible();
  await expect(page.getByRole('button', { name: '720p' })).toBeVisible();
  await page.getByRole('button', { name: '1080p' }).click();
  await expect(page.getByRole('button', { name: '1080p' })).toHaveClass(/active/);

  await expect(page.getByRole('group', { name: 'Video duration' })).toBeVisible();
  await page.getByRole('button', { name: '6s' }).click();
  await expect(page.getByRole('button', { name: '6s' })).toHaveClass(/active/);

  await expect(page.getByRole('group', { name: 'Video tier' })).toBeVisible();
  await page.getByRole('button', { name: 'Fast' }).click();
  await expect(page.getByRole('button', { name: 'Fast' })).toHaveClass(/active/);
  await page.getByRole('button', { name: '4k' }).click();
  await expect(page.getByRole('button', { name: '4k' })).toHaveClass(/active/);
  await page.getByRole('button', { name: 'Lite' }).click();
  await expect(page.getByRole('button', { name: 'Lite' })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: '1080p' })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: '4k' })).toBeDisabled();

  await expect(page.getByText('Audio default on')).toBeVisible();
  await expect(page.getByLabel('Audio')).toHaveCount(0);
});

test('forge tray video picker enforces the three-reference budget', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: imageReferenceAssets,
    allVariants: imageReferenceVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  await page.getByTitle('Media type', { exact: true }).click();
  await page.getByTitle('Video media').click();
  await page.getByTitle('Add reference').click();

  await page.getByRole('button', { name: /Image Ref One/ }).click();
  await page.getByRole('button', { name: /Image Ref Two/ }).click();
  await page.getByRole('button', { name: /Image Ref Three/ }).click();

  await expect(page.getByRole('button', { name: /Image Ref Four/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Image Ref Four/ })).toHaveAttribute(
    'title',
    'Reference budget reached',
  );

  await page.getByRole('button', { name: /Done/i }).click();
  await expect(page.getByTitle('Add reference')).toHaveCount(0);
});

test('forge tray opens Style and Chat as separate full sheets', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    spaceId: 'space-1',
    sendStyleSet: '__noop__',
    sendStyleDelete: '__noop__',
    sendStyleToggle: '__noop__',
    sendChatMessage: '__noop__',
    requestChatHistory: '__noop__',
    clearChatSession: '__noop__',
  });
  await disableAnimations(page);

  await page.getByLabel('Prompt').fill('A cozy campfire at dusk');

  await page.getByRole('button', { name: 'Style' }).click();
  await expect(page.getByText('Style Library')).toBeVisible();
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-style-sheet', { fullPage: true });
  await page.getByRole('button', { name: /Close/i }).click();
  await expect(page.getByText('Style Library')).toHaveCount(0);

  await page.getByTitle('Chat with Claude about your prompt').click();
  await expect(page.getByText('Chat with Claude')).toBeVisible();
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-chat-sheet', { fullPage: true });
});

test('style library creates a preset from a style collection', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: imageReferenceAssets,
    allVariants: imageReferenceVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    spaceId: 'space-1',
    createStylePreset: '__record__:style-create',
    collections: [styleCollection],
    collectionItems: [styleCollectionItem],
  });

  await page.getByLabel('Style', { exact: true }).click();
  await page.getByLabel('Preset name').fill('Painterly market');
  await page.getByLabel('Style prompt').fill('sun-washed watercolor with ink outlines');
  await page.getByLabel('Style description').fill('For the market scene');
  await page.getByLabel('Set as space default').check();
  await page.getByRole('button', { name: 'Create preset' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.find((call) => call.eventName === 'style-create')?.args[0]).toMatchObject({
    name: 'Painterly market',
    stylePrompt: 'sun-washed watercolor with ink outlines',
    description: 'For the market scene',
    collectionId: styleCollection.id,
    enabled: true,
    isDefault: true,
  });
});

test('style library sets a preset as default', async ({ page }) => {
  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    spaceId: 'space-1',
    updateStylePreset: '__record__:style-update',
    stylePresets: [{ ...russafaPreset, is_default: false }],
    collections: [styleCollection],
  });

  await page.getByLabel('Style', { exact: true }).click();
  await page.getByRole('button', { name: 'Set default' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.find((call) => call.eventName === 'style-update')?.args).toEqual([
    russafaPreset.id,
    { isDefault: true, enabled: true },
  ]);
});

test('forge tray submits a named style preset for generation', async ({ page }) => {
  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    stylePresets: [russafaPreset],
  });

  await page.getByLabel('Prompt').fill('A tiled city fountain');
  await page.getByLabel('Style selector').selectOption(`preset:${russafaPreset.id}`);
  await expect(page.getByText('Style: Russafa watercolor · 3 refs')).toBeVisible();
  await page.getByRole('button', { name: /Generate/ }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.find((call) => call.eventName === 'forge-submit')?.args[0]).toMatchObject({
    stylePresetId: russafaPreset.id,
    disableStyle: undefined,
  });
});

test('forge tray submits no-style override for one request', async ({ page }) => {
  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    stylePresets: [russafaPreset],
  });

  await page.getByLabel('Prompt').fill('A clean icon sheet');
  await page.getByLabel('Style selector').selectOption('none');
  await expect(page.getByText('Style: No style')).toBeVisible();
  await page.getByRole('button', { name: /Generate/ }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.find((call) => call.eventName === 'forge-submit')?.args[0]).toMatchObject({
    disableStyle: true,
    stylePresetId: undefined,
  });
});

test('forge tray submits custom selected style refs', async ({ page }) => {
  await mountComponent(page, 'ForgeTray', {
    allAssets: imageReferenceAssets,
    allVariants: imageReferenceVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    spaceId: 'space-1',
    collections: [styleCollection],
    collectionItems: [styleCollectionItem],
  });

  await page.getByLabel('Prompt').fill('A hand-painted doorway');
  await page.getByLabel('Style selector').selectOption('custom');
  await page.getByLabel('Image Ref One').check();
  await page.getByRole('button', { name: /Close/i }).click();
  await expect(page.getByText('Style: Custom selected refs · 1 ref')).toBeVisible();
  await page.getByRole('button', { name: /Generate/ }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.find((call) => call.eventName === 'forge-submit')?.args[0]).toMatchObject({
    styleVariantIds: [imageReferenceVariants[0].id],
  });
});

test('forge tray submits no-style override for empty custom style refs', async ({ page }) => {
  await mountComponent(page, 'ForgeTray', {
    allAssets: imageReferenceAssets,
    allVariants: imageReferenceVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    spaceId: 'space-1',
    collections: [styleCollection],
    collectionItems: [styleCollectionItem],
  });

  await page.getByLabel('Prompt').fill('A hand-painted doorway');
  await page.getByLabel('Style selector').selectOption('custom');
  await page.getByRole('button', { name: /Close/i }).click();
  await expect(page.getByText('Style: Custom selected refs · 0 refs')).toBeVisible();
  await page.getByRole('button', { name: /Generate/ }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.find((call) => call.eventName === 'forge-submit')?.args[0]).toMatchObject({
    disableStyle: true,
    styleVariantIds: undefined,
  });
});

test('style reference usage panel displays reverse usage', async ({ page }) => {
  await mountComponent(page, 'StyleReferenceUsagePanel', {
    spaceId: 'space-1',
    collections: [styleCollection],
    presets: [russafaPreset],
    outputs: [matrixAssets[0]],
  });

  await expect(page.getByText('Style reference usage')).toBeVisible();
  await expect(page.getByText('Russafa refs')).toBeVisible();
  await expect(page.getByText('Russafa watercolor')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Hero Image' })).toHaveAttribute('href', '/spaces/space-1/assets/asset-image');
});

test('forge tray with references renders the reference strip', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  await page.getByLabel('Prompt').fill('Blend these into one scene');
  await page.getByTitle('Add reference').click();
  await page.getByRole('button', { name: /Hero Image/ }).click();
  await page.getByRole('button', { name: /Done/i }).click();

  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-references', { fullPage: true });
});

test('forge tray on asset detail shows Current/New header', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    currentAsset: matrixAssets[0],
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  await expect(page.getByText('Hero Image')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Current' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New' })).toBeVisible();

  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-asset-detail', { fullPage: true });

  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByLabel('Asset name')).toBeVisible();
});

test('forge tray dark theme polish', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
    sendChatMessage: '__noop__',
  });
  await disableAnimations(page);

  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-dark-image', { fullPage: true });

  await page.getByTitle('Media type', { exact: true }).click();
  await page.getByTitle('Audio media').click();
  await page.getByTitle('Speech mode').click();
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-dark-speech', { fullPage: true });

  await page.getByTitle('Media type', { exact: true }).click();
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-dark-popover', { fullPage: true });
});

test('forge tray picker disables references incompatible with the selected media mode', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  await page.getByTitle('Add reference').click();
  await expect(page.getByText('Image references')).toBeVisible();
  await expect(page.getByRole('button', { name: /Hero Image/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Hero Video/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Hero Speech/ })).toBeDisabled();
  await page.getByRole('button', { name: /Close/i }).click();

  await page.getByTitle('Media type', { exact: true }).click();
  await page.getByTitle('Video media').click();
  await page.getByTitle('Add reference').click();
  await expect(page.getByText('Video references')).toBeVisible();
  await expect(page.getByRole('button', { name: /Hero Image/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Hero Video/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Hero Speech/ })).toBeDisabled();
});
