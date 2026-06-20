const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export const ROTATION_FEATURE_FLAG = 'MAKEFX_ROTATION_ENABLED';

export function isFeatureFlagEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  if (typeof value !== 'string') {
    return false;
  }
  return TRUE_VALUES.has(value.trim().toLowerCase());
}
