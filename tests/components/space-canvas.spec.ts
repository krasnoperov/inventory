import { expect, test } from '@playwright/test';
import { mountComponent } from './harness';

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
function item(id: string, collectionId: string, assetId: string, sort: number) {
  return {
    id, collection_id: collectionId, subject_type: 'asset', asset_id: assetId, variant_id: null,
    role: 'image', pinned_variant_id: null, sort_index: sort, created_by: 'u1', created_at: t, updated_at: t,
  };
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
    isInitialSyncPending: false,
    onAssetClick: '__noop__',
  });

  // A frame per collection plus the unfiled bucket.
  await expect(page.getByRole('heading', { name: 'Backgrounds' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cast' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unfiled' })).toBeVisible();

  // Cards render inside the frames (thumbnail button titled by asset name).
  await expect(page.getByRole('button', { name: 'Hero' }).first()).toBeVisible();

  // Frames are laid out without overlapping each other.
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  expect(noOverlap(await frameBoxes(page))).toBe(true);
});
