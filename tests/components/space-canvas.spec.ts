import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const t = 1_700_000_000_000;

function asset(id: string, name: string) {
  return {
    id, name, type: 'image', media_kind: 'image', tags: '',
    parent_asset_id: null, active_variant_id: `${id}-v`,
    created_by: 'u1', created_at: t, updated_at: t,
  };
}
function variant(assetId: string, w: number, h: number) {
  return {
    id: `${assetId}-v`, asset_id: assetId, media_kind: 'image', workflow_id: null,
    status: 'completed', error_message: null, media_width: w, media_height: h,
    image_key: null, media_key: null, thumbnail_key: null, starred: 0,
    created_by: 'u1', created_at: t, updated_at: t,
  };
}
function collection(id: string, name: string, kind: string, color: string, sort: number) {
  return { id, name, kind, color, description: null, sort_index: sort, created_at: t, updated_at: t };
}
function lineage(id: string, parentAssetId: string, childAssetId: string) {
  return {
    id, parent_variant_id: `${parentAssetId}-v`, child_variant_id: `${childAssetId}-v`,
    relation_type: 'derived', severed: false, created_at: t,
  };
}
function item(id: string, collectionId: string, assetId: string, sort: number) {
  return {
    id, collection_id: collectionId, subject_type: 'asset', asset_id: assetId, variant_id: null,
    role: 'image', pinned_variant_id: null, sort_index: sort, created_by: 'u1', created_at: t, updated_at: t,
  };
}

async function expectNoOverlap(
  first: import('@playwright/test').Locator,
  second: import('@playwright/test').Locator,
) {
  await expect.poll(async () => {
    const firstBox = await first.boundingBox();
    const secondBox = await second.boundingBox();
    if (!firstBox || !secondBox) return false;
    return !(
      firstBox.x + firstBox.width <= secondBox.x ||
      secondBox.x + secondBox.width <= firstBox.x ||
      firstBox.y + firstBox.height <= secondBox.y ||
      secondBox.y + secondBox.height <= firstBox.y
    );
  }).toBe(false);
}

// Small fixture so props fit in the harness URL: two collections + one unfiled.
const assets = [
  asset('a0', 'Hero'), asset('a1', 'Tree'), asset('a2', 'Banner'),
  asset('a3', 'Sprite'), asset('a4', 'Loner'),
];
const variants = [
  variant('a0', 512, 512), variant('a1', 384, 512), variant('a2', 900, 420),
  variant('a3', 512, 512), variant('a4', 640, 480),
];
const collections = [
  collection('c0', 'Backgrounds', 'backgrounds', '#caa45a', 0),
  collection('c1', 'Cast', 'cast', '#5a8fca', 1),
];
const collectionItems = [
  item('i0', 'c0', 'a0', 0), item('i1', 'c0', 'a1', 1), item('i2', 'c0', 'a2', 2),
  item('i3', 'c1', 'a3', 0),
];

function noOverlap(boxes: Array<{ x: number; y: number; w: number; h: number }>) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      // Allow a 1px touch tolerance for sub-pixel rounding.
      if (a.x < b.x + b.w - 1 && a.x + a.w - 1 > b.x && a.y < b.y + b.h - 1 && a.y + a.h - 1 > b.y) {
        return false;
      }
    }
  }
  return true;
}

async function frameBoxes(page: import('@playwright/test').Page) {
  return page.locator('.react-flow__node').evaluateAll((nodes) =>
    nodes.map((n) => n.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
  );
}

test('space canvas empty state uses minimal chrome', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 520 });
  await mountComponent(page, 'SpaceCanvas', {
    spaceId: 'space-1',
    assets: [],
    variants: [],
    collections: [],
    collectionItems: [],
    lineage: [],
    isInitialSyncPending: false,
    onAssetClick: '__noop__',
  });

  await expect(page.getByText('No assets yet')).toBeVisible();
  await expect(page.locator('[class*="emptyMark"]')).toBeVisible();
  await expect(page.getByText('🎨')).toHaveCount(0);
  await expect(page.getByText('⏳')).toHaveCount(0);
  await screenshot(page, 'space-canvas-empty-state', { fullPage: true });

  await mountComponent(page, 'SpaceCanvas', {
    spaceId: 'space-1',
    assets: [],
    variants: [],
    collections: [],
    collectionItems: [],
    lineage: [],
    isInitialSyncPending: true,
    onAssetClick: '__noop__',
  });

  await expect(page.getByText('Loading assets…')).toBeVisible();
  await expect(page.locator('[class*="emptyMarkLoading"]')).toBeVisible();
  await expect(page.getByText('🎨')).toHaveCount(0);
  await expect(page.getByText('⏳')).toHaveCount(0);
});

test('re-packs so a live-grown frame never overlaps the one below it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  // Four collections force two frames into the same masonry column, so a
  // growing upper frame would overlap the lower one without a re-pack.
  const cols = [
    collection('c0', 'Alpha', 'custom', '#caa45a', 0),
    collection('c1', 'Beta', 'cast', '#5a8fca', 1),
    collection('c2', 'Gamma', 'scenes', '#7bca5a', 2),
    collection('c3', 'Delta', 'maps', '#ca5a8f', 3),
  ];
  const baseAssets = ['b0', 'b1', 'b2', 'b3'].map((id, i) => asset(id, `Base ${i}`));
  const baseVariants = baseAssets.map((a) => variant(a.id, 512, 512));
  const baseItems = baseAssets.map((a, i) => item(`bi${i}`, `c${i}`, a.id, 0));

  const setProps = (extra: { assets: ReturnType<typeof asset>[]; variants: ReturnType<typeof variant>[]; items: ReturnType<typeof item>[] }) =>
    page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
      spaceId: 'space-1',
      assets: [...baseAssets, ...extra.assets],
      variants: [...baseVariants, ...extra.variants],
      collections: cols,
      collectionItems: [...baseItems, ...extra.items],
      lineage: [],
      isInitialSyncPending: false,
      onAssetClick: '__noop__',
    });

  await page.goto('/component-harness.html?component=SpaceCanvas', { waitUntil: 'domcontentloaded' });
  await setProps({ assets: [], variants: [], items: [] });
  await page.waitForSelector('.react-flow__node');
  await expect.poll(async () => noOverlap(await frameBoxes(page))).toBe(true);

  // Grow the first frame (c0) with many cards via a live prop update.
  const grow = Array.from({ length: 9 }, (_, i) => `g${i}`);
  await setProps({
    assets: grow.map((id, i) => asset(id, `Grow ${i}`)),
    variants: grow.map((id) => variant(id, 512, 512)),
    items: grow.map((id, i) => item(`gi${i}`, 'c0', id, i + 1)),
  });

  // After the frame grows and re-measures, the masonry must re-flow so nothing overlaps.
  await expect.poll(async () => noOverlap(await frameBoxes(page)), { timeout: 4000 }).toBe(true);
});

test('space canvas renders collection frames without overlap', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mountComponent(page, 'SpaceCanvas', {
    spaceId: 'space-1',
    assets, variants, collections, collectionItems,
    // a0 (Backgrounds) derives a3 (Cast): one cross-frame lineage edge.
    lineage: [lineage('l0', 'a0', 'a3')],
    isInitialSyncPending: false,
    onAssetClick: '__noop__',
  });

  // A frame per collection plus the unfiled bucket.
  await expect(page.getByRole('heading', { name: 'Backgrounds' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cast' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unfiled' })).toBeVisible();

  // Cards render inside the frames (thumbnail button titled by asset name).
  await expect(page.getByRole('button', { name: 'Hero' }).first()).toBeVisible();
  await expect(page.locator('[class*="colorDot"]').first()).toHaveCSS('box-shadow', 'none');

  // Frames are laid out without overlapping each other.
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  expect(noOverlap(await frameBoxes(page))).toBe(true);

  // The lineage link renders as one edge path between the two frames.
  await expect.poll(async () => page.getByTestId('lineage-edges').locator('path').count()).toBe(1);

  // Zooming out keeps the real thumbnails — cards are never swapped for blocks.
  const zoomOut = page.locator('.react-flow__controls-zoomout');
  for (let i = 0; i < 6; i++) await zoomOut.click();
  await expect(page.locator('[data-asset-id="a0"] svg').first()).toBeVisible();
  await expect(page.getByTestId('greek-card')).toHaveCount(0);
});

test('space canvas frame card triggers open assets without changing media chrome', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mountComponent(page, 'SpaceCanvas', {
    spaceId: 'space-1',
    assets, variants, collections, collectionItems,
    lineage: [],
    isInitialSyncPending: false,
    onAssetClick: '__record__:assetClick',
  });

  const thumbnailTrigger = page.locator('button[class*="thumbnailButton"][title="Hero"]').first();
  const nameTrigger = page.locator('button[class*="assetName"]').filter({ hasText: 'Hero' }).first();

  await expect(thumbnailTrigger).toBeVisible();
  await expect(thumbnailTrigger).toHaveCSS('padding', '0px');
  await expect(thumbnailTrigger).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('[class*="frame"]').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('[class*="colorDot"]').first()).toHaveCSS('box-shadow', 'none');

  await thumbnailTrigger.hover();
  await expect(nameTrigger).toBeVisible();
  await expect(nameTrigger).toHaveCSS('color', 'rgb(19, 22, 29)');
  await expectNoOverlap(nameTrigger, thumbnailTrigger);
  await screenshot(page, 'space-canvas-frame-card-triggers', { fullPage: true });

  await thumbnailTrigger.click();
  await thumbnailTrigger.hover();
  await nameTrigger.click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.map((call) => call.eventName)).toEqual(['assetClick', 'assetClick']);
  expect((calls[0].args[0] as { id: string }).id).toBe('a0');
  expect((calls[1].args[0] as { id: string }).id).toBe('a0');
});

test('re-measures edge endpoints when cards reorder within a frame', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  const cols = [
    collection('c0', 'Source', 'custom', '#caa45a', 0),
    collection('c1', 'Target', 'cast', '#5a8fca', 1),
  ];
  const sourceAssets = ['a0', 'a1', 'a2', 'a3'].map((id, i) => asset(id, `A ${i}`));
  const allAssets = [...sourceAssets, asset('b0', 'B')];
  const allVariants = allAssets.map((a) => variant(a.id, 512, 512));
  // a3 (last in Source) derives b0 (in Target).
  const link = [lineage('l0', 'a3', 'b0')];

  const itemsFor = (order: string[]) => [
    ...order.map((id, i) => item(`i-${id}`, 'c0', id, i)),
    item('i-b0', 'c1', 'b0', 0),
  ];
  const setProps = (order: string[]) =>
    page.evaluate((p) => (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps(p), {
      spaceId: 'space-1', assets: allAssets, variants: allVariants, collections: cols,
      collectionItems: itemsFor(order), lineage: link, isInitialSyncPending: false, onAssetClick: '__noop__',
    });

  await page.goto('/component-harness.html?component=SpaceCanvas', { waitUntil: 'domcontentloaded' });
  await setProps(['a0', 'a1', 'a2', 'a3']);
  const edge = page.getByTestId('lineage-edges').locator('path');
  await expect.poll(async () => (await edge.getAttribute('d')) ?? '').not.toBe('');
  const before = await edge.getAttribute('d');

  // Move a3 to the front — same frame height, but a3's centre moves to a new row.
  await setProps(['a3', 'a0', 'a1', 'a2']);
  await expect.poll(async () => (await edge.getAttribute('d')) ?? '', { timeout: 4000 }).not.toBe(before ?? '');
});
