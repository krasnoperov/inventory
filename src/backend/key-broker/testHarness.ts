import type { KeyBrokerService } from './contract';
import { createKeyBrokerService, type KeyBrokerWorkerEnv } from './service';

export function createLocalKeyBrokerServiceBinding(env: KeyBrokerWorkerEnv): KeyBrokerService {
  return createKeyBrokerService(env);
}
