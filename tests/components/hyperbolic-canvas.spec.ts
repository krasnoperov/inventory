import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

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

function variant(assetId: string) {
  return {
    id: `${assetId}-variant`,
    asset_id: assetId,
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: `images/space/${assetId}.png`,
    thumb_key: `images/space/${assetId}_thumb.webp`,
    media_key: `images/space/${assetId}.png`,
    media_mime_type: 'image/png',
    media_size_bytes: 123,
    media_width: 256,
    media_height: 256,
    media_duration_ms: null,
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

async function mockMedia(page: import('@playwright/test').Page) {
  await page.route('**/api/images/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#668cff"/><circle cx="128" cy="128" r="64" fill="#ffffff"/></svg>',
    }),
  );
}

async function sizeHarness(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="harness-root"]').evaluate((element) => {
    const root = element as HTMLElement;
    root.style.width = '920px';
    root.style.height = '620px';
  });
}

async function resolvedColor(page: import('@playwright/test').Page, value: string) {
  return page.evaluate((colorValue) => {
    const probe = document.createElement('div');
    probe.style.color = colorValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);
}

test('hyperbolic canvas uses tokenized node surfaces', async ({ page }) => {
  await mockMedia(page);
  const assets = [
    asset('hero', 'Hero Character With A Long Readable Name'),
    asset('atlas', 'Atlas Sheet', 'sprite-sheet'),
    asset('map', 'Map Source', 'reference'),
    asset('scene', 'Scene Bar', 'scene'),
  ];

  await mountComponent(page, 'HyperbolicCanvas', {
    spaceId: 'space-1',
    assets,
    variants: assets.map((entry) => variant(entry.id)),
    onAssetClick: '__record__:asset-click',
  });
  await sizeHarness(page);

  await expect(page.getByText('Drag to pan')).toBeVisible();
  await expect(page.getByText('Hero Character With A Long Readable Name')).toBeVisible();
  const longName = page.getByText('Hero Character With A Long Readable Name');
  await expect(longName).toHaveCSS('white-space', 'normal');
  await expect(longName).toHaveCSS('text-overflow', 'clip');
  await expect.poll(async () => (await longName.boundingBox())?.height ?? 0).toBeGreaterThan(15);
  await expect(page.locator('[class*="thumb"]').first()).toHaveCSS(
    'box-shadow',
    'none',
  );
  await expect(page.locator('[class*="thumb"]').first()).toHaveCSS('border-top-width', '1px');
  await expect(page.getByText('Drag to pan')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  await screenshot(page, 'hyperbolic-canvas-flat-node-surfaces', { fullPage: true });
});

test('hyperbolic canvas generating chrome stays static', async ({ page }) => {
  await mockMedia(page);
  const assets = [
    asset('hero', 'Hero Character'),
    asset('atlas', 'Atlas Sheet', 'sprite-sheet'),
    asset('map', 'Map Source', 'reference'),
    asset('scene', 'Scene Bar', 'scene'),
  ];

  const props = {
    spaceId: 'space-1',
    assets,
    variants: assets.map((entry) => variant(entry.id)),
    onAssetClick: '__record__:asset-click',
  };
  await mountComponent(page, 'HyperbolicCanvas', props);
  await sizeHarness(page);
  await page.evaluate((p) => {
    (window as unknown as { __setHarnessProps: (x: unknown) => void }).__setHarnessProps({
      ...p,
      jobs: new Map([['job-hero', { assetId: 'hero', status: 'processing' }]]),
    });
  }, props);

  const generatingThumb = page.locator('[class*="thumb"][class*="generating"]').first();
  await expect(generatingThumb).toBeVisible();
  await expect(generatingThumb).toHaveCSS('animation-name', 'none');
  await expect(generatingThumb).toHaveCSS(
    'box-shadow',
    'none',
  );
  await expect(generatingThumb).toHaveCSS(
    'border-top-color',
    await resolvedColor(page, 'var(--color-accent)'),
  );

  await screenshot(page, 'hyperbolic-canvas-flat-generating-chrome', { fullPage: true });
});
