import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

import { FirestoreUserWriteService } from '../../data-handling/firestore-user-write.service';
import { GeolocationTrackingService } from '../../geolocation/geolocation-tracking.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

import { AuthPostLoginEffectsService } from './auth-post-login-effects.service';

function buildUser(): User {
  return {
    uid: 'user-a',
    displayName: 'Pessoa A',
  } as User;
}

function createHarness() {
  const ensureUserDoc$ = vi.fn(() => of(void 0));
  const patchLastLogin$ = vi.fn(() => of(void 0));
  const autoStartTracking = vi.fn(() => Promise.resolve());
  const report = vi.fn();
  const log = vi.fn();

  const service = new AuthPostLoginEffectsService(
    {
      ensureUserDoc$,
      patchLastLogin$,
    } as unknown as FirestoreUserWriteService,
    {
      autoStartTracking,
    } as unknown as GeolocationTrackingService,
    {
      report,
    } as unknown as ApplicationErrorService,
    {
      log,
    } as unknown as PrivacyDebugLoggerService
  );

  return {
    service,
    ensureUserDoc$,
    patchLastLogin$,
    autoStartTracking,
    report,
    log,
  };
}

describe('AuthPostLoginEffectsService', () => {
  it('executa seed, lastLogin e geolocalização na ordem esperada', async () => {
    const {
      service,
      ensureUserDoc$,
      patchLastLogin$,
      autoStartTracking,
      report,
    } = createHarness();
    const user = buildUser();

    await expect(firstValueFrom(service.run$(user))).resolves.toBeUndefined();

    expect(ensureUserDoc$).toHaveBeenCalledWith(user, {
      nickname: 'Pessoa A',
    });
    expect(patchLastLogin$).toHaveBeenCalledWith('user-a');
    expect(autoStartTracking).toHaveBeenCalledWith('user-a');
    expect(report).not.toHaveBeenCalled();

    expect(ensureUserDoc$.mock.invocationCallOrder[0])
      .toBeLessThan(patchLastLogin$.mock.invocationCallOrder[0]);
    expect(patchLastLogin$.mock.invocationCallOrder[0])
      .toBeLessThan(autoStartTracking.mock.invocationCallOrder[0]);
  });

  it('absorve falha do pipeline principal com diagnóstico silencioso', async () => {
    const { service, ensureUserDoc$, patchLastLogin$, report } =
      createHarness();
    const error = new Error('seed failed');
    ensureUserDoc$.mockReturnValueOnce(throwError(() => error));

    await expect(firstValueFrom(service.run$(buildUser())))
      .resolves.toBeUndefined();

    expect(patchLastLogin$).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(error, {
      feature: 'auth-post-login-effects',
      operation: 'auth-post-login-effects.run',
      fallbackMessage:
        'Não foi possível concluir uma etapa interna após o login.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'AuthPostLoginEffectsService',
        phase: 'auth-post-login-effects.run',
        uid: 'user-a',
      },
    });
  });

  it('mantém geolocalização best-effort sem rediagnóstico no catch externo', async () => {
    const { service, autoStartTracking, report } = createHarness();
    const error = new Error('geolocation denied');
    autoStartTracking.mockRejectedValueOnce(error);

    await expect(firstValueFrom(service.run$(buildUser())))
      .resolves.toBeUndefined();

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(error, {
      feature: 'auth-post-login-effects',
      operation: 'auth-post-login-effects.geolocation',
      fallbackMessage:
        'Não foi possível concluir uma etapa interna após o login.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'AuthPostLoginEffectsService',
        phase: 'auth-post-login-effects.geolocation',
        uid: 'user-a',
      },
    });
  });

  it('não quebra o fluxo se a própria camada de diagnóstico falhar', async () => {
    const { service, ensureUserDoc$, report } = createHarness();
    ensureUserDoc$.mockReturnValueOnce(
      throwError(() => new Error('seed failed'))
    );
    report.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    await expect(firstValueFrom(service.run$(buildUser())))
      .resolves.toBeUndefined();

    expect(report).toHaveBeenCalledTimes(1);
  });
});
