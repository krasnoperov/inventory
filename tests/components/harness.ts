import { type Page } from '@playwright/test';

export async function mountComponent(
  page: Page,
  componentName: string,
  props: Record<string, unknown>,
): Promise<void> {
  const propsB64 = encodeURIComponent(Buffer.from(JSON.stringify(props)).toString('base64'));
  const url = `/component-harness.html?component=${encodeURIComponent(componentName)}&props=${propsB64}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="harness-root"]', { state: 'attached' });
}

export async function screenshot(page: Page, name: string, opts?: { fullPage?: boolean }): Promise<string> {
  const path = `test-results/components/screenshots/${name}.png`;
  if (process.env.CAPTURE_SCREENSHOTS !== '1') {
    return path;
  }

  if (opts?.fullPage) {
    await page.screenshot({ path, fullPage: true });
  } else {
    await page.locator('[data-testid="harness-root"]').screenshot({ path });
  }

  return path;
}
