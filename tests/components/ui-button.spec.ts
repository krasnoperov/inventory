import { expect, test, type Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

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

async function resolvedColor(page: Page, value: string) {
  return page.evaluate((colorValue) => {
    const probe = document.createElement('div');
    probe.style.color = colorValue;
    probe.style.backgroundColor = colorValue;
    probe.style.borderColor = colorValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);
}

test('shared button uses tokenized focus and small control chrome', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 260 });
  await mountComponent(page, 'UiButton', {});

  const primary = page.getByRole('button', { name: 'Primary', exact: true });
  await primary.focus();
  await expect(primary).toHaveCSS('box-shadow', await resolvedShadow(page, 'var(--focus-ring)'));

  const small = page.getByRole('button', { name: 'Ghost small' });
  await expect(small).toHaveCSS('font-size', '12px');

  const icon = page.getByRole('button', { name: 'Preview icon action' });
  await expect(icon).toHaveCSS('width', await icon.evaluate((node) => getComputedStyle(node).minHeight));
  await expect(icon).toHaveCSS('aspect-ratio', '1 / 1');

  const disabledPrimary = page.getByRole('button', { name: 'Primary disabled' });
  const disabledSecondary = page.getByRole('button', { name: 'Secondary disabled' });
  const surface = await resolvedColor(page, 'var(--color-surface)');
  const border = await resolvedColor(page, 'var(--color-border)');
  const muted = await resolvedColor(page, 'var(--color-text-muted)');

  for (const button of [disabledPrimary, disabledSecondary]) {
    await expect(button).toBeDisabled();
    await expect(button).toHaveCSS('background-color', surface);
    await expect(button).toHaveCSS('border-color', border);
    await expect(button).toHaveCSS('color', muted);
  }

  await screenshot(page, 'ui-button-tokenized-focus', { fullPage: true });
});
