import { expect, test } from '@playwright/test';
import { mountComponent } from './harness';

const baseTime = 1_700_000_000_000;

const variant = {
  id: 'gen-v1',
  asset_id: 'gen',
  media_kind: 'image',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: 'images/space/gen.png',
  thumb_key: null,
  media_key: null,
  media_mime_type: 'image/png',
  media_size_bytes: 1,
  media_width: 512,
  media_height: 512,
  media_duration_ms: null,
  recipe: '{}',
  starred: false,
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
  description: null,
};

const composition = (id: string, name: string) => ({
  id,
  name,
  description: null,
  status: 'draft',
  output_asset_id: null,
  output_variant_id: null,
  metadata: '{}',
  sort_index: 0,
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
});

// Post-generation placement replaces the old pre-generation ForgeTray dropdown:
// composition and role are two separate selects acting on a finished variant.
test('places a finished variant into the chosen composition and role', async ({ page }) => {
  await mountComponent(page, 'CompositionPlacementControl', {
    compositions: [composition('c1', 'Arbol scene'), composition('c2', 'Hero card')],
    compositionItems: [],
    variant,
    onPlace: '__record__:place',
  });

  await page.getByLabel('Composition', { exact: true }).selectOption('c2');
  await page.getByLabel('Composition role').selectOption('character');
  await page.getByRole('button', { name: 'Place' }).click();

  // Confirmation reflects the resolved target in product language.
  await expect(page.getByText('Added to Hero card · Character')).toBeVisible();

  const details = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(details).toHaveLength(1);
  expect(details[0].eventName).toBe('place');
  // First arg is the variant, second is the resolved composition shortcut.
  expect(details[0].args[1]).toMatchObject({ kind: 'slot', compositionId: 'c2', role: 'character' });
});
