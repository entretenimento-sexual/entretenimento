// src/app/register-module/data-access/register-flow.model.ts

import type { RuntimeAccountLifecycleStatus } from '@core/services/autentication/auth/account-lifecycle.policy';

export const REGISTRATION_COMPLETION_ROUTE = '/preferencias/editar';
export const PROFILE_COMPLETED_NAVIGATION_INFO = 'profile-completed';

export function resolveRegistrationReturnUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (!/^\/(?![\/\\])/.test(value) || /[\\\x00-\x1f\x7f]/.test(value)) return null;

  const path = value.split(/[?#]/)[0];
  const excluded = ['/login', '/register', '/adulto/verificar-idade', '/adulto/confirmar',
    '/post-verification/action', '/__/auth/action'];
  return excluded.some(route => path === route || path.startsWith(route + '/') || path.startsWith(route + ';'))
    ? null : value;
}

export type RegisterFlowStep =
  | 'accountStatus'
  | 'loading'
  | 'signup'
  | 'emailVerification'
  | 'passwordSetup'
  | 'accountRecovery'
  | 'termsAcceptance'
  | 'ageVerification'
  | 'profileCompletion'
  | 'preferences';

export function usesRegistrationPresentation(url: string): boolean {
  const path = url.trim().split(/[?#]/)[0].replace(/\/$/, '');
  return path === '/register' ||
    path === '/register/enviar-link' ||
    path === '/register/aceitar-termos' ||
    path === '/adulto/verificar-idade' ||
    path === '/register/finalizar-cadastro' ||
    isRegistrationEmailLinkStep(path);
}

export function isRegistrationEmailLinkStep(url: string): boolean {
  const path = url.split(/[?#]/)[0].replace(/\/$/, '');
  return path === '/register/continuar-por-email' || path === '/register/definir-senha';
}

export function isRegistrationStepRoute(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return path === '/register/welcome' ||
    path === '/register/definir-senha' ||
    path === '/register/recuperar-conta' ||
    path === '/register/aceitar-termos' ||
    path === '/adulto/verificar-idade' ||
    path === '/register/finalizar-cadastro';
}

export interface RegisterFlowVm {
  authReady: boolean;
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
  userResolved: boolean;
  userExists: boolean;
  termsAccepted: boolean;
  ageEligibilityAllowed: boolean;
  profileCompleted: boolean;
  accountStatus?: RuntimeAccountLifecycleStatus;
  currentStep: RegisterFlowStep;
  nextRoute: string;
  progress: number;
  canContinue: boolean;
  primaryActionLabel: string;
  secondaryActionLabel?: string;
  blockingMessage?: string;
}

export interface RegisterFlowAccessState {
  passwordRequired?: boolean;
  authReady: boolean;
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
  userResolved: boolean;
  userExists: boolean;
  termsAccepted: boolean;
  ageEligibilityAllowed: boolean;
  profileCompleted: boolean;
  accountStatus?: RuntimeAccountLifecycleStatus;
}

export function isRegistrationRestricted(status: RuntimeAccountLifecycleStatus | undefined): boolean {
  return !!status && status !== 'unknown' && status !== 'active' && status !== 'registration_pending';
}

export function isRegisterFlowDecisionReady(vm: RegisterFlowVm): boolean {
  return vm.authReady && vm.currentStep !== 'loading';
}
