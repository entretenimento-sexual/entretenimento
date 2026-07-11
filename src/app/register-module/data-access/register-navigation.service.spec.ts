import { describe, expect, it } from 'vitest';

import { RegisterFlowAccessState } from './register-flow.model';
import { RegisterNavigationService } from './register-navigation.service';

describe('RegisterNavigationService', () => {
  const service = new RegisterNavigationService();

  const readyState: RegisterFlowAccessState = {
    authReady: true,
    uid: 'u1',
    email: 'user@example.com',
    emailVerified: true,
    userResolved: true,
    userExists: true,
    termsAccepted: true,
    profileCompleted: true,
    adultConsentAccepted: true,
  };

  it('deve priorizar verificação de e-mail antes da recuperação', () => {
    const vm = service.resolveVm({
      ...readyState,
      emailVerified: false,
      userExists: false,
    });

    expect(vm.currentStep).toBe('emailVerification');
    expect(vm.nextRoute).toBe('/register/welcome');
  });

  it('deve recuperar a conta quando Auth existe sem users/{uid}', () => {
    const vm = service.resolveVm({
      ...readyState,
      userExists: false,
    });

    expect(vm.currentStep).toBe('accountRecovery');
    expect(vm.nextRoute).toBe('/register/recuperar-conta');
  });

  it('deve exigir termos antes da conclusão do perfil', () => {
    const vm = service.resolveVm({
      ...readyState,
      termsAccepted: false,
      profileCompleted: false,
    });

    expect(vm.currentStep).toBe('termsAcceptance');
    expect(vm.nextRoute).toBe('/register/aceitar-termos');
  });

  it('deve concluir o perfil depois dos termos', () => {
    const vm = service.resolveVm({
      ...readyState,
      profileCompleted: false,
    });

    expect(vm.currentStep).toBe('profileCompletion');
    expect(vm.nextRoute).toBe('/register/finalizar-cadastro');
  });

  it('deve exigir consentimento adulto depois do perfil', () => {
    const vm = service.resolveVm({
      ...readyState,
      adultConsentAccepted: false,
    });

    expect(vm.currentStep).toBe('adultConsent');
    expect(vm.nextRoute).toBe('/adulto/confirmar');
  });

  it('deve finalizar em preferências quando todas as etapas estiverem concluídas', () => {
    const vm = service.resolveVm(readyState);

    expect(vm.currentStep).toBe('preferences');
    expect(vm.nextRoute).toBe('/preferencias/editar/u1');
  });
});
