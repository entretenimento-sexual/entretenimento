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
// - /adulto/verificar-idade é a etapa canônica de verificação confiável da conta;
// - /adulto/confirmar é somente alias legado, não é etapa do cadastro;
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

import { Observable, merge, of } from 'rxjs';
import {
  catchError,
  filter,
  map,
  take,
  timeout,
} from 'rxjs/operators';

import { buildAuthRetryTree, buildRedirectTree } from '@core/guards/_shared-guard/guard-utils';
import { AuthAppBlockService } from '@core/services/autentication/auth/auth-app-block.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { REGISTER_FLOW_WAIT_MS } from './post-auth-navigation.service';
import { RegisterFlowFacade } from './register-flow.facade';
import {
  isRegistrationStepRoute,
  isRegisterFlowDecisionReady,
  resolveRegistrationReturnUrl,
  RegisterFlowStep,
  RegisterFlowVm,
} from './register-flow.model';

type RegistrationStepGuardResult = boolean | UrlTree;

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

function buildTargetTree(
  router: Router,
  target: string,
  redirectTo: string | null
): UrlTree {
  const targetTree = router.parseUrl(target);

  if (
    !redirectTo ||
    !isRegistrationStepRoute(target) ||
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
  vm: RegisterFlowVm,
  allowedSteps: RegisterFlowStep[]
): RegistrationStepGuardResult {
  if (!vm.uid) {
    return buildRedirectTree(router, '/login', currentUrl, { reason: 'session-ended' });
  }

  if (allowedSteps.includes(vm.currentStep)) {
    return true;
  }

  const target = vm.nextRoute || '/register';

  if (samePath(currentUrl, target)) {
    return true;
  }

  const requested = resolveRegistrationReturnUrl(
    router.parseUrl(currentUrl).queryParamMap.get('redirectTo')
  );
  if (vm.currentStep === 'preferences' && requested) {
    return router.parseUrl(requested);
  }

  return buildTargetTree(router, target, requested);
}

export const registrationStepGuard: CanActivateFn = (
  route,
  state
): Observable<RegistrationStepGuardResult> => {
  const router = inject(Router);
  const registerFlow = inject(RegisterFlowFacade);
  const session = inject(AuthSessionService);
  const appBlock = inject(AuthAppBlockService);
  const allowedSteps = getAllowedSteps(route.data?.['allowedRegisterSteps']);

  const block$ = appBlock.reason$.pipe(
    map(() => appBlock.domainBlockFor(session.isTerminatingSnapshot ? null : session.currentAuthUser?.uid)),
    filter((reason) => reason !== null),
    map((reason) => buildRedirectTree(router, '/conta/status', undefined, { reason }))
  );
  const decision$ = registerFlow.vm$.pipe(
    filter((vm) => isRegisterFlowDecisionReady(vm) &&
      vm.uid === (session.isTerminatingSnapshot ? null : session.currentAuthUser?.uid ?? null)),
    map((vm) => resolveGuardResult(router, state.url, vm, allowedSteps))
  );

  return merge(block$, decision$).pipe(
    take(1),
    timeout({
      first: REGISTER_FLOW_WAIT_MS,
      with: () => of(buildAuthRetryTree(router, state.url)),
    }),
    catchError(() => of(buildAuthRetryTree(router, state.url)))
  );
};
