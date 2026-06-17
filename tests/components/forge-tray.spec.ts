import { expect, test } from '@playwright/test';
import { MEDIA_OPERATION_MATRIX } from '../../src/shared/mediaOperationMatrix';
import { mountComponent, screenshot } from './harness';

test('forge tray renders a screenshot matrix for every media mode', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });

  await mountComponent(page, 'ForgeTray', {
    allAssets: [],
    allVariants: [],
    onSubmit: '__record__:forge-submit',
    onBrandBackground: false,
    sendStyleSet: '__noop__',
  });

  for (const config of MEDIA_OPERATION_MATRIX) {
    await page.getByTitle(`${config.label} mode`).click();

    await expect(page.getByTitle(`${config.label} mode`)).toHaveClass(/active/);
    await expect(page.getByPlaceholder(`Describe the ${config.promptNoun} to generate...`)).toBeVisible();
    await expect(page.getByPlaceholder(`${config.label} name`)).toBeVisible();

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

    await screenshot(page, `forge-tray-media-mode-${config.mode}`, { fullPage: true });
  }
});
