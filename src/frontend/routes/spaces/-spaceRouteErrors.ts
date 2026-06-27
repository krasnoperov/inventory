import { SpaceAccessRequiredError } from '../../queries';

export function isSpaceAccessRequiredError(error: unknown): error is SpaceAccessRequiredError {
  return error instanceof SpaceAccessRequiredError;
}
