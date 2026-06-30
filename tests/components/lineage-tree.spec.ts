import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#eef2ff"/><circle cx="48" cy="42" r="22" fill="#7c83db"/><path d="M20 78c7-18 49-18 56 0z" fill="#27305f"/></svg>';

async function mockImages(page: Page) {
  await page.route('**/api/images/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: imageSvg,
  }));
}

async function mockLineageGraph(page: Page) {
  await page.route('**/api/spaces/space-1/variants/hero-variant/lineage/graph', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      variants: [
        {
          id: 'map-variant',
          asset_id: 'map',
          image_key: 'images/space/map-variant.png',
          thumb_key: 'images/space/map-variant_thumb.webp',
          created_at: 1_700_000_000_000,
          asset_name: 'Map Reference',
          asset_type: 'reference',
        },
        {
          id: 'hero-variant',
          asset_id: 'hero',
          image_key: 'images/space/hero-variant.png',
          thumb_key: 'images/space/hero-variant_thumb.webp',
          created_at: 1_700_000_001_000,
          asset_name: 'Hero Asset',
          asset_type: 'character',
        },
        {
          id: 'atlas-variant',
          asset_id: 'atlas',
          image_key: 'images/space/atlas-variant.png',
          thumb_key: 'images/space/atlas-variant_thumb.webp',
          created_at: 1_700_000_002_000,
          asset_name: 'Atlas Output',
          asset_type: 'prop',
        },
      ],
      lineage: [
        {
          id: 'lineage-map-hero',
          parent_variant_id: 'map-variant',
          child_variant_id: 'hero-variant',
          relation_type: 'derived',
          severed: false,
          created_at: 1_700_000_001_000,
        },
        {
          id: 'lineage-hero-atlas',
          parent_variant_id: 'hero-variant',
          child_variant_id: 'atlas-variant',
          relation_type: 'refined',
          severed: false,
          created_at: 1_700_000_002_000,
        },
      ],
    }),
  }));
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

test('lineage tree uses shared controls for graph toggle and sever actions', async ({ page }) => {
  await mockImages(page);
  await mockLineageGraph(page);
  await page.setViewportSize({ width: 760, height: 640 });
  await mountComponent(page, 'LineageTree', { onSeverLineage: '__record__:severLineage' });

  await expect(page.getByRole('heading', { name: 'Lineage' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show Full Graph' })).toBeVisible();

  const severAction = page.getByRole('button', { name: 'Sever this lineage link' }).first();
  await expect(severAction).toBeVisible();
  await severAction.click();
  await expect.poll(() => page.evaluate(() => window.__componentHarnessCalls ?? [])).toContain('severLineage');

  await page.getByRole('button', { name: 'Show Full Graph' }).click();
  await expect(page.getByRole('heading', { name: 'Full Lineage Graph' })).toBeVisible();
  const currentGraphNode = page.locator('[class*="currentNode"]');
  await expect(currentGraphNode).toHaveCSS(
    'background-color',
    await resolvedBackground(page, 'var(--color-status-processing-bg)'),
  );

  await screenshot(page, 'lineage-tree-shared-controls');
});
