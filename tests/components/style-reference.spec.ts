import path from 'node:path';
import { test } from '@playwright/test';
import {
  STYLE_REFERENCE_ROOT,
  mountStory,
  renderAreaIndex,
  shotInto,
  writeAreaIndex,
  type StyleReferenceEntry,
} from './style-reference.helpers';

// Captures every Ladle story across viewport × color-scheme into a browsable
// gallery. Color scheme is driven via emulateMedia (prefers-color-scheme),
// which is what our light-dark() tokens respond to.

type LadleMeta = {
  stories: Record<string, { name: string; levels: string[]; filePath: string }>;
};

const VIEWPORTS = [
  { name: 'mobile-375', width: 375, height: 800 },
  { name: 'tablet-900', width: 900, height: 800 },
  { name: 'desktop-1280', width: 1280, height: 800 },
] as const;

const THEMES = ['light', 'dark'] as const;
const entries: StyleReferenceEntry[] = [];
const areaDir = path.join(STYLE_REFERENCE_ROOT, 'components');

test.describe.configure({ mode: 'serial' });

test('captures Ladle component stories', async ({ page }) => {
  const response = await page.request.get('/meta.json');
  const meta = (await response.json()) as LadleMeta;
  const stories = Object.entries(meta.stories)
    .filter(([, story]) => story.filePath.includes('src/frontend/components/'))
    .sort(([a], [b]) => a.localeCompare(b));
  const selected = process.env.STYLE_REFERENCE_SMOKE === '1' ? stories.slice(0, 4) : stories;

  for (const [storyId, story] of selected) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const theme of THEMES) {
        await page.emulateMedia({ colorScheme: theme });
        await mountStory(page, storyId);
        await shotInto(
          page.locator('[data-style-reference-root]'),
          areaDir,
          `${storyId}-${viewport.name}-${theme}`,
          entries,
          `${story.levels.join(' / ')} / ${story.name}`,
          `${viewport.name}, ${theme}`,
          { tag: theme },
        );
      }
    }
  }
});

test.afterAll(async () => {
  await writeAreaIndex(
    'components',
    renderAreaIndex({
      title: 'Components',
      description: 'Ladle component stories captured across mobile/tablet/desktop and light/dark.',
      entries,
    }),
  );
});
