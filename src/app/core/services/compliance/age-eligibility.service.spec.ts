import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

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

});
