import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { firstValueFrom, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { RegisterFlowFacade } from './register-flow.facade';
import type { RegisterFlowVm } from './register-flow.model';
import { registrationStepGuard } from './registration-step.guard';

describe('registrationStepGuard', () => {
  let router: Router;
  let currentVm: RegisterFlowVm;

  const route = {
    data: {
      allowedRegisterSteps: ['adultConsent'],
    },
  } as unknown as ActivatedRouteSnapshot;

  const makeVm = (
    currentStep: RegisterFlowVm['currentStep'],
    nextRoute: string
  ): RegisterFlowVm => ({
    authReady: true,
    uid: 'u1',
    email: 'teste@email.com',
    emailVerified: true,
    userResolved: true,
    userExists: true,
    termsAccepted: currentStep !== 'termsAcceptance',
    profileCompleted:
      currentStep === 'adultConsent' || currentStep === 'preferences',
    adultConsentAccepted: currentStep === 'preferences',
    currentStep,
    nextRoute,
    progress: 75,
    canContinue: true,
    primaryActionLabel: 'Continuar',
  });

  beforeEach(() => {
    currentVm = makeVm('adultConsent', '/adulto/confirmar');

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [
        {
          provide: RegisterFlowFacade,
          useValue: {
            vm$: new Observable<RegisterFlowVm>((subscriber) => {
              subscriber.next(currentVm);
              subscriber.complete();
            }),
          },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  async function runGuard(url: string): Promise<boolean | UrlTree> {
    const state = { url } as RouterStateSnapshot;

    return firstValueFrom(
      TestBed.runInInjectionContext(
        () => registrationStepGuard(route, state)
      ) as Observable<boolean | UrlTree>
    );
  }

  it('deve permitir quando consentimento adulto for a etapa atual', async () => {
    currentVm = makeVm('adultConsent', '/adulto/confirmar');

    await expect(runGuard('/adulto/confirmar')).resolves.toBe(true);
  });

  it('deve redirecionar acesso direto para termos quando essa for a etapa atual', async () => {
    currentVm = makeVm('termsAcceptance', '/register/aceitar-termos');

    const result = await runGuard(
      '/adulto/confirmar?redirectTo=%2Fdashboard%2Fprincipal'
    );

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe(
      '/register/aceitar-termos?redirectTo=%2Fdashboard%2Fprincipal'
    );
  });

  it('deve redirecionar acesso direto para conclusão do perfil', async () => {
    currentVm = makeVm(
      'profileCompletion',
      '/register/finalizar-cadastro'
    );

    const result = await runGuard('/adulto/confirmar');

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe(
      '/register/finalizar-cadastro'
    );
  });
});
