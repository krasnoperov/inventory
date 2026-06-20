import { isFeatureFlagEnabled, ROTATION_FEATURE_FLAG } from '../../shared/featureFlags';

export function isCliRotationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isFeatureFlagEnabled(env[ROTATION_FEATURE_FLAG]);
}

export function rotationDisabledMessage(): string {
  return `Rotation features are disabled. Set ${ROTATION_FEATURE_FLAG}=true to enable this experimental surface.`;
}
