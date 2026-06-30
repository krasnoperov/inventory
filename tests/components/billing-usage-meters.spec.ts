import { expect, test, type Locator, type Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

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

function meterRow(page: Page, name: string): Locator {
  return page.getByText(name).locator('xpath=ancestor::div[contains(@class, "meterRow")]').first();
}

test('billing usage meters use tokenized status chrome', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 560 });
  await mountComponent(page, 'BillingUsageMeters', {});

  const expectations = [
    {
      name: 'Image Generations',
      bar: 'var(--color-status-completed)',
      badgeBg: 'var(--color-status-completed-bg)',
      badgeText: 'var(--color-status-completed)',
    },
    {
      name: 'Video Generations',
      bar: 'var(--palette-amber)',
      badgeBg: 'var(--palette-amber-bg)',
      badgeText: 'var(--palette-amber)',
    },
    {
      name: 'Lyria Music',
      bar: 'var(--palette-orange)',
      badgeBg: 'var(--palette-orange-bg)',
      badgeText: 'var(--palette-orange)',
    },
    {
      name: 'Audio Generations',
      bar: 'var(--color-status-failed)',
      badgeBg: 'var(--color-status-failed-bg)',
      badgeText: 'var(--color-status-failed)',
    },
  ] as const;

  for (const item of expectations) {
    const row = meterRow(page, item.name);
    await expect(row).toBeVisible();
    await expect(row.locator('[class*="progressBar"]').first()).toHaveCSS(
      'background-color',
      await resolvedColor(page, item.bar),
    );
    await expect(row.locator('[class*="statusBadge"]').first()).toHaveCSS(
      'background-color',
      await resolvedColor(page, item.badgeBg),
    );
    await expect(row.locator('[class*="statusBadge"]').first()).toHaveCSS(
      'color',
      await resolvedColor(page, item.badgeText),
    );
  }

  await screenshot(page, 'billing-usage-tokenized-status-chrome');
});
