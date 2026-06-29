import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const aggregate = {
  amountMicroUsd: 306000,
  amountUsd: 0.306,
  quantity: 3,
  entries: 3,
  unpricedEntries: 1,
};

const summary = {
  success: true,
  period: { from: '2026-06-01', to: '2026-06-29' },
  filters: { userId: null, spaceId: null, provider: 'gemini', mediaKind: 'image' },
  totals: aggregate,
  byProvider: [
    { provider: 'gemini', ...aggregate },
  ],
  byModel: [
    { provider: 'gemini', providerModel: 'gemini-3-pro-image-preview', ...aggregate },
  ],
  byMediaKind: [
    { mediaKind: 'image', ...aggregate },
  ],
  byMeterEventName: [
    { meterEventName: 'gemini_images', ...aggregate },
  ],
  bySpace: [
    { spaceId: 'space-1', ...aggregate },
  ],
  byAsset: [
    { assetId: 'asset-1', spaceId: 'space-1', ...aggregate },
  ],
};

async function selectDropdown(page: import('@playwright/test').Page, label: string, optionName: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

test('admin spend view uses shared filter controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await mountComponent(page, 'AdminSpendView', {
    summary,
    draftFilters: {
      from: '2026-06-01',
      to: '2026-06-29',
      provider: 'gemini',
      mediaKind: 'image',
    },
    onDraftChange: '__record__:draft',
    onApplyFilters: '__record__:apply',
    onClearFilters: '__record__:clear',
  });

  await expect(page.getByRole('heading', { name: 'Provider Cost' })).toBeVisible();
  await expect(page.getByText('$0.31').first()).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByLabel('User ID').fill('42');
  await page.getByLabel('Provider').fill('openai');
  await selectDropdown(page, 'Media', 'Video');
  await page.getByRole('button', { name: 'Apply' }).click();

  await screenshot(page, 'admin-spend-controls', { fullPage: true });

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ eventName: 'draft', args: ['userId', '42'] }),
    expect.objectContaining({ eventName: 'draft', args: ['provider', 'openai'] }),
    expect.objectContaining({ eventName: 'draft', args: ['mediaKind', 'video'] }),
    expect.objectContaining({ eventName: 'apply', args: [] }),
    expect.objectContaining({ eventName: 'clear', args: [] }),
  ]));
});
