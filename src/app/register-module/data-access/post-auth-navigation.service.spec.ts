import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import type { AuthFacadeSocialAuthResult } from 'src/app/core/services/autentication/auth/auth.facade';
import type { LoginResult } from 'src/app/core/services/autentication/login.service';

import { PostAuthNavigationService, REGISTER_FLOW_WAIT_MS } from './post-auth-navigation.service';
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
    ageEligibilityAllowed: true,
    profileCompleted: false,
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

function navigation(
  flow$: BehaviorSubject<RegisterFlowVm>,
  session = { currentAuthUser: { uid: 'u1' }, isTerminatingSnapshot: false }
): PostAuthNavigationService {
  return new PostAuthNavigationService({ vm$: flow$ } as never, Object.assign(session, { uid$: new BehaviorSubject(session.currentAuthUser.uid) }) as never);
}

describe('PostAuthNavigationService', () => {
  it('deve direcionar login por e-mail para recuperação antes das demais etapas', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('accountRecovery', '/register/recuperar-conta', {
        userExists: false,
        termsAccepted: false,
      })
    );
    const service = navigation(flow$);
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

  it('usa o mesmo destino de nova tentativa para e-mail, Google e sessão restaurada enquanto o perfil não resolve', async () => {
    vi.useFakeTimers();
    try {
      const service = navigation(new BehaviorSubject(vm('loading', '/register', {
        userResolved: false, userExists: false,
      })));
      const result = user({ profileCompleted: false });
      const attempts = [
        service.resolveAfterEmailLogin$({ success: true, user: result, profileResolution: 'unknown' }, '/friends'),
        service.resolveAfterSocialLogin$({ success: true, user: result, nextRoute: '/register/finalizar-cadastro' } as AuthFacadeSocialAuthResult, '/friends'),
        service.resolveForCurrentSession$('u1', '/friends'),
      ].map((attempt) => firstValueFrom(attempt));
      await vi.advanceTimersByTimeAsync(REGISTER_FLOW_WAIT_MS);
      const retry = '/login?reason=auth_unavailable&retomarCadastro=1&redirectTo=%2Ffriends';
      expect(await Promise.all(attempts)).toEqual([retry, retry, retry]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deve direcionar login por e-mail para termos antes do perfil', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('termsAcceptance', '/register/aceitar-termos', {
        termsAccepted: false,
      })
    );
    const service = navigation(flow$);

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
    const service = navigation(flow$);

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

  it('separa a retomada sem destino explícito do destino padrão de login', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('termsAcceptance', '/register/aceitar-termos')
    );
    const service = navigation(flow$);
    const result: LoginResult = {
      success: true,
      emailVerified: true,
      user: user(),
      profileResolution: 'resolved',
      needsProfileCompletion: true,
    };

    await expect(firstValueFrom(service.resolveAfterEmailLogin$(result, null)))
      .resolves.toBe('/register/aceitar-termos');
    flow$.next(vm('profileCompletion', '/register/finalizar-cadastro'));
    await expect(firstValueFrom(service.resolveAfterEmailLogin$(result, null)))
      .resolves.toBe('/register/finalizar-cadastro?reason=profile_incomplete&redirectTo=%2Fpreferencias%2Feditar');
    flow$.next(vm('preferences', '/preferencias/editar', { profileCompleted: true }));
    await expect(firstValueFrom(service.resolveAfterEmailLogin$(result, null)))
      .resolves.toBe('/dashboard/principal');
  });

  it('login Google de perfil completo não exige consentimento legado', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('preferences', '/preferencias/editar/u1', {
        profileCompleted: true,
      })
    );
    const service = navigation(flow$);

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
    ).resolves.toBe('/friends');
  });

  it('prioriza a etapa canônica se a leitura secundária do Google falhar', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('termsAcceptance', '/register/aceitar-termos', {
        termsAccepted: false,
      })
    );
    const service = navigation(flow$);

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
      '/register/aceitar-termos?redirectTo=%2Ffriends'
    );
  });

  it('deve liberar o destino original após todas as etapas', async () => {
    const flow$ = new BehaviorSubject<RegisterFlowVm>(
      vm('preferences', '/preferencias/editar/u1', {
        profileCompleted: true,
      })
    );
    const service = navigation(flow$);

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
  it('respeita a etapa de idade e descarta o VM da conta anterior', async () => {
    const flow$ = new BehaviorSubject(
      vm('preferences', '/preferencias/editar/outro', { uid: 'outro' })
    );
    const service = navigation(flow$);
    const resolution = firstValueFrom(service.resolveAfterEmailLogin$({
      success: true,
      emailVerified: true,
      profileResolution: 'resolved',
      user: user(),
    }, '/friends'));

    flow$.next(vm('ageVerification', '/adulto/verificar-idade'));
    await expect(resolution).resolves.toBe('/adulto/verificar-idade?redirectTo=%2Ffriends');
  });

  it('cancela a consulta em andamento assim que a conta ativa muda', async () => {
    const flow$ = new BehaviorSubject(vm('loading', '/register', { userResolved: false }));
    const session = { currentAuthUser: { uid: 'u1' }, isTerminatingSnapshot: false };
    const service = navigation(flow$, session);
    const resolution = firstValueFrom(service.resolveAfterEmailLogin$({
      success: true,
      emailVerified: true,
      profileResolution: 'resolved',
      user: user(),
    }, '/friends'));

    const observed = expect(resolution).rejects.toMatchObject({ code: 'auth/session-changed' });
    session.currentAuthUser = { uid: 'u2' };
    (session as typeof session & { uid$: BehaviorSubject<string> }).uid$.next('u2');
    await observed;
  });

});
