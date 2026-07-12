import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthFacade } from './auth.facade';
import { AuthSessionService } from './auth-session.service';
import { LogoutService } from './logout.service';
import { RegisterService } from '../register/register.service';
import { EmailVerificationService } from '../register/email-verification.service';
import { SocialAuthService } from '../social-auth.service';

describe('AuthFacade social auth recovery', () => {
  let facade: AuthFacade;
  let socialAuth: { googleLogin: ReturnType<typeof vi.fn> };
  let authSession: { currentAuthUser: any };

  beforeEach(() => {
    socialAuth = {
      googleLogin: vi.fn(),
    };

    authSession = {
      currentAuthUser: {
        uid: 'social-uid',
        email: 'social@example.com',
        emailVerified: true,
        photoURL: 'https://cdn.example.com/avatar.jpg',
      },
    };

    TestBed.configureTestingModule({
      providers: [
        AuthFacade,
        {
          provide: RegisterService,
          useValue: { registerUser: vi.fn() },
        },
        {
          provide: EmailVerificationService,
          useValue: {
            resendVerificationEmail: vi.fn(),
            handleEmailVerification: vi.fn(),
          },
        },
        {
          provide: LogoutService,
          useValue: {
            logout$: vi.fn(() => of(void 0)),
            logout: vi.fn(),
          },
        },
        {
          provide: SocialAuthService,
          useValue: socialAuth,
        },
        {
          provide: AuthSessionService,
          useValue: authSession,
        },
      ],
    });

    facade = TestBed.inject(AuthFacade);
  });

  it('encaminha para recuperação quando o Auth concluiu e o bootstrap do perfil falhou', async () => {
    socialAuth.googleLogin.mockReturnValue(
      of({
        success: false,
        outcome: 'error',
        isNewUser: false,
        emailVerified: false,
        user: null,
        nextRoute: null,
        code: 'social-auth/bootstrap-failed',
        message: 'Não foi possível preparar sua conta agora.',
      })
    );

    const result = await firstValueFrom(facade.googleLogin$());

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        outcome: 'profile-incomplete',
        emailVerified: true,
        nextRoute: '/register/recuperar-conta',
        code: 'social-auth/session-recovery-required',
      })
    );
    expect(result.user).toEqual(
      expect.objectContaining({
        uid: 'social-uid',
        email: 'social@example.com',
        profileCompleted: false,
      })
    );
  });

  it('preserva a falha quando não existe sessão autenticada para recuperar', async () => {
    authSession.currentAuthUser = null;
    socialAuth.googleLogin.mockReturnValue(
      of({
        success: false,
        outcome: 'error',
        isNewUser: false,
        emailVerified: false,
        user: null,
        nextRoute: null,
        code: 'social-auth/bootstrap-failed',
        message: 'Não foi possível preparar sua conta agora.',
      })
    );

    const result = await firstValueFrom(facade.googleLogin$());

    expect(result.success).toBe(false);
    expect(result.nextRoute).toBeNull();
    expect(result.code).toBe('social-auth/bootstrap-failed');
  });

  it('mantém o aceite de termos como etapa obrigatória em login social normal', async () => {
    socialAuth.googleLogin.mockReturnValue(
      of({
        success: true,
        outcome: 'profile-incomplete',
        isNewUser: true,
        emailVerified: true,
        user: {
          uid: 'social-uid',
          email: 'social@example.com',
          emailVerified: true,
          nickname: null,
          profileCompleted: false,
          acceptedTerms: { accepted: false, date: Date.now() },
        },
        nextRoute: '/register/finalizar-cadastro',
      })
    );

    const result = await firstValueFrom(facade.googleLogin$());

    expect(result.success).toBe(true);
    expect(result.nextRoute).toBe('/register/aceitar-termos');
  });
});
