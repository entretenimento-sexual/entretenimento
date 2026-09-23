import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AgeEligibilityService } from './age-eligibility.service';

describe('AgeEligibilityService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('falha fechado quando a projeção não existe', async () => {
    const user$ = new BehaviorSubject<IUserDados | null | undefined>(null);
    const service = new AgeEligibilityService(
      {} as any,
      { user$: user$.asObservable() } as any,
      { handleError: () => undefined } as any
    );

    await expect(firstValueFrom(service.adultAccessAllowed$))
      .resolves.toBe(false);
    await expect(firstValueFrom(service.verifiedAdult$))
      .resolves.toBe(false);
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
    const service = new AgeEligibilityService(
      {} as any,
      { user$: user$.asObservable() } as any,
      { handleError: () => undefined } as any
    );

    await expect(firstValueFrom(service.verifiedAdult$))
      .resolves.toBe(true);
  });

  it('libera acesso com autodeclaração backend sem marcar como verificação forte', async () => {
    const user$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
      ageEligibility: {
        status: 'DECLARED_ADULT',
        policyVersion: 1,
        source: 'SELF_ATTESTATION',
        method: 'SELF_ATTESTATION',
        assuranceLevel: 'SELF_ATTESTED',
        caseId: null,
        verifiedAtMs: null,
        expiresAtMs: null,
        updatedAtMs: Date.now(),
      },
    } as unknown as IUserDados);
    const service = new AgeEligibilityService(
      {} as any,
      { user$: user$.asObservable() } as any,
      { handleError: () => undefined } as any
    );

    await expect(firstValueFrom(service.adultAccessAllowed$))
      .resolves.toBe(true);
    await expect(firstValueFrom(service.verifiedAdult$))
      .resolves.toBe(false);
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
    const service = new AgeEligibilityService(
      {} as any,
      { user$: user$.asObservable() } as any,
      { handleError: () => undefined } as any
    );

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
    const service = new AgeEligibilityService(
      {} as any,
      { user$: user$.asObservable() } as any,
      { handleError: () => undefined } as any
    );
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
