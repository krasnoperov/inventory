export type CustomerChargeUnit =
  | 'token'
  | 'image'
  | 'video_unit'
  | 'audio_generation'
  | 'audio_unit'
  | 'meter_unit';

export function buildCustomerChargeKey(usageEventId: string): string {
  return `usage_event:${usageEventId}`;
}

export function inferCustomerChargeUnit(eventName: string): CustomerChargeUnit {
  if (eventName.endsWith('_tokens')) return 'token';
  if (eventName === 'gemini_images') return 'image';
  if (eventName === 'gemini_videos') return 'video_unit';
  if (eventName === 'gemini_audio') return 'audio_generation';
  if (eventName === 'elevenlabs_audio') return 'audio_unit';
  return 'meter_unit';
}
