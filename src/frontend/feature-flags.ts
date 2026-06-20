import type { StartSession } from './app-context';

export function isWebRotationEnabled(session: StartSession | null | undefined): boolean {
  return session?.config.features.rotation === true;
}
