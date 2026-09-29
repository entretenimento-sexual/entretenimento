import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AgeEligibilityService } from './age-eligibility.service';

function createService(
  user$: BehaviorSubject<IUserDados | null | undefined>
): AgeEligibilityService {
  return new AgeEligibilityService(
    {} as any,
    {
      user$: user$.asObservable(),
      getLoggedUserUIDSnapshot: () =>
        String(user$.value?.uid ?? '').trim() || null,
    } as any,
    { handleError: () => undefined } as any
  );
}

describe('AgeEligibilityService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('falha fechado quando a projeção não existe', async () => {
    const user$ = new BehaviorSubject<IUserDados | null | undefined>(null);
    const service = createService(user$);

    await expect(firstValueFrom(service.verifiedAdult$))
      .resolves.toBe(false);
  });

  it('permite acesso provisório por autodeclaração sem chamar isso de verificação', async () => {
    const user$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
      ageEligibility: {
        status: 'SELF_DECLARED_ADULT',
        policyVersion: 1,
        source: 'SELF_DECLARATION',
        method: 'SELF_DECLARATION',
        caseId: null,
        verifiedAtMs: null,
        expiresAtMs: null,
        updatedAtMs: Date.now(),
      },
    } as unknown as IUserDados);
    const service = createService(user$);

    await expect(firstValueFrom(service.adultAccessAllowed$))
      .resolves.toBe(true);
    await expect(firstValueFrom(service.verifiedAdult$))
      .resolves.toBe(false);
  });

  it('usa a projeção confiável de sessão até a projeção realtime chegar', async () => {
    const user$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
    } as IUserDados);
    const service = createService(user$);

    (service as any).trustedSessionProjection.next({
      uid: 'user-1',
      state: {
        status: 'SELF_DECLARED_ADULT',
        policyVersion: 1,
        source: 'SELF_DECLARATION',
        method: 'SELF_DECLARATION',
        caseId: null,
        verifiedAtMs: null,
        expiresAtMs: null,
        updatedAtMs: Date.now(),
      },
    });

    await expect(firstValueFrom(service.adultAccessAllowed$))
      .resolves.toBe(true);
  });

  it('não reutiliza a projeção confiável depois do encerramento da sessão', async () => {
    const user$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
    } as IUserDados);
    const service = createService(user$);

    (service as any).trustedSessionProjection.next({
      uid: 'user-1',
      state: {
        status: 'SELF_DECLARED_ADULT',
        policyVersion: 1,
        source: 'SELF_DECLARATION',
        method: 'SELF_DECLARATION',
        caseId: null,
        verifiedAtMs: null,
        expiresAtMs: null,
        updatedAtMs: Date.now(),
      },
    });

    user$.next(null);
    user$.next({ uid: 'user-1' } as IUserDados);

    await expect(firstValueFrom(service.adultAccessAllowed$))
      .resolves.toBe(false);
  });

  it('reconcilia estado UNVERIFIED antes de negar acesso', async () => {
    const user$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
    } as IUserDados);
    const service = createService(user$);

    const refresh = vi
      .spyOn(service, 'refreshTrustedSources$')
      .mockReturnValueOnce(of('SELF_DECLARED_ADULT'));

    await expect(firstValueFrom(service.reconciledAdultAccess$))
      .resolves.toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('não reconcilia novamente quando a projeção já está válida', async () => {
    const user$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
      ageEligibility: {
        status: 'SELF_DECLARED_ADULT',
        policyVersion: 1,
        source: 'SELF_DECLARATION',
        method: 'SELF_DECLARATION',
        caseId: null,
        verifiedAtMs: null,
        expiresAtMs: null,
        updatedAtMs: Date.now(),
      },
    } as unknown as IUserDados);
    const service = createService(user$);
    const refresh = vi.spyOn(service, 'refreshTrustedSources$');

    await expect(firstValueFrom(service.reconciledAdultAccess$))
      .resolves.toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('expõe adulto verificado somente a partir da projeção backend', async () => {
    const user$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
      ageEligibility: {
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        caseId: 'case-1',
        verifiedAtMs: Date.now() - 1_000,
        expiresAtMs: null,
        updatedAtMs: Date.now(),
      },
    } as unknown as IUserDados);
    const service = createService(user$);

    await expect(firstValueFrom(service.verifiedAdult$))
      .resolves.toBe(true);
  });

  it('não aceita projeção estruturalmente inválida', async () => {
    const user$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
      ageEligibility: {
        status: 'VERIFIED_ADULT',
        policyVersion: 0,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
      },
    } as unknown as IUserDados);
    const service = createService(user$);

    const state = await firstValueFrom(service.getCurrentOnce$());

    expect(state.status).toBe('UNVERIFIED');
    expect(state.policyVersion).toBe(0);
  });

  it('expira o gate local no instante da projeção sem esperar nova escrita', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);

    const user$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
      ageEligibility: {
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        caseId: 'case-1',
        verifiedAtMs: now - 1_000,
        expiresAtMs: now + 100,
        updatedAtMs: now,
      },
    } as unknown as IUserDados);
    const service = createService(user$);
    const states: boolean[] = [];
    const subscription = service.adultAccessAllowed$.subscribe((value) =>
      states.push(value)
    );

    expect(states).toEqual([true]);

    await vi.advanceTimersByTimeAsync(101);

    expect(states).toEqual([true, false]);
    subscription.unsubscribe();
  });
});
