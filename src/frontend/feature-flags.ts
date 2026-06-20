import { isFeatureFlagEnabled } from '../shared/featureFlags';

declare const __MAKEFX_ROTATION_ENABLED__: string | undefined;

export function isWebRotationEnabled(): boolean {
  return isFeatureFlagEnabled(typeof __MAKEFX_ROTATION_ENABLED__ === 'undefined'
    ? undefined
    : __MAKEFX_ROTATION_ENABLED__);
}
