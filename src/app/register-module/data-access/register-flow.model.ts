// src/app/register-module/data-access/register-flow.model.ts

export type RegisterFlowStep =
  | 'loading'
  | 'signup'
  | 'emailVerification'
  | 'accountRecovery'
  | 'termsAcceptance'
  | 'ageVerification'
  | 'profileCompletion'
  | 'preferences';

export function isRegistrationStepRoute(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return path === '/register/welcome' ||
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
  currentStep: RegisterFlowStep;
  nextRoute: string;
  progress: number;
  canContinue: boolean;
  primaryActionLabel: string;
  secondaryActionLabel?: string;
  blockingMessage?: string;
}

export interface RegisterFlowAccessState {
  authReady: boolean;
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
  userResolved: boolean;
  userExists: boolean;
  termsAccepted: boolean;
  ageEligibilityAllowed: boolean;
  profileCompleted: boolean;
}
