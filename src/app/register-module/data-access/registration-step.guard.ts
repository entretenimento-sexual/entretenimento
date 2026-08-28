// src/app/register-module/data-access/registration-step.guard.ts
// =============================================================================
// GUARD: REGISTRATION STEP
// =============================================================================
//
// Responsabilidade:
// - impedir acesso direto a etapas fora de ordem;
// - usar RegisterFlowFacade como fonte canônica do estado de registro;
// - aguardar a resolução do documento do usuário antes de decidir a etapa;
// - redirecionar para a próxima rota correta definida por RegisterNavigationService;
// - preservar um redirectTo interno e seguro entre etapas do onboarding.
//
// Regra:
// - /register/welcome só é etapa de verificação de e-mail;
// - /register/recuperar-conta só é etapa de recuperação do documento privado;
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

function resolveSafeRedirectTo(router: Router, currentUrl: string): string | null {
  try {
    const raw = String(
      router.parseUrl(currentUrl).queryParams?.['redirectTo'] ?? ''
    ).trim();

    if (
      !raw ||
      !raw.startsWith('/') ||
      raw.startsWith('//') ||
      raw.startsWith('/login') ||
      raw.startsWith('/register') ||
      raw.startsWith('/adulto/confirmar')
    ) {
      return null;
    }

    return raw;
  } catch {
    return null;
  }
}

function targetSupportsRedirect(target: string): boolean {
  const path = normalizePath(target);

  return (
    path === '/register/welcome' ||
    path === '/register/recuperar-conta' ||
    path === '/register/aceitar-termos' ||
    path === '/register/finalizar-cadastro' ||
    path === '/adulto/confirmar'
  );
}

function buildTargetTree(
  router: Router,
  target: string,
  redirectTo: string | null
): UrlTree {
  const targetTree = router.parseUrl(target);

  if (
    !redirectTo ||
    !targetSupportsRedirect(target) ||
    targetTree.queryParams?.['redirectTo']
  ) {
    return targetTree;
  }

  const separator = target.includes('?') ? '&' : '?';

  return router.parseUrl(
    `${target}${separator}redirectTo=${encodeURIComponent(redirectTo)}`
  );
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

  return buildTargetTree(
    router,
    target,
    resolveSafeRedirectTo(router, currentUrl)
  );
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
