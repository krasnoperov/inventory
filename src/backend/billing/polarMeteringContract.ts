export type PolarMeterAggregation = 'sum';

export interface PolarMeterContract {
  meterName: string;
  eventName: string;
  aggregation: PolarMeterAggregation;
  aggregationProperty: 'quantity';
  unit: 'token' | 'image' | 'video_unit' | 'audio_generation' | 'audio_unit';
  description: string;
}

export const POLAR_METERING_CONTRACT = [
  {
    meterName: 'claude_input_tokens',
    eventName: 'claude_input_tokens',
    aggregation: 'sum',
    aggregationProperty: 'quantity',
    unit: 'token',
    description: 'Claude input tokens.',
  },
  {
    meterName: 'claude_output_tokens',
    eventName: 'claude_output_tokens',
    aggregation: 'sum',
    aggregationProperty: 'quantity',
    unit: 'token',
    description: 'Claude output tokens.',
  },
  {
    meterName: 'gemini_images',
    eventName: 'gemini_images',
    aggregation: 'sum',
    aggregationProperty: 'quantity',
    unit: 'image',
    description: 'Generated Gemini image outputs.',
  },
  {
    meterName: 'gemini_videos',
    eventName: 'gemini_videos',
    aggregation: 'sum',
    aggregationProperty: 'quantity',
    unit: 'video_unit',
    description: 'Generated Gemini/Veo video units. Native-audio video requests count as two units.',
  },
  {
    meterName: 'gemini_audio',
    eventName: 'gemini_audio',
    aggregation: 'sum',
    aggregationProperty: 'quantity',
    unit: 'audio_generation',
    description: 'Generated Lyria music outputs.',
  },
  {
    meterName: 'gemini_input_tokens',
    eventName: 'gemini_input_tokens',
    aggregation: 'sum',
    aggregationProperty: 'quantity',
    unit: 'token',
    description: 'Gemini image API input tokens when reported by the provider.',
  },
  {
    meterName: 'gemini_output_tokens',
    eventName: 'gemini_output_tokens',
    aggregation: 'sum',
    aggregationProperty: 'quantity',
    unit: 'token',
    description: 'Gemini image API output tokens when reported by the provider.',
  },
  {
    meterName: 'elevenlabs_audio',
    eventName: 'elevenlabs_audio',
    aggregation: 'sum',
    aggregationProperty: 'quantity',
    unit: 'audio_unit',
    description: 'ElevenLabs provider usage units.',
  },
] as const satisfies readonly PolarMeterContract[];

export type PolarMeterName = (typeof POLAR_METERING_CONTRACT)[number]['meterName'];

export const EXPECTED_POLAR_METERS = POLAR_METERING_CONTRACT.map((meter) => meter.meterName) as PolarMeterName[];

export function getPolarMeterContract(meterName: string): PolarMeterContract | undefined {
  return POLAR_METERING_CONTRACT.find((meter) => meter.meterName === meterName);
}
