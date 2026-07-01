import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;
const collections = [
  collection('cast', 'Cast', 'cast'),
  collection('style', 'Style refs', 'style_refs'),
];

function collection(id: string, name: string, kind: string) {
  return {
    id,
    name,
    kind,
    color: null,
    description: null,
    sort_index: 0,
    item_count: 0,
    created_by: 'u1',
    created_at: baseTime,
    updated_at: baseTime,
  };
}

async function selectDropdown(page: import('@playwright/test').Page, label: string, optionName: string) {
  await page.getByLabel(label).click();
  await page.getByRole('option', { name: optionName }).click();
}

test('collection placement picker updates role subject and pinning', async ({ page }) => {
  await mountComponent(page, 'CollectionPlacementPicker', {
    collections,
    value: [{
      collectionId: 'cast',
      role: 'character',
      subjectType: 'asset',
      pinToCreatedVariant: true,
    }],
    onChange: '__record__:change',
    allowSubjectChoice: true,
    showPinToCreatedVariant: true,
  });

  await expect(page.getByLabel('Add collection')).toContainText('Add collection');
  await expect(page.getByText('Cast', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Remove Cast placement draft')).toBeVisible();
  await expect(page.getByLabel('Role for Cast')).toHaveCount(0);
  await expect(page.getByText('Character', { exact: true })).toBeVisible();

  await page.getByLabel('Edit Cast placement draft').click();
  await selectDropdown(page, 'Role for Cast', 'Background');
  await page.evaluate((nextProps) => window.__setHarnessProps?.(nextProps), {
    collections,
    value: [{
      collectionId: 'cast',
      role: 'background',
      subjectType: 'asset',
      pinToCreatedVariant: true,
    }],
    onChange: '__record__:change',
    allowSubjectChoice: true,
    showPinToCreatedVariant: true,
  });
  await selectDropdown(page, 'Collection subject for Cast', 'Exact variant');
  await page.evaluate((nextProps) => window.__setHarnessProps?.(nextProps), {
    collections,
    value: [{
      collectionId: 'cast',
      role: 'background',
      subjectType: 'variant',
      pinToCreatedVariant: false,
    }],
    onChange: '__record__:change',
    allowSubjectChoice: true,
    showPinToCreatedVariant: true,
  });
  await selectDropdown(page, 'Add collection', 'Style refs');
  await page.mouse.move(0, 0);
  const rowMetrics = await page.getByLabel('Remove Cast placement draft').evaluate((button) => {
    const row = button.closest('[class*="placementRow"]');
    if (!row) return null;
    const styles = window.getComputedStyle(row);
    const rect = row.getBoundingClientRect();
    return {
      display: styles.display,
      borderStyle: styles.borderTopStyle,
      width: rect.width,
    };
  });
  expect(rowMetrics).toMatchObject({
    display: 'grid',
    borderStyle: 'solid',
  });
  expect(rowMetrics?.width).toBeLessThanOrEqual(480);
  await screenshot(page, 'collection-placement-picker');
  await page.getByLabel('Remove Cast placement draft').click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({
      eventName: 'change',
      args: [[{
        collectionId: 'cast',
        role: 'background',
        subjectType: 'asset',
        pinToCreatedVariant: true,
      }]],
    }),
    expect.objectContaining({
      eventName: 'change',
      args: [[{
        collectionId: 'cast',
        role: 'background',
        subjectType: 'variant',
        pinToCreatedVariant: false,
      }]],
    }),
    expect.objectContaining({
      eventName: 'change',
      args: [[
        {
          collectionId: 'cast',
          role: 'background',
          subjectType: 'variant',
          pinToCreatedVariant: false,
        },
        {
          collectionId: 'style',
          role: 'style_ref',
          subjectType: 'asset',
          pinToCreatedVariant: true,
        },
      ]],
    }),
  ]));
  expect(calls.at(-1)).toMatchObject({
    eventName: 'change',
    args: [[]],
  });
});

test('collection placement picker stacks cleanly on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await mountComponent(page, 'CollectionPlacementPicker', {
    collections,
    value: [{
      collectionId: 'cast',
      role: 'character',
      subjectType: 'asset',
      pinToCreatedVariant: true,
    }],
    onChange: '__record__:change',
    allowSubjectChoice: true,
    showPinToCreatedVariant: true,
  });

  await expect(page.getByText('Cast', { exact: true })).toBeVisible();
  await expect(page.getByText('Character', { exact: true })).toBeVisible();
  await expect(page.getByText('Asset', { exact: true })).toBeVisible();
  await expect(page.getByText('Pinned', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Role for Cast')).toHaveCount(0);
  await page.getByLabel('Edit Cast placement draft').click();
  await expect(page.getByLabel('Role for Cast')).toBeVisible();
  await expect(page.getByLabel('Collection subject for Cast')).toBeVisible();
  await expect(page.getByText('Pin variant')).toBeVisible();

  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  await screenshot(page, 'collection-placement-picker-mobile');
});

test('collection placement picker contains long custom role summaries', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 260 });
  await mountComponent(page, 'CollectionPlacementPicker', {
    collections,
    value: [{
      collectionId: 'cast',
      role: 'very-long-custom-production-role-that-should-not-expand-the-row',
      subjectType: 'asset',
      pinToCreatedVariant: false,
    }],
    onChange: '__record__:change',
    allowSubjectChoice: true,
    showPinToCreatedVariant: true,
  });

  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);

  const roleChip = page.getByText('very-long-custom-production-role-that-should-not-expand-the-row');
  await expect(roleChip).toHaveCSS('overflow', 'hidden');
  await expect(roleChip).toHaveCSS('text-overflow', 'ellipsis');
});
