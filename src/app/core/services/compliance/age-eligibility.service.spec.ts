import { EnvironmentInjector, Injector } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { deleteApp, initializeApp } from 'firebase/app';
import { getFunctions } from 'firebase/functions';
import { BehaviorSubject, firstValueFrom, map, NEVER, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AgeEligibilityService } from './age-eligibility.service';

function createService(
  user$: BehaviorSubject<IUserDados | null | undefined>,
  functions?: Functions
): AgeEligibilityService {
  return new AgeEligibilityService(
    Injector.create({ providers: [{ provide: Functions, useValue: functions }] }) as EnvironmentInjector,
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

  it.each(['UNVERIFIED', 'REVIEW_REQUIRED'] as const)(
    'faz a resposta canônica %s prevalecer até chegar uma projeção mais recente',
    async (status) => {
      const oldUser = {
        uid: 'user-1',
        ageEligibility: {
          status: 'SELF_DECLARED_ADULT',
          policyVersion: 1,
          source: 'SELF_DECLARATION',
          method: 'SELF_DECLARATION',
          updatedAtMs: 1_000,
        },
      } as IUserDados;
      const user$ = new BehaviorSubject<IUserDados | null | undefined>(oldUser);
      const app = initializeApp({ projectId: 'demo-age-eligibility' }, 'age-eligibility-spec');
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () =>
        new Response(JSON.stringify({ data: { status, ageEligibility: null, evaluatedAtMs: 2_000 } }))
      ));

      try {
        const service = createService(user$, getFunctions(app));
        await expect(firstValueFrom(service.reconcileTrustedStateOncePerSession$()))
          .resolves.toMatchObject({ status });
        user$.next({ ...oldUser, ageEligibility: { ...oldUser.ageEligibility!, updatedAtMs: 3_000 } });
        await expect(firstValueFrom(service.current$))
          .resolves.toMatchObject({ status: 'SELF_DECLARED_ADULT' });
      } finally {
        vi.unstubAllGlobals();
        await deleteApp(app);
      }
    }
  );

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
