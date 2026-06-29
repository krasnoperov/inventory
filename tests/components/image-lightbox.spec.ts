import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#668cff"/><circle cx="120" cy="80" r="42" fill="#ffffff"/></svg>';
const imageSrc = `data:image/svg+xml,${encodeURIComponent(imageSvg)}`;

test('image lightbox close action uses shared icon button styling', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 360 });
  await mountComponent(page, 'ImageLightbox', {
    src: imageSrc,
    alt: 'Crystal Gate preview',
    caption: 'Crystal Gate / 240 x 160',
    onClose: '__record__:close',
  });

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Crystal Gate preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  await screenshot(page, 'image-lightbox-shared-close', { fullPage: true });
});
