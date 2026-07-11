// src/app/register-module/data-access/registration-step.guard.ts
// =============================================================================
// GUARD: REGISTRATION STEP
// =============================================================================
//
// Responsabilidade:
// - impedir acesso direto a etapas fora de ordem;
// - usar RegisterFlowFacade como fonte canônica do estado de registro;
// - aguardar a resolução do documento do usuário antes de decidir a etapa;
// - redirecionar para a próxima rota correta definida por RegisterNavigationService.
//
// Regra:
// - /register/welcome só é etapa de verificação de e-mail;
// - /register/aceitar-termos só é etapa de aceite explícito;
// - /register/finalizar-cadastro só é etapa de conclusão de perfil;
// - se o usuário estiver em outro passo, o guard retorna UrlTree para vm.nextRoute.
//
// Não faz:
// - escrita em Firestore;
// - reload de Auth;
// - upload de avatar;
// - alteração de consentimento;
// - navegação imperativa via router.navigate().

import { inject } from '@angular/core';
import {
  CanActivateFn,
  Router,
  UrlTree,
} from '@angular/router';

import { Observable, of } from 'rxjs';
import {
  catchError,
  filter,
  map,
  take,
  timeout,
} from 'rxjs/operators';

import { RegisterFlowFacade } from './register-flow.facade';
import {
  RegisterFlowStep,
  RegisterFlowVm,
} from './register-flow.model';

type RegistrationStepGuardResult = boolean | UrlTree;

const REGISTER_FLOW_GUARD_TIMEOUT_MS = 5000;

function normalizePath(url: string): string {
  return (url || '').split('?')[0].split('#')[0] || '/';
}

function samePath(currentUrl: string, targetUrl: string): boolean {
  return normalizePath(currentUrl) === normalizePath(targetUrl);
}

function getAllowedSteps(raw: unknown): RegisterFlowStep[] {
  return Array.isArray(raw)
    ? raw.filter((step): step is RegisterFlowStep => typeof step === 'string')
    : [];
}

function buildLoginRedirect(
  router: Router,
  currentUrl: string,
  reason: string
): UrlTree {
  return router.createUrlTree(['/login'], {
    queryParams: {
      redirectTo: currentUrl,
      reason,
    },
  });
}

function resolveGuardResult(
  router: Router,
  currentUrl: string,
  vm: RegisterFlowVm | null,
  allowedSteps: RegisterFlowStep[]
): RegistrationStepGuardResult {
  if (!vm) {
    return buildLoginRedirect(router, currentUrl, 'register_flow_timeout');
  }

  if (!vm.uid) {
    return buildLoginRedirect(router, currentUrl, 'register_no_session');
  }

  if (allowedSteps.includes(vm.currentStep)) {
    return true;
  }

  const target = vm.nextRoute || '/register';

  if (samePath(currentUrl, target)) {
    return true;
  }

  return router.parseUrl(target);
}

export const registrationStepGuard: CanActivateFn = (
  route,
  state
): Observable<RegistrationStepGuardResult> => {
  const router = inject(Router);
  const registerFlow = inject(RegisterFlowFacade);

  const allowedSteps = getAllowedSteps(route.data?.['allowedRegisterSteps']);

  return registerFlow.vm$.pipe(
    filter((vm) => vm.authReady === true),
    filter(
      (vm) =>
        vm.currentStep === 'emailVerification' ||
        vm.userResolved === true
    ),
    take(1),
    timeout({
      first: REGISTER_FLOW_GUARD_TIMEOUT_MS,
      with: () => of(null),
    }),
    map((vm) => resolveGuardResult(router, state.url, vm, allowedSteps)),
    catchError(() =>
      of(buildLoginRedirect(router, state.url, 'register_flow_error'))
    )
  );
};
