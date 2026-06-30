import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const form = {
  id: 'placement-1',
  variantId: 'variant-1',
  shotId: 'shot-010',
  sceneLabel: 'Harbor approach',
  timelineStartMs: '1200',
  durationMs: '2400',
  motionPrompt: 'Slow push toward the gate',
  sourceRefs: 'brief.md',
  sourceVariantIds: '',
};

const variantOptions = [
  {
    label: 'Harbor gate (Image)',
    asset: { id: 'asset-1', name: 'Harbor gate', type: 'environment' },
    variant: { id: 'variant-1', asset_id: 'asset-1', media_kind: 'image' },
  },
  {
    label: 'Signal bell (Audio)',
    asset: { id: 'asset-2', name: 'Signal bell', type: 'prop' },
    variant: { id: 'variant-2', asset_id: 'asset-2', media_kind: 'audio' },
  },
];

const sortedRecords = [
  {
    id: 'record-1',
    space_id: 'space-1',
    production_id: 'episode-01',
    asset_id: 'asset-1',
    variant_id: 'variant-1',
    media_kind: 'image',
    shot_id: 'shot-010',
    scene_label: 'Harbor approach',
    timeline_start_ms: 1200,
    duration_ms: 2400,
    motion_prompt: null,
    source_refs: '[]',
    source_variant_ids: '[]',
    metadata_json: '{}',
    created_by_user_id: 'user-1',
    created_at: '2026-06-29T10:00:00.000Z',
    updated_at: '2026-06-29T10:00:00.000Z',
  },
];

async function selectDropdown(page: import('@playwright/test').Page, label: string, optionName: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

test('production controls use shared select and buttons', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 720 });
  await mountComponent(page, 'ProductionControls', {
    activeProductionId: 'episode-01',
    canEdit: true,
    copyStatus: 'JSON copied',
    form,
    formError: null,
    handoff: { productionId: 'episode-01' },
    handoffJson: '{\n  "productionId": "episode-01"\n}',
    isSaving: false,
    onCopyText: '__record__:copy',
    onFormChange: '__record__:form',
    onNewPlacement: '__record__:new',
    onSubmit: '__record__:submit',
    onVariantChange: '__record__:variant',
    sceneArgs: '--props episode-01',
    selectedOption: null,
    spaceId: 'space-1',
    sortedRecords,
    variantOptions,
  });

  await expect(page.getByRole('heading', { name: 'Edit Placement' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Media Handoff' })).toBeVisible();
  await expect(page.locator('[class*="panel"]').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.getByRole('button', { name: 'New' })).toBeVisible();
  await selectDropdown(page, 'Variant', 'Signal bell (Audio)');
  await page.getByRole('button', { name: 'Update Placement' }).click();
  await page.getByRole('button', { name: 'Copy JSON' }).click();
  await page.getByRole('button', { name: 'Copy Scene Args' }).click();

  await screenshot(page, 'production-controls');

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ eventName: 'variant', args: ['variant-2'] }),
    expect.objectContaining({ eventName: 'submit', args: [] }),
    expect.objectContaining({ eventName: 'copy', args: ['JSON', '{\n  "productionId": "episode-01"\n}'] }),
    expect.objectContaining({ eventName: 'copy', args: ['Scene args', '--props episode-01'] }),
  ]));
});
