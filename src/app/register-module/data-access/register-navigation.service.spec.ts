import { describe, expect, it } from 'vitest';
import { RegisterFlowAccessState } from './register-flow.model';
import { RegisterNavigationService } from './register-navigation.service';

describe('RegisterNavigationService / onboarding 18+ e Termos', () => {
  const service = new RegisterNavigationService();
  const ready: RegisterFlowAccessState = {
    authReady: true, uid: 'u1', email: 'user@example.com',
    emailVerified: true, userResolved: true, userExists: true,
    termsAccepted: true, ageEligibilityAllowed: true, profileCompleted: true,
  };
  it('pede e-mail antes de recuperar registro', () => {
    const vm = service.resolveVm({ ...ready, emailVerified: false, userExists: false });
    expect(vm.currentStep).toBe('emailVerification');
  });
  it('recupera documento privado ausente', () => {
    const vm = service.resolveVm({ ...ready, userExists: false });
    expect(vm.currentStep).toBe('accountRecovery');
  });
  it('exige termos antes de idade e perfil', () => {
    const vm = service.resolveVm({ ...ready, termsAccepted: false, profileCompleted: false });
    expect(vm.nextRoute).toBe('/register/aceitar-termos');
  });
  it('exige decisão canônica etária antes de finalizar perfil', () => {
    const vm = service.resolveVm({ ...ready, ageEligibilityAllowed: false, profileCompleted: false });
    expect(vm.currentStep).toBe('ageVerification');
    expect(vm.nextRoute).toBe('/adulto/verificar-idade');
  });
  it('avança ao perfil sem adultConsent v1, mesmo com marcador legado', () => {
    const state = { ...ready, profileCompleted: false,
      adultConsentAccepted: false, initialAdultConsentRequired: true } as RegisterFlowAccessState;
    const vm = service.resolveVm(state);
    expect(vm.currentStep).toBe('profileCompletion');
    expect(vm.nextRoute).toBe('/register/finalizar-cadastro');
  });
  it('conta completa sem consentimento adulto continua às preferências', () => {
    const state = { ...ready, adultConsentAccepted: false } as RegisterFlowAccessState;
    const vm = service.resolveVm(state);
    expect(vm.currentStep).toBe('preferences');
    expect(vm.nextRoute).toBe('/preferencias/editar/u1');
  });
});
