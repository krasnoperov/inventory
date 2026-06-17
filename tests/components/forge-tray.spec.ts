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

/** Disable CSS animations/transitions so screenshots capture settled state. */
async function disableAnimations(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }',
  });
}

/** Top-level group label for a media mode (matches the segmented control titles). */
function groupLabel(mode: string): 'Image' | 'Video' | 'Audio' {
  if (mode === 'image') return 'Image';
  if (mode === 'video') return 'Video';
  return 'Audio';
}

/** Select a media mode through the two-level selector (group → audio sub-mode). */
async function selectMode(page: import('@playwright/test').Page, config: typeof MEDIA_OPERATION_MATRIX[number]) {
  const group = groupLabel(config.mode);
  await page.getByTitle(`${group} media`).click();
  if (group === 'Audio') {
    await page.getByTitle(`${config.label} mode`).click();
  }
}

test('forge tray renders a screenshot matrix for every media mode', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });

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

    // Active segment reflects the selected mode.
    const activeSegmentTitle = groupLabel(config.mode) === 'Audio' ? `${config.label} mode` : `${groupLabel(config.mode)} media`;
    await expect(page.getByTitle(activeSegmentTitle)).toHaveClass(/active/);

    // Name is auto-generated per media group (Image N / Video N / Audio N).
    await expect(page.getByLabel('Asset name')).toHaveValue(`${groupLabel(config.mode)} 1`);

    const buttonLabel = config.mode === 'image' ? 'Generate' : `Generate ${config.shortLabel}`;
    await expect(page.getByRole('button', { name: buttonLabel })).toBeVisible();

    const batchSelector = page.locator('select[title="Number of variants to generate"]');
    const styleBadge = page.getByTitle('Configure style');

    if (config.supportsBatch) {
      await expect(batchSelector).toBeVisible();
    } else {
      await expect(batchSelector).toHaveCount(0);
    }

    if (config.supportsStyle) {
      await expect(styleBadge).toBeVisible();
    } else {
      await expect(styleBadge).toHaveCount(0);
    }

    await page.mouse.move(0, 0);
    await screenshot(page, `forge-tray-media-mode-${config.mode}`, { fullPage: true });
  }
});

test('forge tray makes the prompt the hero at the top of the tray', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  const prompt = page.getByLabel('Prompt');
  const typeSelector = page.getByTitle('Image media');
  const submit = page.getByRole('button', { name: 'Generate' });

  await expect(prompt).toBeVisible();
  await expect(typeSelector).toBeVisible();

  // Prompt sits above the controls; controls sit above nothing else of note.
  const promptBox = await prompt.boundingBox();
  const typeBox = await typeSelector.boundingBox();
  const submitBox = await submit.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(typeBox).not.toBeNull();
  expect(submitBox).not.toBeNull();
  expect(promptBox!.y).toBeLessThan(typeBox!.y);
  expect(promptBox!.y).toBeLessThan(submitBox!.y);

  // With no prompt text, submit is disabled (prompt is required).
  await expect(submit).toBeDisabled();
  await prompt.fill('A cozy campfire at dusk');
  await expect(submit).toBeEnabled();
});

test('forge tray auto-names by media group and stays editable', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });

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

  await page.getByTitle('Video media').click();
  await expect(name).toHaveValue('Video 1');

  await page.getByTitle('Audio media').click();
  await expect(name).toHaveValue('Audio 1');

  // Once edited, the name stops tracking the auto default.
  await name.fill('My jingle');
  await page.getByTitle('Image media').click();
  await expect(name).toHaveValue('My jingle');
});

test('forge tray opens Style and Chat as separate full sheets', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });

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

  // Style sheet
  await page.getByTitle('Configure style').click();
  await expect(page.getByText('Space Style')).toBeVisible();
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-style-sheet', { fullPage: true });
  await page.getByRole('button', { name: /Close/i }).click();
  await expect(page.getByText('Space Style')).toHaveCount(0);

  // Chat sheet
  await page.getByTitle('Chat with Claude about your prompt').click();
  await expect(page.getByText('Chat with Claude')).toBeVisible();
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-chat-sheet', { fullPage: true });
});

test('forge tray reveals batch mode toggle when batching', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  await page.getByLabel('Prompt').fill('Four explorations of a logo');
  await page.locator('select[title="Number of variants to generate"]').selectOption('4');

  await expect(page.getByRole('button', { name: 'Explore' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate ×4/ })).toBeVisible();

  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-batch', { fullPage: true });
});

test('forge tray with references renders the reference strip', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });

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

test('forge tray on asset detail shows Current/New toggle with the asset name', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: matrixAssets,
    allVariants: matrixVariants,
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    currentAsset: matrixAssets[0],
    sendStyleSet: '__noop__',
  });
  await disableAnimations(page);

  // Existing-asset destination shows the asset name + a destination toggle.
  await expect(page.getByText('Hero Image')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Current' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New' })).toBeVisible();

  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-asset-detail', { fullPage: true });

  // Switching to New surfaces the auto-named, editable name field.
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByLabel('Asset name')).toBeVisible();
});

test('forge tray dark theme polish', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 900, height: 720 });

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

  await page.getByTitle('Audio media').click();
  await page.getByTitle('Speech mode').click();
  await page.mouse.move(0, 0);
  await screenshot(page, 'forge-tray-dark-speech', { fullPage: true });
});

test('forge tray picker disables references incompatible with the selected media mode', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });

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

  await page.getByTitle('Video media').click();
  await page.getByTitle('Add reference').click();
  await expect(page.getByText('Video references')).toBeVisible();
  await expect(page.getByRole('button', { name: /Hero Image/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Hero Video/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Hero Speech/ })).toBeDisabled();
  await page.getByRole('button', { name: /Close/i }).click();

  await page.getByTitle('Audio media').click();
  await page.getByTitle('Speech mode').click();
  await page.getByTitle('Add reference').click();
  await expect(page.getByText('Speech references')).toBeVisible();
  await expect(page.getByRole('button', { name: /Hero Image/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Hero Video/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Hero Speech/ })).toBeEnabled();
});
