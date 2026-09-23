import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AgeEligibilityService } from './age-eligibility.service';

describe('AgeEligibilityService', () => {
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
        verifiedAtMs: 1_800_000_000_000,
        expiresAtMs: null,
        updatedAtMs: 1_800_000_000_000,
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
