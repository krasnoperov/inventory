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
  await screenshot(page, 'collection-placement-picker', { fullPage: true });
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
