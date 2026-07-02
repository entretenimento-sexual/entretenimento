// src/app/register-module/data-access/register-flow.model.ts

export type RegisterFlowStep =
  | 'loading'
  | 'signup'
  | 'emailVerification'
  | 'profileCompletion'
  | 'adultConsent'
  | 'preferences'
  | 'done';

export interface RegisterFlowVm {
  authReady: boolean;
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
  userResolved: boolean;
  profileCompleted: boolean;
  adultConsentAccepted: boolean;
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
  profileCompleted: boolean;
  adultConsentAccepted: boolean;
}
