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

async function revealOptions(page: import('@playwright/test').Page) {
  await page.getByLabel('Prompt').focus();
  await expect(page.getByLabel('Media type')).toBeVisible();
}

async function selectDropdown(page: import('@playwright/test').Page, label: string, optionName: string | RegExp) {
  await page.getByLabel(label).click();
  await page.getByRole('option', { name: optionName }).click();
}

async function expectDropdownValue(page: import('@playwright/test').Page, label: string, valueText: string | RegExp) {
  await expect(page.getByLabel(label)).toContainText(valueText);
}

async function expectDropdownValueToFit(page: import('@playwright/test').Page, label: string) {
  const trigger = page.getByLabel(label);
  await expect.poll(async () => trigger.evaluate((node) => {
    const value = node.querySelector('span');
    return value ? value.scrollWidth <= value.clientWidth + 1 : false;
  })).toBe(true);
}

async function expectDropdownOptionDisabled(page: import('@playwright/test').Page, label: string, optionName: string | RegExp) {
  await page.getByLabel(label).click();
  await expect(page.getByRole('option', { name: optionName })).toBeDisabled();
  await page.keyboard.press('Escape');
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

async function resolvedShadow(page: import('@playwright/test').Page, value: string) {
  return page.evaluate((shadowValue) => {
    const probe = document.createElement('div');
    probe.style.boxShadow = shadowValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).boxShadow;
    probe.remove();
    return resolved;
  }, value);
}

async function expectLocatorAfterShadow(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
  shadow: string,
) {
  await expect.poll(
    async () => locator.evaluate((node) => getComputedStyle(node, '::after').boxShadow),
  ).toBe(await resolvedShadow(page, shadow));
}

async function selectMediaGroup(page: import('@playwright/test').Page, group: 'Image' | 'Video' | 'Audio') {
  await revealOptions(page);
  await selectDropdown(page, 'Media type', group);
}

/** Pick a media mode from the tray options row, then the audio sub-mode when needed. */
async function selectMode(page: import('@playwright/test').Page, config: typeof MEDIA_OPERATION_MATRIX[number]) {
  const group = groupLabel(config.mode);
  await selectMediaGroup(page, group);
  if (group === 'Audio') {
    await selectDropdown(page, 'Audio type', config.shortLabel);
  }
}

test('forge tray renders a screenshot matrix for every media mode', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
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

test('forge tray exposes media type as the first options dropdown', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
  });
  await disableAnimations(page);

  const mediaType = page.getByLabel('Media type');
  await expect(mediaType).toHaveCount(1);
  await expect(page.getByTitle('Video media')).toHaveCount(0);
  await expect(page.locator('[class*="tray"]').first()).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[class*="tray"]').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('[class*="tray"]').first()).toHaveCSS(
    'box-shadow',
    await resolvedShadow(page, 'var(--forge-bar-shadow)'),
  );
  await expect(page.locator('[class*="tray"]').first()).toHaveCSS(
    'transition-property',
    'border-color, box-shadow',
  );

  await revealOptions(page);
  await expect(mediaType).toBeVisible();
  await expectDropdownValue(page, 'Media type', 'Image');
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-mode-select', { fullPage: true });

  await selectDropdown(page, 'Media type', 'Video');
  await expect(page.getByLabel('Asset name')).toHaveValue('Video 1');
});

test('forge tray inline status rows fade without motion', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    forgeError: 'Generation needs billing access',
    forgeErrorCode: 'PAID_GENERATION_REQUIRED',
  });
  await disableAnimations(page);

  const errorRow = page.getByText('Generation needs billing access').locator('..');
  await expect(errorRow).toBeVisible();
  await expect(errorRow).toHaveCSS('transform', 'none');
  await expect.poll(
    () => errorRow.evaluate((node) => getComputedStyle(node).animationName),
  ).toContain('forgeErrorFadeIn');
  await expect(page.getByRole('link', { name: 'Upgrade' })).toBeVisible();
  await screenshot(page, 'forge-tray-inline-status-flat-motion', { fullPage: true });
});

test('forge tray makes the prompt the hero above the controls', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
  });
  await disableAnimations(page);

  const prompt = page.getByLabel('Prompt');
  const submit = page.getByRole('button', { name: 'Generate' });

  await revealOptions(page);
  const mediaType = page.getByLabel('Media type');
  const promptBox = await prompt.boundingBox();
  const mediaTypeBox = await mediaType.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(mediaTypeBox).not.toBeNull();
  expect(promptBox!.y).toBeLessThan(mediaTypeBox!.y);

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
  });
  await disableAnimations(page);

  await expect(page.getByLabel('Asset name')).toHaveCount(0);
  await screenshot(page, 'forge-tray-collapsed-no-name-chip', { fullPage: true });
  await revealOptions(page);

  const name = page.getByLabel('Asset name');
  await expect(name).toHaveValue('Image 1');

  await selectMediaGroup(page, 'Audio');
  await expect(name).toHaveValue('Audio 1');

  await name.fill('My jingle');
  await selectMediaGroup(page, 'Image');
  await expect(name).toHaveValue('My jingle');

  await page.mouse.click(10, 10);
  await expect(name).toBeVisible();

  await page.getByLabel('Prompt').fill('A compact chime');
  await page.getByRole('button', { name: 'Generate' }).click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual([
    expect.objectContaining({
      eventName: 'forge-submit',
      args: [
        expect.objectContaining({
          destination: expect.objectContaining({ assetName: 'My jingle' }),
        }),
      ],
    }),
  ]);
});

test('forge tray image options expose batch count', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
  });
  await disableAnimations(page);

  await page.getByLabel('Prompt').fill('Four explorations of a logo');
  await selectDropdown(page, 'Batch count', 'x4');

  await expect(page.getByLabel('Style selector')).toHaveCount(0);
  await expect(page.getByLabel('Batch mode')).toBeVisible();
  await expectDropdownValue(page, 'Batch mode', 'Explore');
  await expect(page.getByRole('button', { name: /Generate ×4/ })).toBeVisible();

  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-batch', { fullPage: true });
});

test('forge tray image model selection enforces reference budget', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: imageReferenceAssets,
    allVariants: imageReferenceVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
  });
  await disableAnimations(page);

  await page.getByLabel('Prompt').fill('Combine these references');
  await page.getByTitle('Add reference').click();
  await page.getByRole('button', { name: /Image Ref One/ }).click();
  await expect(page.locator('[class*="checkmark"]').first()).toHaveCSS(
    'color',
    await resolvedColor(page, 'var(--button-primary-text)'),
  );
  await page.getByRole('button', { name: /Image Ref Two/ }).click();
  await page.getByRole('button', { name: /Done/i }).click();

  const addAnotherReference = page.getByTitle('Add another reference');
  await addAnotherReference.hover();
  await expect(addAnotherReference).toHaveCSS('transform', 'none');
  await expect(addAnotherReference).toHaveCSS('transition-property', 'background-color, border-color, color, opacity');
  await expect(addAnotherReference).toHaveCSS(
    'background-color',
    await resolvedBackground(page, 'var(--color-status-processing-bg)'),
  );
  await screenshot(page, 'forge-tray-add-reference-token-hover', { fullPage: true });

  await expect(page.getByRole('button', { name: 'Derive' })).toBeEnabled();

  await selectDropdown(page, 'Image model', 'Flash');

  await expect(page.getByText('Flash supports 1 reference. Remove references or switch Pro.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Derive' })).toBeDisabled();
  await expectDropdownOptionDisabled(page, 'Image size', '2K');
  await expectDropdownOptionDisabled(page, 'Image size', '4K');

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
    stylePresets: [{ ...russafaPreset, reference_count: 2 }],
  });
  await disableAnimations(page);

  // Engage the tray so the per-mode options reveal before adjusting them.
  await page.getByLabel('Prompt').click();
  await selectDropdown(page, 'Image model', 'Flash');
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
    stylePresets: [{ ...russafaPreset, reference_count: 2 }],
  });
  await disableAnimations(page);

  // Engage the tray so the per-mode options reveal before adjusting them.
  await page.getByLabel('Prompt').click();
  await selectDropdown(page, 'Image model', 'Flash');
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
  });
  await disableAnimations(page);

  await selectMediaGroup(page, 'Video');

  await expect(page.getByLabel('Video resolution')).toBeVisible();
  await expectDropdownValue(page, 'Video resolution', '720p');
  await expectDropdownValueToFit(page, 'Video resolution');
  await selectDropdown(page, 'Video resolution', '1080p');
  await expectDropdownValue(page, 'Video resolution', '1080p');
  await expectDropdownValueToFit(page, 'Video resolution');

  await expect(page.getByLabel('Video duration')).toBeVisible();
  await selectDropdown(page, 'Video duration', '6s');
  await expectDropdownValue(page, 'Video duration', '6s');
  await expectDropdownValueToFit(page, 'Video duration');

  await expect(page.getByLabel('Video tier')).toBeVisible();
  await expectDropdownValueToFit(page, 'Video tier');
  await selectDropdown(page, 'Video tier', 'Fast');
  await expectDropdownValue(page, 'Video tier', 'Fast');
  await expectDropdownValueToFit(page, 'Video tier');
  await selectDropdown(page, 'Video resolution', '4k');
  await expectDropdownValue(page, 'Video resolution', '4k');
  await expectDropdownValueToFit(page, 'Video resolution');
  await selectDropdown(page, 'Video tier', 'Lite');
  await expectDropdownValue(page, 'Video tier', 'Lite');
  await expectDropdownValueToFit(page, 'Video tier');
  await expectDropdownValue(page, 'Video resolution', '1080p');
  await expectDropdownValueToFit(page, 'Video resolution');
  await expectDropdownOptionDisabled(page, 'Video resolution', '4k');

  await expect(page.getByLabel('Audio')).toHaveCount(0);
});

test('forge tray video picker enforces the three-reference budget', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: imageReferenceAssets,
    allVariants: imageReferenceVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
  });
  await disableAnimations(page);

  await selectMediaGroup(page, 'Video');
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
  await expect(page.locator('[class*="slotItem"] [class*="slotBadge"]')).toHaveText(['Ref', 'Ref', 'Ref']);
  await expect(page.locator('[class*="slotThumb"] [class*="slotBadge"]')).toHaveCount(0);
  const firstSlotThumb = page.locator('[class*="slotThumb"]').first();
  await expect(firstSlotThumb).toHaveCSS('transform', 'none');
  await firstSlotThumb.hover();
  await expect(firstSlotThumb).toHaveCSS('transform', 'none');
  await expect(page.getByRole('button', { name: /Remove Image Ref One/i })).toHaveCSS('box-shadow', 'none');
  await screenshot(page, 'forge-tray-video-references', { fullPage: true });
});

test('forge tray opens Style and Chat as separate full sheets', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    spaceId: 'space-1',
    sendChatMessage: '__noop__',
    requestChatHistory: '__noop__',
    clearChatSession: '__noop__',
    stylePresets: [russafaPreset],
  });
  await disableAnimations(page);

  await page.getByLabel('Prompt').fill('A cozy campfire at dusk');

  await selectDropdown(page, 'Style selector', 'Manage styles...');
  await expect(page.getByText('Style Library')).toBeVisible();
  await expect(page.locator('[class*="backdrop"]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[class*="backdrop"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const stylePanel = page.locator('[class*="stylePanel"]').first();
  await expect(stylePanel).toHaveCSS('box-shadow', 'none');
  await expect(stylePanel).toHaveCSS('transform', 'none');
  await expect.poll(
    () => stylePanel.evaluate((node) => getComputedStyle(node).animationName),
  ).not.toContain('slideUp');
  await expect(page.locator('[class*="defaultBadge"]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-style-sheet', { fullPage: true });
  await page.getByRole('button', { name: /Close/i }).click();
  await expect(page.getByText('Style Library')).toHaveCount(0);

  await page.getByTitle('Chat with Claude about your prompt').click();
  await expect(page.getByText('Chat with Claude')).toBeVisible();
  await expect(page.locator('[class*="backdrop"]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[class*="backdrop"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const chatPanel = page.locator('[class*="chatPanel"]').first();
  await expect(chatPanel).toHaveCSS('box-shadow', 'none');
  await expect(chatPanel).toHaveCSS('transform', 'none');
  await expect.poll(
    () => chatPanel.evaluate((node) => getComputedStyle(node).animationName),
  ).not.toContain('slide');
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-chat-sheet', { fullPage: true });
});

test('forge tray control bar keeps compact icon actions interactive', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    onUploadNewAsset: '__noop__',
    sendChatMessage: '__noop__',
    requestChatHistory: '__noop__',
    clearChatSession: '__noop__',
  });
  await disableAnimations(page);

  const addReferenceButton = page.getByRole('button', { name: 'Add reference' });
  const uploadButton = page.getByRole('button', { name: 'Upload media' });
  const chatButton = page.getByRole('button', { name: 'Chat' });

  for (const action of [addReferenceButton, uploadButton, chatButton]) {
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    if (!box) throw new Error('Expected icon action to have a rendered box');
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
  }

  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-icon-actions', { fullPage: true });

  await addReferenceButton.click();
  await expect(page.getByText('Image references')).toBeVisible();
  await expect(page.locator('[class*="backdrop"]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[class*="backdrop"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: /Close/i }).click();

  const fileChooserPromise = page.waitForEvent('filechooser');
  await uploadButton.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'forest-gate.png',
    mimeType: 'image/png',
    buffer: Buffer.from('fake image'),
  });
  await expect(page.getByText('Create New Asset')).toBeVisible();
  await expect(page.locator('[class*="uploadPromptOverlay"]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[class*="uploadPromptOverlay"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('[class*="uploadPromptModal"]')).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('[class*="uploadPromptModal"]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('button', { name: 'Create Asset' })).toBeEnabled();
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-upload-prompt', { fullPage: true });
  await page.getByPlaceholder('Asset name').fill('');
  await expect(page.getByRole('button', { name: 'Create Asset' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Create New Asset')).toHaveCount(0);

  await chatButton.click();
  await expect(page.getByText('Chat with Claude')).toBeVisible();
});

test('forge chat actions send messages and apply suggested prompts', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });
  const suggestedPrompt = 'Paint a lantern-lit forest gate';

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    chatMessages: [{
      id: 'chat-user-1',
      role: 'user',
      content: 'Can you make the scene moodier?',
      createdAt: baseTime,
    }, {
      id: 'chat-1',
      role: 'assistant',
      content: 'Try this direction.',
      createdAt: baseTime,
      descriptions: [{
        variantId: 'variant-1',
        assetName: 'Crystal gate',
        description: 'A blue crystal gate with a clean silhouette.',
        cached: true,
      }],
      suggestedPrompt,
    }],
    sendChatMessage: '__record__:chat-send',
    requestChatHistory: '__noop__',
    clearChatSession: '__noop__',
  });
  await disableAnimations(page);

  await page.getByLabel('Prompt').fill('Seed prompt');
  await page.getByTitle('Chat with Claude about your prompt').click();
  await expect(page.getByText('Chat with Claude')).toBeVisible();
  await expect(page.getByText('Can you make the scene moodier?')).toHaveCSS(
    'color',
    await resolvedColor(page, 'var(--button-primary-text)'),
  );
  await expect(page.locator('[class*="suggestedPrompt"]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByText('Suggested Prompt', { exact: true })).toHaveCSS('text-transform', 'none');
  await expect(page.getByText('Suggested Prompt', { exact: true })).toHaveCSS('letter-spacing', 'normal');
  const descriptionsPanel = page.locator('[class*="descriptionsDetails"]');
  const descriptionsSummary = page.getByRole('button', { name: 'Image analysis (1)' });
  await expect(descriptionsPanel.locator('summary')).toHaveCount(0);
  await expect(descriptionsSummary).toHaveAttribute('aria-expanded', 'false');
  await expect(descriptionsSummary).toHaveCSS('background-color', await resolvedBackground(page, 'var(--color-surface)'));
  await page.getByText('Image analysis (1)').hover();
  await expect(descriptionsSummary).toHaveCSS('background-color', await resolvedBackground(page, 'var(--button-ghost-bg-hover)'));
  await screenshot(page, 'forge-tray-chat-token-surfaces', { fullPage: true });
  await descriptionsSummary.click();
  await expect(descriptionsSummary).toHaveAttribute('aria-expanded', 'true');
  const descriptionName = page.locator('[class*="descriptionName"]').filter({ hasText: 'Crystal gate' });
  await expect(descriptionName).toHaveCSS('text-transform', 'none');
  await expect(descriptionName).toHaveCSS('letter-spacing', 'normal');
  await expect(page.getByText('cached', { exact: true })).toHaveCSS('text-transform', 'none');
  await expect(page.getByText('cached', { exact: true })).toHaveCSS('letter-spacing', 'normal');
  await expect(page.getByText('A blue crystal gate with a clean silhouette.')).toBeVisible();
  await screenshot(page, 'forge-tray-chat-analysis-expanded', { fullPage: true });

  await page.getByPlaceholder('Type a message...').fill('Make it moodier');
  await page.getByRole('button', { name: 'Send message' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toHaveLength(1);
  expect(calls[0].eventName).toBe('chat-send');
  expect(calls[0].args[0]).toBe('Make it moodier');
  expect(calls[0].args[1]).toEqual({ prompt: 'Seed prompt', slotVariantIds: [] });

  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByLabel('Prompt')).toHaveValue(suggestedPrompt);
  await expect(page.getByText('Chat with Claude')).toHaveCount(0);
});

test('forge chat loading dots avoid scale motion', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    isChatLoading: true,
    sendChatMessage: '__noop__',
    requestChatHistory: '__noop__',
    clearChatSession: '__noop__',
  });

  await page.getByTitle('Chat with Claude about your prompt').click();
  await expect(page.getByText('Chat with Claude')).toBeVisible();

  const loadingDots = page.locator('span[class*="loadingDot"]');
  await expect(loadingDots).toHaveCount(3);
  await expect(loadingDots.first()).toHaveCSS('transform', 'none');
  await expect(loadingDots.first()).not.toHaveCSS('animation-name', /bounce/);

  await screenshot(page, 'forge-chat-flat-loading-dots', { fullPage: true });
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

  await revealOptions(page);
  await selectDropdown(page, 'Style selector', 'Manage styles...');
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

  await revealOptions(page);
  await selectDropdown(page, 'Style selector', 'Manage styles...');
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
  await selectDropdown(page, 'Style selector', russafaPreset.name);
  await expectDropdownValue(page, 'Style selector', russafaPreset.name);
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
  await selectDropdown(page, 'Style selector', 'No style');
  await expectDropdownValue(page, 'Style selector', 'No style');
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
  await selectDropdown(page, 'Style selector', 'Custom refs');
  await page.getByLabel('Image Ref One').check();
  await page.getByRole('button', { name: /Close/i }).click();
  await expectDropdownValue(page, 'Style selector', 'Custom refs (1)');
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
  await selectDropdown(page, 'Style selector', 'Custom refs');
  await page.getByRole('button', { name: /Close/i }).click();
  await expectDropdownValue(page, 'Style selector', 'Custom refs');
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

  await expect(page.getByRole('region', { name: 'Style reference usage' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Style reference usage' })).toHaveCSS('border-top-width', '0px');
  await expect(page.getByRole('region', { name: 'Style reference usage' })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByText('Style usage')).toBeVisible();
  await expect(page.getByText('3', { exact: true })).toBeVisible();
  await expect(page.getByText('Russafa refs')).toBeVisible();
  await expect(page.getByText('Russafa watercolor')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Hero Image' })).toHaveAttribute('href', '/spaces/space-1/assets/asset-image');

  await screenshot(page, 'style-reference-usage-compact', { fullPage: true });
});

test('style reference usage panel stays hidden when empty', async ({ page }) => {
  await mountComponent(page, 'StyleReferenceUsagePanel', {
    spaceId: 'space-1',
    collections: [],
    presets: [],
    outputs: [],
  });

  await expect(page.getByRole('region', { name: 'Style reference usage' })).toHaveCount(0);
});

test('forge tray with references renders the reference strip', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
  });
  await disableAnimations(page);

  await page.getByLabel('Prompt').fill('Blend these into one scene');
  await page.getByTitle('Add reference').click();
  await page.getByRole('button', { name: /Hero Image/ }).click();
  await page.getByRole('button', { name: /Done/i }).click();

  await expect(page.getByRole('button', { name: 'Remove Hero Image' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add reference' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add another reference' })).toBeVisible();
  await expect(page.locator('img[draggable="false"]')).toHaveCount(0);
  const slotItem = page.locator('[class*="slotItem"][title="Hero Image"]');
  await expect(slotItem).toBeVisible();
  const slotThumb = slotItem.locator('[class*="slotThumb"]');
  const removeButton = page.getByRole('button', { name: 'Remove Hero Image' });
  await removeButton.hover();
  await expect(slotThumb).toHaveCSS('transform', 'none');
  await expect(removeButton).toHaveCSS('transform', 'none');
  await expect(removeButton).toHaveCSS('transition-property', 'background-color, border-color, color, opacity');
  await expect(page.locator('[class*="slotTooltip"]')).toHaveCount(0);
  await screenshot(page, 'forge-tray-references', { fullPage: true });

  await removeButton.click();
  await expect(removeButton).toHaveCount(0);
});

test('forge tray on asset detail shows compact destination dropdown', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    currentAsset: matrixAssets[0],
  });
  await disableAnimations(page);

  await expect(page.getByText('Hero Image')).toHaveCount(0);
  await expect(page.getByText('Destination')).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'Destination' })).toHaveCount(0);
  await expectDropdownValue(page, 'Destination', 'Current');

  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-asset-detail', { fullPage: true });

  await selectDropdown(page, 'Destination', 'New');
  await expect(page.getByLabel('Asset name')).toBeVisible();
  await expectDropdownValue(page, 'Destination', 'New');
});

test('forge tray destination dropdown uses shared select behavior', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    currentAsset: matrixAssets[0],
  });
  await disableAnimations(page);

  const destination = page.getByLabel('Destination');
  await expectDropdownValue(page, 'Destination', 'Current');

  await destination.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: 'New' })).toBeVisible();
  await page.keyboard.press('Escape');
  await selectDropdown(page, 'Destination', 'New');

  await expectDropdownValue(page, 'Destination', 'New');
  await expect(page.getByLabel('Asset name')).toBeVisible();
});

test('forge tray destination dropdown disables current destination when incompatible', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    currentAsset: matrixAssets[0],
  });
  await disableAnimations(page);

  await selectMediaGroup(page, 'Video');

  await expectDropdownValue(page, 'Destination', 'New');
  await expectDropdownOptionDisabled(page, 'Destination', 'Current');
});

test('forge tray collapses after touching the destination dropdown then leaving', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    currentAsset: matrixAssets[0],
  });
  await disableAnimations(page);

  const reveal = page.getByTestId('forge-options-reveal');
  const revealHeight = async () => (await reveal.boundingBox())?.height ?? 0;

  // Per-mode options are collapsed while the tray rests.
  await expect.poll(revealHeight).toBeLessThan(2);

  // Engaging the prompt reveals them.
  await page.getByLabel('Prompt').click();
  await expect.poll(revealHeight).toBeGreaterThan(20);

  // Touching the destination dropdown and then clicking outside must collapse the
  // tray again.
  await selectDropdown(page, 'Destination', 'New');
  await page.mouse.click(10, 10);
  await expect.poll(revealHeight).toBeLessThan(2);
});

test('forge tray keeps mode and options on one compact row at narrow widths', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 720 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendChatMessage: '__noop__',
    spaceId: 'space-1',
  });
  await disableAnimations(page);
  await revealOptions(page);

  await selectDropdown(page, 'Batch count', 'x2');

  const revealInner = page.getByTestId('forge-options-reveal').locator('> div');
  const row = page.getByTestId('forge-options-row');
  await expect(row).toBeVisible();
  await expect(page.getByLabel('Media type')).toBeVisible();

  const geometry = await row.evaluate((node) => {
    const rowBox = node.getBoundingClientRect();
    const controlTops = [...node.children]
      .map((child) => {
        const box = child.getBoundingClientRect();
        return { top: box.top, height: box.height };
      })
      .filter((box) => box.height > 0 && box.top > 0)
      .map((box) => Math.round(box.top));

    return {
      rowHeight: rowBox.height,
      topSpread: Math.max(...controlTops) - Math.min(...controlTops),
    };
  });
  expect(geometry.topSpread).toBeLessThanOrEqual(8);
  expect(geometry.rowHeight).toBeLessThanOrEqual(40);
  const rowWidth = await row.evaluate((node) => node.scrollWidth);
  expect(rowWidth).toBeGreaterThan(360);
  const batchModeBox = await page.getByLabel('Batch mode').boundingBox();
  const revealBox = await revealInner.boundingBox();
  if (!batchModeBox || !revealBox) throw new Error('Expected batch mode control to render inside the options reveal');
  expect(batchModeBox.x + batchModeBox.width).toBeLessThanOrEqual(revealBox.x + revealBox.width);

  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-narrow-options-row', { fullPage: true });
});

test('forge tray dark theme polish', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendChatMessage: '__noop__',
  });
  await disableAnimations(page);

  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-dark-image', { fullPage: true });

  await selectMediaGroup(page, 'Audio');
  await selectDropdown(page, 'Audio type', 'Speech');
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-dark-speech', { fullPage: true });

  await revealOptions(page);
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-dark-mode-select', { fullPage: true });
});

test('forge tray picker disables references incompatible with the selected media mode', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 760 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
  });
  await disableAnimations(page);

  await page.getByTitle('Add reference').click();
  await expect(page.getByText('Image references')).toBeVisible();
  await expect(page.locator('[class*="backdrop"]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[class*="backdrop"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const assetPickerModal = page.locator('[class*="modal"]').first();
  await expect(assetPickerModal).toHaveCSS('box-shadow', 'none');
  await expect(assetPickerModal).toHaveCSS('transform', 'none');
  await expect.poll(
    () => assetPickerModal.evaluate((node) => getComputedStyle(node).animationName),
  ).not.toContain('slideUp');
  await expect(page.getByRole('button', { name: /Hero Image/ })).toBeEnabled();
  const incompatibleVideo = page.getByRole('button', { name: /Hero Video, animation \/ video\. Image mode cannot use video references/ });
  await expect(incompatibleVideo).toBeDisabled();
  await expect(page.getByRole('button', { name: /Hero Speech/ })).toBeDisabled();
  await expect(page.getByText('Image mode cannot use video references')).toHaveCount(0);
  await expect(page.getByText('Unavailable')).toHaveCount(2);
  await expect(page.getByText('Character (1)', { exact: true })).toHaveCSS('text-transform', 'none');
  await expect(page.getByText('Character (1)', { exact: true })).toHaveCSS('letter-spacing', 'normal');
  await expect(incompatibleVideo).toHaveCSS('opacity', '1');
  const heroImageChoice = page.getByRole('button', { name: /Hero Image, character \/ image/ }).first();
  await heroImageChoice.hover();
  const heroImageThumbnail = heroImageChoice.locator('[class*="thumbnailWrapper"]').first();
  await expect(heroImageThumbnail).toHaveCSS('box-shadow', 'none');
  await expect(heroImageThumbnail).toHaveCSS('transform', 'none');
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-asset-picker', { fullPage: true });

  await heroImageChoice.click();
  await expect(heroImageChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('In Tray (1)', { exact: true })).toHaveCSS('text-transform', 'none');
  await expect(page.getByText('In Tray (1)', { exact: true })).toHaveCSS('letter-spacing', 'normal');
  await expectLocatorAfterShadow(
    page,
    heroImageThumbnail,
    'var(--selection-ring)',
  );
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-asset-picker-selected-reference', { fullPage: true });
  await heroImageChoice.click();
  await expect(heroImageChoice).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: /Close/i }).click();

  await selectMediaGroup(page, 'Video');
  await page.getByTitle('Add reference').click();
  await expect(page.getByText('Video references')).toBeVisible();
  await expect(page.getByRole('button', { name: /Hero Image/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Hero Video/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Hero Speech/ })).toBeDisabled();
});
