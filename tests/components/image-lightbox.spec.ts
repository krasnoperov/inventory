import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#668cff"/><circle cx="120" cy="80" r="42" fill="#ffffff"/></svg>';
const imageSrc = `data:image/svg+xml,${encodeURIComponent(imageSvg)}`;

test('image lightbox close action uses shared icon button styling', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 360 });
  const longCaption = 'Crystal Gate preview with a long readable production caption / 240 x 160 / generated from a multi-reference scene';
  await mountComponent(page, 'ImageLightbox', {
    src: imageSrc,
    alt: 'Crystal Gate preview',
    caption: longCaption,
    onClose: '__record__:close',
  });

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Crystal Gate preview' })).toBeVisible();
  const image = page.getByRole('img', { name: 'Crystal Gate preview' });
  await expect(image).toHaveCSS('box-shadow', 'none');
  await expect(image).toHaveCSS('outline-style', 'solid');
  await expect(image).toHaveCSS('outline-width', '1px');
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  await expect(page.locator('[class*="backdrop"]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[class*="backdrop"]')).toHaveCSS('background-color', 'rgb(243, 245, 249)');
  const caption = page.getByText(longCaption);
  await expect(caption).toBeVisible();
  await expect(caption).toHaveCSS('white-space', 'normal');
  await expect(caption).toHaveCSS('text-overflow', 'clip');
  const geometry = await caption.evaluate((captionNode) => {
    const image = document.querySelector('img');
    if (!image) return null;
    const imageBox = image.getBoundingClientRect();
    const captionBox = captionNode.getBoundingClientRect();
    return {
      captionWithinViewport: captionBox.left >= 0 && captionBox.right <= window.innerWidth && captionBox.bottom <= window.innerHeight,
      captionBelowImage: captionBox.top >= imageBox.bottom,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.captionWithinViewport).toBe(true);
  expect(geometry!.captionBelowImage).toBe(true);
  await screenshot(page, 'image-lightbox-flat-media-chrome', { fullPage: true });
});
