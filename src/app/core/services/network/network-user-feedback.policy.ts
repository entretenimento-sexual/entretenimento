// Mensagem única de conectividade para a plataforma inteira.
// Browser offline é apenas um sinal; não mascara erros de regra de negócio.
import { isTransientNetworkError } from './network-retry.policy';

export const OFFLINE_USER_MESSAGE =
  'Você está offline. Verifique sua conexão com a internet.';

export function isOfflineTransportFailure(
  error: unknown,
  isOnline: boolean,
  hasDomainDecision = false
): boolean {
  return !isOnline && !hasDomainDecision && isTransientNetworkError(error);
}
