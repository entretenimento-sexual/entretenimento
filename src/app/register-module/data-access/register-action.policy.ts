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
  return error instanceof TimeoutError || isTransientNetworkError(error);
}
