import { expect, test } from '@playwright/test';
import { mountComponent } from './harness';

const baseTime = 1_700_000_000_000;

function asset(id: string, name: string, type = 'character') {
  return {
    id,
    name,
    type,
    media_kind: 'image',
    tags: '',
    parent_asset_id: null,
    active_variant_id: `${id}-variant`,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
  };
}

function variant(assetId: string, id = `${assetId}-variant`) {
  return {
    id,
    asset_id: assetId,
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: `images/space/${id}.png`,
    thumb_key: `images/space/${id}_thumb.webp`,
    media_key: `images/space/${id}.png`,
    media_mime_type: 'image/png',
    media_size_bytes: 123,
    media_width: 100,
    media_height: 100,
    media_duration_ms: null,
    transcript_key: null,
    transcript_mime_type: null,
    transcript_size_bytes: null,
    word_timings_key: null,
    word_timings_mime_type: null,
    word_timings_size_bytes: null,
    render_metadata_key: null,
    render_metadata_mime_type: null,
    render_metadata_size_bytes: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
    description: null,
    quality_rating: null,
    rated_at: null,
  };
}

const hero = asset('hero', 'Hero Character');
const atlas = asset('atlas', 'Atlas Sheet', 'sprite-sheet');
const map = asset('map', 'Map Source', 'reference');
const assets = [hero, atlas, map];
const variants = [
  variant('hero'),
  variant('atlas', 'atlas-searchable-variant'),
  variant('map'),
];

async function mockMedia(page: import('@playwright/test').Page) {
  await page.route('**/api/images/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#668cff"/></svg>',
    }),
  );
}

test('relation dialog creates a manual relation with searchable variant target', async ({ page }) => {
  await mockMedia(page);
  await mountComponent(page, 'RelationEditorDialog', {
    mode: 'create',
    assets,
    variants,
    sourceSubject: { subjectType: 'asset', assetId: 'hero' },
    onCancel: '__noop__',
    onCreate: '__record__:create-relation',
    onUpdate: '__record__:update-relation',
  });

  await page.getByLabel('Type').selectOption('thumbnail_for');
  await page.getByPlaceholder('Search assets and variants').fill('atlas-searchable');
  await expect(page.getByText('Atlas Sheet variant')).toBeVisible();
  await page.getByText('Atlas Sheet variant').click();
  await page.getByLabel('Label').fill('Inventory tile');
  await page.getByLabel('Context').fill('catalog grid');
  await page.getByLabel('Notes').fill('Use the trimmed 64px sprite.');
  await page.getByRole('button', { name: 'Create' }).click();

  const details = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(details).toHaveLength(1);
  expect(details[0].eventName).toBe('create-relation');
  expect(details[0].args[0]).toMatchObject({
    subject: { subjectType: 'asset', assetId: 'hero' },
    object: { subjectType: 'variant', variantId: 'atlas-searchable-variant' },
    relationType: 'thumbnail_for',
    context: {
      label: 'Inventory tile',
      context: 'catalog grid',
      notes: 'Use the trimmed 64px sprite.',
    },
  });
});

test('edit-menu relation shortcut creates a common relation without filling the full form', async ({ page }) => {
  await mockMedia(page);
  await mountComponent(page, 'RelationEditorDialog', {
    mode: 'create',
    assets,
    variants,
    sourceSubject: { subjectType: 'variant', variantId: 'map-variant' },
    onCancel: '__noop__',
    onCreate: '__record__:create-relation',
    onUpdate: '__record__:update-relation',
  });

  await page.getByPlaceholder('Search assets and variants').fill('hero');
  await page.getByRole('button', { name: 'Hero Character character /' }).click();
  await page.getByRole('button', { name: 'Mark as thumbnail for Hero Character' }).click();

  const details = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(details).toHaveLength(1);
  expect(details[0]).toMatchObject({
    eventName: 'create-relation',
    args: [{
      subject: { subjectType: 'variant', variantId: 'map-variant' },
      object: { subjectType: 'asset', assetId: 'hero' },
      relationType: 'thumbnail_for',
      context: null,
    }],
  });
});

test('relation dialog edits type label context and notes without changing endpoints', async ({ page }) => {
  await mockMedia(page);
  await mountComponent(page, 'RelationEditorDialog', {
    mode: 'edit',
    assets,
    variants,
    sourceSubject: { subjectType: 'asset', assetId: 'hero' },
    relation: {
      id: 'relation-1',
      subject_type: 'asset',
      subject_asset_id: 'hero',
      subject_variant_id: null,
      object_type: 'asset',
      object_asset_id: 'atlas',
      object_variant_id: null,
      relation_type: 'map_for',
      context: JSON.stringify({ label: 'Old label', context: 'old context', notes: 'old notes' }),
      sort_index: 0,
      created_by: 'user-1',
      created_at: baseTime,
      updated_at: baseTime,
    },
    onCancel: '__noop__',
    onCreate: '__record__:create-relation',
    onUpdate: '__record__:update-relation',
  });

  await page.getByLabel('Type').selectOption('alternate_of');
  await page.getByLabel('Label').fill('Palette swap');
  await page.getByLabel('Context').fill('shop preview');
  await page.getByLabel('Notes').fill('Keep both choices visible.');
  await page.getByRole('button', { name: 'Save' }).click();

  const details = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(details).toHaveLength(1);
  expect(details[0].eventName).toBe('update-relation');
  expect(details[0].args).toEqual([
    'relation-1',
    {
      relationType: 'alternate_of',
      context: {
        label: 'Palette swap',
        context: 'shop preview',
        notes: 'Keep both choices visible.',
      },
    },
  ]);
});

test('relations panel shows incoming reverse links and clears relations separately from lineage', async ({ page }) => {
  await mockMedia(page);
  await mountComponent(page, 'RelationsPanel', {
    assets,
    variants,
    subjects: [
      { subjectType: 'asset', assetId: 'hero' },
      { subjectType: 'variant', variantId: 'hero-variant' },
    ],
    primarySubject: { subjectType: 'asset', assetId: 'hero' },
    lineage: [{
      id: 'lineage-1',
      parent_variant_id: 'map-variant',
      child_variant_id: 'hero-variant',
      relation_type: 'derived',
      severed: false,
      created_at: baseTime,
    }],
    relations: [
      {
        id: 'relation-out',
        subject_type: 'asset',
        subject_asset_id: 'hero',
        subject_variant_id: null,
        object_type: 'asset',
        object_asset_id: 'atlas',
        object_variant_id: null,
        relation_type: 'thumbnail_for',
        context: JSON.stringify({ label: 'Card art' }),
        sort_index: 0,
        created_by: 'user-1',
        created_at: baseTime,
        updated_at: baseTime,
      },
      {
        id: 'relation-in',
        subject_type: 'asset',
        subject_asset_id: 'map',
        subject_variant_id: null,
        object_type: 'variant',
        object_asset_id: null,
        object_variant_id: 'hero-variant',
        relation_type: 'map_for',
        context: JSON.stringify({ context: 'world map' }),
        sort_index: 0,
        created_by: 'user-1',
        created_at: baseTime,
        updated_at: baseTime,
      },
    ],
    onCreate: '__record__:open-create',
    onEdit: '__record__:open-edit',
    onDelete: '__record__:delete-relation',
  });

  await expect(page.getByText('Thumbnail for -> Atlas Sheet')).toBeVisible();
  await expect(page.getByText('Map Source -> Map for')).toBeVisible();
  await expect(page.getByText('derived')).toHaveCount(0);

  await page.locator('article').filter({ hasText: 'Map Source' }).getByRole('button', { name: 'Clear' }).click();
  const details = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(details.at(-1)).toEqual({ eventName: 'delete-relation', args: ['relation-in'] });
});
