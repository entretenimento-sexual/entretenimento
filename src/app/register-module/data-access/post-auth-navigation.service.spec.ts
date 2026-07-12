import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import type { AuthFacadeSocialAuthResult } from 'src/app/core/services/autentication/auth/auth.facade';
import type { LoginResult } from 'src/app/core/services/autentication/login.service';

import { PostAuthNavigationService } from './post-auth-navigation.service';
import type { RegisterFlowVm } from './register-flow.model';

function vm(
  currentStep: RegisterFlowVm['currentStep'],
  nextRoute: string,
  overrides: Partial<RegisterFlowVm> = {}
): RegisterFlowVm {
  return {
    authReady: true,
    uid: 'u1',
    email: 'teste@email.com',
    emailVerified: true,
    userResolved: true,
    userExists: true,
    termsAccepted: true,
    profileCompleted: false,
    adultConsentAccepted: false,
    currentStep,
    nextRoute,
    progress: 50,
    canContinue: true,
    primaryActionLabel: 'Continuar',
    ...overrides,
  };
}

function user(overrides: Partial<IUserDados> = {}): IUserDados {
  return {
    uid: 'u1',
    email: 'teste@email.com',
    photoURL: null,
    role: 'free',
    lastLogin: Date.now(),
    isSubscriber: false,
    descricao: '',
    profileCompleted: false,
    acceptedTerms: {
      accepted: true,
      date: Date.now(),
      version: 'v1',
    },
    ...overrides,
  } as IUserDados;
}

describe('PostAuthNavigationService', () => {
  it('deve direcionar login por e-mail para recuperação antes das demais etapas', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('accountRecovery', '/register/recuperar-conta', {
        userExists: false,
        termsAccepted: false,
      })
    );
    const service = new PostAuthNavigationService({ vm$: flow$ } as any);
    const result: LoginResult = {
      success: true,
      emailVerified: true,
      user: user(),
      profileResolution: 'resolved',
      needsProfileCompletion: true,
    };

    await expect(
      firstValueFrom(
        service.resolveAfterEmailLogin$(result, '/dashboard/principal')
      )
    ).resolves.toBe(
      '/register/recuperar-conta?redirectTo=%2Fdashboard%2Fprincipal'
    );
  });

  it('deve abrir recuperação imediatamente quando o perfil do login por e-mail não foi resolvido', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('loading', '/register', {
        userResolved: false,
        userExists: false,
      })
    );
    const service = new PostAuthNavigationService({ vm$: flow$ } as any);
    const result: LoginResult = {
      success: true,
      emailVerified: true,
      user: user({ profileCompleted: undefined }),
      profileResolution: 'unknown',
      needsProfileCompletion: undefined,
    };

    await expect(
      firstValueFrom(service.resolveAfterEmailLogin$(result, '/friends'))
    ).resolves.toBe(
      '/register/recuperar-conta?redirectTo=%2Ffriends'
    );
  });

  it('deve direcionar login por e-mail para termos antes do perfil', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('termsAcceptance', '/register/aceitar-termos', {
        termsAccepted: false,
      })
    );
    const service = new PostAuthNavigationService({ vm$: flow$ } as any);

    const result: LoginResult = {
      success: true,
      emailVerified: true,
      user: user({
        acceptedTerms: { accepted: false, date: Date.now() },
      }),
      profileResolution: 'resolved',
      needsProfileCompletion: true,
    };

    await expect(
      firstValueFrom(service.resolveAfterEmailLogin$(result, '/friends'))
    ).resolves.toBe('/register/aceitar-termos?redirectTo=%2Ffriends');
  });

  it('deve preservar redirectTo na conclusão do perfil', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('profileCompletion', '/register/finalizar-cadastro')
    );
    const service = new PostAuthNavigationService({ vm$: flow$ } as any);

    const result: LoginResult = {
      success: true,
      emailVerified: true,
      user: user(),
      profileResolution: 'resolved',
      needsProfileCompletion: true,
    };

    await expect(
      firstValueFrom(service.resolveAfterEmailLogin$(result, '/friends'))
    ).resolves.toBe(
      '/register/finalizar-cadastro?reason=profile_incomplete&redirectTo=%2Ffriends'
    );
  });

  it('deve usar a máquina de estados também no login Google', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('adultConsent', '/adulto/confirmar', {
        profileCompleted: true,
      })
    );
    const service = new PostAuthNavigationService({ vm$: flow$ } as any);

    const result: AuthFacadeSocialAuthResult = {
      success: true,
      outcome: 'profile-ready',
      isNewUser: false,
      emailVerified: true,
      user: user({ profileCompleted: true }),
      nextRoute: '/dashboard/principal',
    };

    await expect(
      firstValueFrom(service.resolveAfterSocialLogin$(result, '/friends'))
    ).resolves.toBe('/adulto/confirmar?redirectTo=%2Ffriends');
  });

  it('deve priorizar a recuperação quando o Google autenticou e o perfil falhou', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('termsAcceptance', '/register/aceitar-termos', {
        termsAccepted: false,
      })
    );
    const service = new PostAuthNavigationService({ vm$: flow$ } as any);

    const result: AuthFacadeSocialAuthResult = {
      success: true,
      outcome: 'profile-incomplete',
      isNewUser: false,
      emailVerified: true,
      user: user({
        acceptedTerms: { accepted: false, date: Date.now() },
      }),
      nextRoute: '/register/recuperar-conta',
      code: 'social-auth/session-recovery-required',
    };

    await expect(
      firstValueFrom(service.resolveAfterSocialLogin$(result, '/friends'))
    ).resolves.toBe(
      '/register/recuperar-conta?redirectTo=%2Ffriends'
    );
  });

  it('deve liberar o destino original após todas as etapas', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('preferences', '/preferencias/editar/u1', {
        profileCompleted: true,
        adultConsentAccepted: true,
      })
    );
    const service = new PostAuthNavigationService({ vm$: flow$ } as any);

    const result: LoginResult = {
      success: true,
      emailVerified: true,
      user: user({ profileCompleted: true }),
      profileResolution: 'resolved',
      needsProfileCompletion: false,
    };

    await expect(
      firstValueFrom(service.resolveAfterEmailLogin$(result, '/friends'))
    ).resolves.toBe('/friends');
  });
});
