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
  const frames = page.locator('.react-flow__node');
  await expect(frames).toHaveCount(3);
  const boxes = await frames.evaluateAll((nodes) =>
    nodes.map((n) => n.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
  );
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      expect(overlap, `frames ${i} and ${j} overlap`).toBe(false);
    }
  }
});
