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
        verifiedAtMs: Date.now() - 60_000,
        expiresAtMs: null,
        updatedAtMs: Date.now() - 60_000,
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

  it('expira o gate UX no relógio sem depender de nova escrita do backend', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);

    const user$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
      ageEligibility: {
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        caseId: 'case-1',
        verifiedAtMs: 1_799_999_000_000,
        expiresAtMs: 1_800_000_000_100,
        updatedAtMs: 1_799_999_000_000,
      },
    } as unknown as IUserDados);
    const service = new AgeEligibilityService(
      {} as any,
      { user$: user$.asObservable() } as any,
      { handleError: () => undefined } as any
    );
    const states: boolean[] = [];
    const subscription = service.verifiedAdult$.subscribe((value) => {
      states.push(value);
    });

    expect(states).toEqual([true]);

    await vi.advanceTimersByTimeAsync(101);

    expect(states).toEqual([true, false]);
    subscription.unsubscribe();
  });

  it('falha fechado quando VERIFIED_ADULT ainda não começou no relógio local', async () => {
    const now = Date.now();
    const user$ = new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
      ageEligibility: {
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        caseId: 'case-future',
        verifiedAtMs: now + 60_000,
        expiresAtMs: now + 120_000,
        updatedAtMs: now,
      },
    } as unknown as IUserDados);
    const service = new AgeEligibilityService(
      {} as any,
      { user$: user$.asObservable() } as any,
      { handleError: () => undefined } as any
    );

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
});
