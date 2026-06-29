import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const voices = [
  {
    voiceId: 'voice-1',
    name: 'Mira',
    category: 'premade',
    description: null,
    previewUrl: null,
    labels: { gender: 'feminine', accent: 'us' },
  },
  {
    voiceId: 'voice-2',
    name: 'Noah',
    category: 'premade',
    description: null,
    previewUrl: null,
    labels: { gender: 'masculine', accent: 'uk' },
  },
];

async function mockVoices(page: import('@playwright/test').Page) {
  await page.route('**/api/voices', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ available: true, voices }),
  }));
}

async function selectDropdown(page: import('@playwright/test').Page, label: string, optionName: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: optionName }).click();
}

test('voice picker dialogue actions use shared icon controls', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 360 });
  await mockVoices(page);
  await mountComponent(page, 'VoicePicker', {
    mode: 'dialogue',
    disabled: false,
    voiceId: undefined,
    onVoiceIdChange: '__record__:voice',
    dialogueVoiceIds: ['voice-1', 'voice-2'],
    onDialogueVoiceIdsChange: '__record__:dialogue',
  });

  await expect(page.getByRole('button', { name: 'Add speaker voice' })).toBeVisible();
  await selectDropdown(page, 'Speaker 1 voice', 'Noah');
  await page.getByRole('button', { name: 'Remove voice' }).first().click();
  await page.getByRole('button', { name: 'Add speaker voice' }).click();

  await screenshot(page, 'voice-picker-dialogue-actions', { fullPage: true });

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ eventName: 'dialogue', args: [['voice-2', 'voice-2']] }),
    expect.objectContaining({ eventName: 'dialogue', args: [['voice-2']] }),
    expect.objectContaining({ eventName: 'dialogue', args: [['voice-1', 'voice-2', 'voice-1']] }),
  ]));
});
