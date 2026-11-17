import { BehaviorSubject, firstValueFrom, map, NEVER, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AgeEligibilityService } from './age-eligibility.service';

function createService(
  user$: BehaviorSubject<IUserDados | null | undefined>
): AgeEligibilityService {
  return new AgeEligibilityService(
    {} as any,
    {
      user$: user$.asObservable(),
      getLoggedUserUID$: () => user$.pipe(map((user) => user?.uid ?? null)),
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

  it('consulta novamente quando a etapa cancela a única assinatura pendente', async () => {
    const service = createService(new BehaviorSubject<IUserDados | null | undefined>({
      uid: 'user-1',
    } as IUserDados));
    const refresh = vi.spyOn(service, 'refreshTrustedSources$')
      .mockReturnValueOnce(NEVER)
      .mockReturnValueOnce(of('UNVERIFIED'));

    const inFlight$ = service.reconcileTrustedStateOncePerSession$();
    const subscription = inFlight$.subscribe();
    expect(service.reconcileTrustedStateOncePerSession$()).toBe(inFlight$);
    subscription.unsubscribe();

    await expect(firstValueFrom(service.reconcileTrustedStateOncePerSession$()))
      .resolves.toMatchObject({ status: 'UNVERIFIED' });
    await firstValueFrom(service.reconcileTrustedStateOncePerSession$());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

});
