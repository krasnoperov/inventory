import { expect, test, type Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

async function resolvedShadow(page: Page, value: string) {
  return page.evaluate((shadowValue) => {
    const probe = document.createElement('div');
    probe.style.boxShadow = shadowValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).boxShadow;
    probe.remove();
    return resolved;
  }, value);
}

test('audio player transport uses shared icon button styling', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 180 });
  await mountComponent(page, 'AudioPlayer', {
    src: silentWav,
    seed: 'crystal-gate-audio',
  });

  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  const seek = page.getByLabel('Seek');
  await expect(seek).toBeVisible();

  await page.locator('audio').evaluate((audio) => {
    Object.defineProperty(audio, 'duration', { configurable: true, value: 12 });
    audio.dispatchEvent(new Event('durationchange'));
  });
  await expect(seek).toBeEnabled();

  await seek.focus();
  await expect(seek).toHaveCSS('box-shadow', await resolvedShadow(page, 'var(--focus-ring)'));

  await screenshot(page, 'audio-player-shared-transport', { fullPage: true });
});
