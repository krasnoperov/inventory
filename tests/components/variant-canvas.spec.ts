import { expect, test } from '@playwright/test';

const t = 1_700_000_000_000;
const asset = (id: string, name: string) => ({
  id, name, type: 'sprite', media_kind: 'image', tags: '', parent_asset_id: null,
  active_variant_id: `${id}-v`, created_by: 'u1', created_at: t, updated_at: t,
});
const variant = (assetId: string) => ({
  id: `${assetId}-v`, asset_id: assetId, media_kind: 'image', workflow_id: null, status: 'completed',
  error_message: null, image_key: null, thumb_key: null, media_key: null, media_mime_type: 'image/png',
  media_size_bytes: 1, media_width: 512, media_height: 512, media_duration_ms: null, recipe: '{}',
  starred: false, created_by: 'u1', created_at: t, updated_at: t, description: null,
});
const lin = (id: string, p: string, c: string) => ({
  id, parent_variant_id: `${p}-v`, child_variant_id: `${c}-v`, relation_type: 'derived', severed: false, created_at: t,
});

const families = ['wheat', 'corn', 'tomato'];
const assets = [asset('crops', 'Raw source: crops')];
const lineage: ReturnType<typeof lin>[] = [];
families.forEach((f) => {
  assets.push(asset(`${f}_grow`, `Sprite: ${f}_grow`));
  lineage.push(lin(`l-${f}`, 'crops', `${f}_grow`));
});
const allVariants = assets.map((a) => variant(a.id));

// The detail view drops its separate "Derivatives:" text list because the
// canvas already shows derivatives as clickable lineage nodes. Guard that.
test('variant canvas shows derivatives as lineage nodes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/component-harness.html?component=VariantCanvas', { waitUntil: 'domcontentloaded' });
  // Harness root is unsized; VariantCanvas's .canvas is height:100%.
  await page.addStyleTag({ content: '[data-testid="harness-root"]{position:fixed;inset:0;}' });
  await page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
    spaceId: 'space-1', asset: assets[0], variants: [variant('crops')], lineage,
    selectedVariantId: 'crops-v', allVariants, allAssets: assets,
    onVariantClick: '__noop__', onGhostNodeClick: '__noop__',
  });
  await page.waitForSelector('.react-flow__node');
  for (const f of families) {
    await expect(page.getByText(`Sprite: ${f}_grow`)).toBeVisible();
  }
});
