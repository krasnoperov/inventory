import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('pagination renders controls and records page changes', async ({ page }) => {
  await mountComponent(page, 'Pagination', {
    currentPage: 3,
    totalPages: 8,
    onPageChange: '__record__:page-change',
  });

  await expect(page.getByRole('navigation', { name: 'Pagination' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect
    .poll(() => page.evaluate(() => window.__componentHarnessCalls ?? []))
    .toContain('page-change');

  await screenshot(page, 'pagination-default');
});
