import { TimeoutError } from 'rxjs';
import { isTransientNetworkError } from '@core/services/network/network-retry.policy';

export const REGISTRATION_ACTION_TIMEOUT_MS = 15_000;

export function isRegistrationSessionChange(error: unknown): boolean {
  const failure = error as { code?: unknown; details?: { reason?: unknown } } | null;
  return failure?.code === 'auth/session-changed' ||
    (failure?.code === 'functions/permission-denied' &&
      failure.details?.reason === 'auth/session-changed');
}

export function isRegistrationConfirmationUncertain(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  // O SDK de Functions também usa internal quando o fetch perde a resposta.
  return code === 'functions/internal' || error instanceof TimeoutError || isTransientNetworkError(error);
}
