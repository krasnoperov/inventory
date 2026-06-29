import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

test('audio player transport uses shared icon button styling', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 180 });
  await mountComponent(page, 'AudioPlayer', {
    src: silentWav,
    seed: 'crystal-gate-audio',
  });

  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByLabel('Seek')).toBeVisible();
  await screenshot(page, 'audio-player-shared-transport', { fullPage: true });
});
