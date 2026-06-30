import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

async function resolvedStyle(page: import('@playwright/test').Page, property: 'background' | 'color', value: string) {
  return page.evaluate(({ cssProperty, cssValue }) => {
    const probe = document.createElement('div');
    probe.style[cssProperty] = cssValue;
    document.body.appendChild(probe);
    const styles = getComputedStyle(probe);
    const resolved = cssProperty === 'background' ? styles.backgroundColor : styles.color;
    probe.remove();
    return resolved;
  }, { cssProperty: property, cssValue: value });
}

test('usage indicator warning state uses semantic status tokens', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 180 });
  await mountComponent(page, 'UsageIndicatorView', {
    status: 'warning',
    percentage: 94,
    meterLabel: 'Image Generations',
    shortLabel: 'Images',
  });

  const indicator = page.getByRole('link', { name: '94% Images' });
  await expect(indicator).toHaveCSS(
    'background-color',
    await resolvedStyle(page, 'background', 'var(--status-warning-bg)'),
  );
  await expect(indicator).toHaveCSS(
    'color',
    await resolvedStyle(page, 'color', 'var(--landing-live-text)'),
  );
  await expect(page.locator('[class*="fill"]')).toHaveCSS(
    'background-color',
    await resolvedStyle(page, 'background', 'var(--color-star)'),
  );
  await screenshot(page, 'usage-indicator-warning-token-surface', { fullPage: true });
});

test('usage indicator exceeded state uses semantic status tokens', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 180 });
  await mountComponent(page, 'UsageIndicatorView', {
    status: 'exceeded',
    percentage: 112,
    meterLabel: 'Gemini Input Tokens',
    shortLabel: 'Gemini',
  });

  const indicator = page.getByRole('link', { name: '112% Gemini' });
  await expect(indicator).toHaveCSS(
    'background-color',
    await resolvedStyle(page, 'background', 'var(--color-status-failed-bg)'),
  );
  await expect(indicator).toHaveCSS(
    'color',
    await resolvedStyle(page, 'color', 'var(--color-status-failed)'),
  );
  await expect(page.locator('[class*="fill"]')).toHaveCSS(
    'background-color',
    await resolvedStyle(page, 'background', 'var(--color-status-failed)'),
  );
  await screenshot(page, 'usage-indicator-exceeded-token-surface', { fullPage: true });
});
