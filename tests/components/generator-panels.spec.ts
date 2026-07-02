import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;
const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#d9ddf7"/><path d="M20 68 42 42l14 16 10-12 12 22z" fill="#6f6ce8"/></svg>';

async function mockImages(page: Page) {
  await page.route('**/api/images/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: imageSvg,
  }));
}

async function resetScrollablePanels(page: Page) {
  await page.evaluate(() => {
    for (const element of Array.from(document.querySelectorAll('div'))) {
      if (element.scrollHeight > element.clientHeight) {
        element.scrollTop = 0;
      }
    }
  });
}

async function selectOption(page: Page, label: string, optionName: string | RegExp) {
  await page.getByLabel(label).click();
  await page.getByRole('option', { name: optionName }).click();
}

async function expectTransparentSheetHost(page: Page) {
  const sheetHost = page.locator('[class*="sheetHost"]').first();
  await expect(sheetHost).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(sheetHost).toHaveCSS('backdrop-filter', 'none');
}

async function expectDockedGeneratorSheet(page: Page, panel: Locator) {
  const sheetHost = page.locator('[class*="sheetHost"]').first();
  await expect(sheetHost).toHaveCSS('pointer-events', 'none');
  await expect(panel).toHaveCSS('pointer-events', 'auto');
  await expect(panel).toHaveCSS('background-color', await resolvedBackground(page, 'var(--workspace-panel-bg)'));

  const geometry = await panel.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      rightGap: window.innerWidth - rect.right,
      bottomGap: window.innerHeight - rect.bottom,
      width: rect.width,
      viewportWidth: window.innerWidth,
    };
  });
  expect(geometry.rightGap).toBeGreaterThanOrEqual(15);
  expect(geometry.rightGap).toBeLessThanOrEqual(17);
  expect(geometry.bottomGap).toBeGreaterThanOrEqual(200);
  expect(geometry.width).toBeLessThanOrEqual(Math.min(520, geometry.viewportWidth - 32));
}

async function expectMobileGeneratorSheetAboveTray(page: Page, panel: Locator) {
  const sheetHost = page.locator('[class*="sheetHost"]').first();
  await expect(sheetHost).toHaveCSS('pointer-events', 'none');
  await expect(panel).toHaveCSS('pointer-events', 'auto');

  const geometry = await panel.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      leftGap: rect.left,
      rightGap: window.innerWidth - rect.right,
      bottomGap: window.innerHeight - rect.bottom,
    };
  });
  expect(geometry.leftGap).toBeGreaterThanOrEqual(7);
  expect(geometry.rightGap).toBeGreaterThanOrEqual(7);
  expect(geometry.bottomGap).toBeGreaterThanOrEqual(160);
}

async function resolvedBackground(page: Page, value: string) {
  return page.evaluate((backgroundValue) => {
    const probe = document.createElement('div');
    probe.style.background = backgroundValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
  }, value);
}

async function resolvedColor(page: Page, value: string) {
  return page.evaluate((colorValue) => {
    const probe = document.createElement('div');
    probe.style.color = colorValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);
}

async function resolvedBackgroundIn(scope: Locator, value: string) {
  return scope.evaluate((element, backgroundValue) => {
    const probe = document.createElement('div');
    probe.style.background = backgroundValue;
    element.appendChild(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
  }, value);
}

async function resolvedColorIn(scope: Locator, value: string) {
  return scope.evaluate((element, colorValue) => {
    const probe = document.createElement('div');
    probe.style.color = colorValue;
    element.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);
}

async function resolvedShadow(page: Page, value: string) {
  return page.evaluate((shadowValue) => {
    const probe = document.createElement('div');
    probe.style.boxShadow = shadowValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).boxShadow;
    probe.remove();
    return resolved;
  }, value);
}

async function expectLocatorAfterShadow(page: Page, locator: Locator, shadow: string) {
  await expect.poll(
    async () => locator.evaluate((node) => getComputedStyle(node, '::after').boxShadow),
  ).toBe(await resolvedShadow(page, shadow));
}

const sourceAsset = {
  id: 'hero',
  name: 'Hero Character',
  type: 'character',
  media_kind: 'image',
  tags: '',
  parent_asset_id: null,
  active_variant_id: 'hero-variant',
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

const sourceVariant = {
  id: 'hero-variant',
  asset_id: sourceAsset.id,
  media_kind: 'image',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: 'images/space/hero-variant.png',
  thumb_key: 'images/space/hero-variant-thumb.webp',
  media_key: 'images/space/hero-variant.png',
  media_mime_type: 'image/png',
  media_size_bytes: 123,
  media_width: 1024,
  media_height: 1024,
  media_duration_ms: null,
  recipe: '{}',
  starred: false,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
  description: null,
  quality_rating: null,
  rated_at: null,
};

test('rotation panel uses shared fields without changing submit payload', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 900, height: 820 });
  await mountComponent(page, 'RotationPanel', {
    sourceVariant,
    sourceAsset,
    rotationSets: [],
    rotationViews: [],
    variants: [sourceVariant],
    hasDefaultStyle: true,
    onSubmit: '__record__:submitRotation',
    onCancel: '__record__:cancelRotation',
    onClose: '__record__:closeRotation',
  });

  await expect(page.getByRole('heading', { name: 'Generate Rotation Set' })).toBeVisible();
  await expectTransparentSheetHost(page);
  const rotationPanel = page.locator('[class*="sheetPanel"]').first();
  await expect(rotationPanel).toHaveCSS('box-shadow', 'none');
  await expect(rotationPanel).toHaveCSS('transform', 'none');
  await expect(rotationPanel).toHaveCSS('border-radius', '8px');
  await expectDockedGeneratorSheet(page, rotationPanel);
  await expect(page.locator('[class*="sourceName"]')).toHaveCSS('white-space', 'normal');
  await expect(page.locator('[class*="sourceName"]')).toHaveCSS('text-overflow', 'clip');
  await expect(page.getByText('Configuration')).toHaveCSS('text-transform', 'none');
  await expect.poll(
    () => rotationPanel.evaluate((node) => getComputedStyle(node).animationName),
  ).not.toContain('slideUp');
  await selectOption(page, 'Configuration', /Turnaround/);
  await selectOption(page, 'Generation Mode', 'Single-Shot');
  await page.getByPlaceholder('e.g. a pixel art warrior character').fill('pixel art warrior');
  await page.getByLabel('No style').check();
  await resetScrollablePanels(page);
  await screenshot(page, 'rotation-panel-shared-fields', { fullPage: true });

  await page.getByRole('button', { name: 'Start Rotation' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toContainEqual(expect.objectContaining({
    eventName: 'submitRotation',
    args: [expect.objectContaining({
      sourceVariantId: 'hero-variant',
      config: 'turnaround',
      subjectDescription: 'pixel art warrior',
      disableStyle: true,
      generationMode: 'single-shot',
    })],
  }));
});

test('rotation panel keeps rating controls in footer chrome', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 900, height: 820 });

  const completedRotationSet = {
    id: 'rotation-set-1',
    source_variant_id: sourceVariant.id,
    status: 'completed',
    config: JSON.stringify({ type: '4-directional' }),
    total_steps: 4,
    current_step: 4,
    error_message: null,
    created_at: baseTime,
    updated_at: baseTime,
  };
  const northVariant = { ...sourceVariant, id: 'rotation-north', quality_rating: 'approved' };
  const eastVariant = { ...sourceVariant, id: 'rotation-east', quality_rating: null };
  const southVariant = { ...sourceVariant, id: 'rotation-south', quality_rating: 'rejected' };
  const westVariant = { ...sourceVariant, id: 'rotation-west', quality_rating: null };
  const longEastDirection = 'East side production view with a long readable label';
  const rotationViews = [
    { id: 'view-north', rotation_set_id: completedRotationSet.id, variant_id: northVariant.id, direction: 'North', step_index: 0, prompt: null, created_at: baseTime, updated_at: baseTime },
    { id: 'view-east', rotation_set_id: completedRotationSet.id, variant_id: eastVariant.id, direction: longEastDirection, step_index: 1, prompt: null, created_at: baseTime, updated_at: baseTime },
    { id: 'view-south', rotation_set_id: completedRotationSet.id, variant_id: southVariant.id, direction: 'South', step_index: 2, prompt: null, created_at: baseTime, updated_at: baseTime },
    { id: 'view-west', rotation_set_id: completedRotationSet.id, variant_id: westVariant.id, direction: 'West', step_index: 3, prompt: null, created_at: baseTime, updated_at: baseTime },
  ];

  await mountComponent(page, 'RotationPanel', {
    sourceVariant,
    sourceAsset,
    rotationSets: [completedRotationSet],
    rotationViews,
    variants: [sourceVariant, northVariant, eastVariant, southVariant, westVariant],
    hasDefaultStyle: true,
    onSubmit: '__record__:submitRotation',
    onCancel: '__record__:cancelRotation',
    onClose: '__record__:closeRotation',
    onRateVariant: '__record__:rateRotation',
  });

  await expect(page.getByRole('heading', { name: 'Rotation Complete' })).toBeVisible();
  await expectTransparentSheetHost(page);
  await expect(page.getByRole('radiogroup', { name: 'Selected rotation view rating' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Approve' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Reject' })).toHaveAttribute('aria-checked', 'false');

  const approvedDirection = page.getByRole('button', { name: /North/ });
  await expectLocatorAfterShadow(page, approvedDirection, 'var(--selection-ring)');
  const approvedBorderColor = await approvedDirection.evaluate((element) => getComputedStyle(element).borderLeftColor);
  await approvedDirection.hover();
  await expect.poll(
    () => approvedDirection.evaluate((element) => getComputedStyle(element).borderLeftColor),
  ).toBe(approvedBorderColor);

  const longDirectionLabel = page.getByText(longEastDirection);
  await expect(longDirectionLabel).toHaveCSS('white-space', 'normal');
  await expect(longDirectionLabel).toHaveCSS('text-overflow', 'clip');

  const eastDirection = page.getByRole('button', { name: /East side production view/ });
  const directionGeometry = await eastDirection.evaluate((node) => {
    const image = node.querySelector('img');
    const label = Array.from(node.querySelectorAll('span')).find((entry) => entry.textContent?.includes('East side production view'));
    if (!image || !label) return null;
    const imageBox = image.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    return {
      labelBelowImage: labelBox.top >= imageBox.bottom - 1,
    };
  });
  expect(directionGeometry).not.toBeNull();
  expect(directionGeometry!.labelBelowImage).toBe(true);
  await eastDirection.focus();
  await expect(eastDirection).toHaveCSS('box-shadow', await resolvedShadow(page, 'var(--focus-ring)'));
  await expectLocatorAfterShadow(page, eastDirection, 'none');
  await eastDirection.click();
  await eastDirection.hover();
  await expect(page.getByRole('radio', { name: 'Approve' })).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'Reject' })).toHaveCount(1);
  await expect(page.locator('[class*="ratingBadge"], [class*="ratingButtons"]')).toHaveCount(0);
  const ratingContext = page.getByText(longEastDirection).last();
  await expect(ratingContext).toHaveCSS('white-space', 'normal');
  await expect(ratingContext).toHaveCSS('text-overflow', 'clip');

  await resetScrollablePanels(page);
  await screenshot(page, 'rotation-panel-rating-chrome', { fullPage: true });

  await page.getByRole('radio', { name: 'Reject' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toContainEqual(expect.objectContaining({
    eventName: 'rateRotation',
    args: ['rotation-east', 'rejected'],
  }));
});

test('generator panels stay above mobile ForgeTray offset', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await mountComponent(page, 'RotationPanel', {
    sourceVariant,
    sourceAsset,
    rotationSets: [],
    rotationViews: [],
    variants: [sourceVariant],
    hasDefaultStyle: true,
    onSubmit: '__record__:submitRotation',
    onCancel: '__record__:cancelRotation',
    onClose: '__record__:closeRotation',
  });
  await expectMobileGeneratorSheetAboveTray(page, page.locator('[class*="sheetPanel"]').first());
});

test('generator panels use tokenized completed progress surfaces', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 900, height: 820 });

  const rotationSet = {
    id: 'rotation-progress',
    source_variant_id: sourceVariant.id,
    status: 'generating',
    config: JSON.stringify({ type: '4-directional' }),
    total_steps: 4,
    current_step: 1,
    error_message: null,
    created_at: baseTime,
    updated_at: baseTime,
  };
  const completedRotationVariant = { ...sourceVariant, id: 'rotation-complete' };
  const completedEastRotationVariant = { ...sourceVariant, id: 'rotation-complete-east' };
  const rotationViews = [
    { id: 'rotation-view-1', rotation_set_id: rotationSet.id, variant_id: completedRotationVariant.id, direction: 'North', step_index: 0, prompt: null, created_at: baseTime, updated_at: baseTime },
    { id: 'rotation-view-2', rotation_set_id: rotationSet.id, variant_id: completedEastRotationVariant.id, direction: 'East', step_index: 1, prompt: null, created_at: baseTime, updated_at: baseTime },
  ];

  await mountComponent(page, 'RotationPanel', {
    sourceVariant,
    sourceAsset,
    rotationSets: [rotationSet],
    rotationViews,
    variants: [sourceVariant, completedRotationVariant, completedEastRotationVariant],
    hasDefaultStyle: true,
    onSubmit: '__record__:submitRotation',
    onCancel: '__record__:cancelRotation',
    onClose: '__record__:closeRotation',
  });

  const rotationProgressCell = page.locator('[class*="directionCell"][class*="completed"]').nth(1);
  const completedSurface = await resolvedBackgroundIn(rotationProgressCell, 'var(--color-status-completed-bg)');
  const completedBorder = await resolvedColorIn(rotationProgressCell, 'var(--color-status-completed)');
  await expect(rotationProgressCell).toHaveCSS('background-color', completedSurface);
  await expect(rotationProgressCell).toHaveCSS('border-color', completedBorder);
  await screenshot(page, 'rotation-panel-tokenized-progress', { fullPage: true });
});

test('generator panels use tokenized failed error surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 820 });

  const failedRotationSet = {
    id: 'rotation-failed',
    source_variant_id: sourceVariant.id,
    status: 'failed',
    config: JSON.stringify({ type: '4-directional', subjectDescription: 'pixel art warrior' }),
    total_steps: 4,
    current_step: 1,
    error_message: 'Rotation provider failed',
    created_at: baseTime,
    updated_at: baseTime,
  };

  await mountComponent(page, 'RotationPanel', {
    sourceVariant,
    sourceAsset,
    rotationSets: [failedRotationSet],
    rotationViews: [],
    variants: [sourceVariant],
    hasDefaultStyle: true,
    onSubmit: '__record__:submitRotation',
    onCancel: '__record__:cancelRotation',
    onClose: '__record__:closeRotation',
  });

  await expect(page.getByText('Rotation Failed')).toBeVisible();
  const errorIcon = page.locator('[class*="errorIcon"]').first();
  const failedSurface = await resolvedBackgroundIn(errorIcon, 'var(--color-status-failed-bg)');
  await expect(errorIcon).toHaveCSS('background-color', failedSurface);
  await screenshot(page, 'rotation-panel-tokenized-error', { fullPage: true });
});
