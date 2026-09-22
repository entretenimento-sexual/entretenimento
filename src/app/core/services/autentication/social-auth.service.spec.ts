// src/app/core/services/autentication/social-auth.service.spec.ts
// =============================================================================
// TESTES DO SOCIAL AUTH SERVICE
//
// Objetivo desta suíte:
// - validar o contrato atual do login social;
// - garantir que o service devolve SocialAuthResult estruturado;
// - evitar acoplamento com navegação, toast ou cache manual;
// - cobrir criação inicial, usuário existente, bloqueios e erros de popup.
//
// Observação:
// - SocialAuthService não navega. A camada chamadora decide rota/feedback.
// =============================================================================

import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { EnvironmentInjector } from '@angular/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { SocialAuthService } from './social-auth.service';
import { FirestoreReadService } from '../data-handling/firestore/core/firestore-read.service';
import { FirestoreWriteService } from '../data-handling/firestore/core/firestore-write.service';
import { ApplicationErrorService } from '../error-handler/application-error.service';
import { RegistrationBootstrapService } from './register/registration-bootstrap.service';

describe('SocialAuthService', () => {
  let service: SocialAuthService;

  let authMock: Partial<Auth>;

  let readMock: {
    getDocument: Mock;
  };

  let writeMock: {
    updateDocument: Mock;
  };

  let registrationBootstrapMock: {
    createSocialSeed$: Mock;
    hasDiagnosticOwnership: Mock;
  };

  let applicationErrorMock: {
    report: Mock;
  };

  beforeEach(() => {
    authMock = {} as Partial<Auth>;

    readMock = {
      getDocument: vi.fn(),
    };

    writeMock = {
      updateDocument: vi.fn(),
    };

    registrationBootstrapMock = {
      createSocialSeed$: vi.fn(),
      hasDiagnosticOwnership: vi.fn(() => false),
    };

    applicationErrorMock = {
      report: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        SocialAuthService,
        { provide: Auth, useValue: authMock },
        { provide: FirestoreReadService, useValue: readMock },
        { provide: FirestoreWriteService, useValue: writeMock },
        { provide: RegistrationBootstrapService, useValue: registrationBootstrapMock },
        { provide: ApplicationErrorService, useValue: applicationErrorMock },
      ],
    });

    service = TestBed.inject(SocialAuthService);

    vi.spyOn(service as any, 'ensurePersistentAuth$').mockReturnValue(of(void 0));
  });

  function makeFirebaseUser(overrides: Partial<any> = {}): any {
    return {
      uid: 'uid-123',
      email: 'user@test.com',
      emailVerified: true,
      photoURL: 'https://cdn.test/avatar.jpg',
      providerData: [{ providerId: 'google.com' }],
      ...overrides,
    };
  }

  function makeExistingUserDoc(overrides: Partial<any> = {}): any {
    return {
      uid: 'uid-123',
      email: 'user@test.com',
      nickname: 'alex',
      photoURL: 'https://cdn.test/avatar.jpg',
      role: 'free',
      tier: 'free',
      emailVerified: true,
      isSubscriber: false,
      firstLogin: 1700000000000,
      lastLogin: 1700000000000,
      acceptedTerms: { accepted: true, date: 1700000000000 },
      profileCompleted: true,
      suspended: false,
      accountLocked: false,
      accountStatus: 'active',
      ...overrides,
    };
  }

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
    expect(TestBed.inject(EnvironmentInjector)).toBeTruthy();
  });

  it('deve criar seed de novo usuário Google e retornar resultado estruturado para finalizar cadastro', async () => {
    const firebaseUser = makeFirebaseUser({
      uid: 'new-user-1',
      email: 'new-user@test.com',
      emailVerified: true,
      photoURL: 'https://cdn.test/new-user.jpg',
    });

    vi.spyOn(service as any, 'signInWithPopupInCtx$').mockReturnValue(
      of({ user: firebaseUser } as any)
    );

    readMock.getDocument.mockReturnValue(of(null));
    registrationBootstrapMock.createSocialSeed$.mockReturnValue(of(void 0));

    const result = await firstValueFrom(service.googleLogin());

    expect(readMock.getDocument).toHaveBeenCalledWith('users', 'new-user-1', {
      source: 'server',
    });

    expect(registrationBootstrapMock.createSocialSeed$).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'new-user-1',
        email: 'new-user@test.com',
        emailVerified: true,
        photoURL: 'https://cdn.test/new-user.jpg',
        providerId: 'google.com',
      })
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        outcome: 'profile-incomplete',
        isNewUser: true,
        emailVerified: true,
        nextRoute: '/register/finalizar-cadastro',
        message: 'Conta criada com Google. Finalize seu cadastro para continuar.',
      })
    );
  });

  it('deve atualizar usuário existente e retornar finalizar cadastro quando perfil estiver incompleto', async () => {
    const firebaseUser = makeFirebaseUser({
      uid: 'existing-incomplete',
      email: 'existing-incomplete@test.com',
      emailVerified: true,
      photoURL: 'https://cdn.test/existing-incomplete.jpg',
    });

    const existingDoc = makeExistingUserDoc({
      uid: 'existing-incomplete',
      email: 'existing-incomplete@test.com',
      nickname: '',
      gender: undefined,
      profileCompleted: false,
    });

    vi.spyOn(service as any, 'signInWithPopupInCtx$').mockReturnValue(
      of({ user: firebaseUser } as any)
    );

    readMock.getDocument.mockReturnValue(of(existingDoc));
    writeMock.updateDocument.mockReturnValue(of(void 0));

    const result = await firstValueFrom(service.googleLogin());

    expect(writeMock.updateDocument).toHaveBeenCalledWith(
      'users',
      'existing-incomplete',
      expect.objectContaining({
        emailVerified: true,
        photoURL: 'https://cdn.test/existing-incomplete.jpg',
        lastProvider: 'google.com',
      }),
      expect.objectContaining({
        context: 'SocialAuthService.handleExistingUserLogin',
      })
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        outcome: 'profile-incomplete',
        isNewUser: false,
        emailVerified: true,
        nextRoute: '/register/finalizar-cadastro',
      })
    );
  });

  it('deve atualizar usuário existente e retornar dashboard quando perfil estiver completo', async () => {
    const firebaseUser = makeFirebaseUser({
      uid: 'existing-complete',
      email: 'existing-complete@test.com',
      emailVerified: true,
      photoURL: 'https://cdn.test/existing-complete.jpg',
    });

    const existingDoc = makeExistingUserDoc({
      uid: 'existing-complete',
      email: 'existing-complete@test.com',
      nickname: 'alex',
      gender: 'masculino',
      profileCompleted: true,
      role: 'premium',
      tier: 'premium',
    });

    vi.spyOn(service as any, 'signInWithPopupInCtx$').mockReturnValue(
      of({ user: firebaseUser } as any)
    );

    readMock.getDocument.mockReturnValue(of(existingDoc));
    writeMock.updateDocument.mockReturnValue(of(void 0));

    const result = await firstValueFrom(service.googleLogin());

    expect(writeMock.updateDocument).toHaveBeenCalled();

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        outcome: 'profile-ready',
        isNewUser: false,
        emailVerified: true,
        nextRoute: '/dashboard/principal',
      })
    );
  });

  it('deve retornar bloqueio para conta deletada sem atualizar documento', async () => {
    const firebaseUser = makeFirebaseUser({
      uid: 'deleted-user',
      email: 'deleted@test.com',
    });

    const existingDoc = makeExistingUserDoc({
      uid: 'deleted-user',
      email: 'deleted@test.com',
      accountStatus: 'deleted',
    });

    vi.spyOn(service as any, 'signInWithPopupInCtx$').mockReturnValue(
      of({ user: firebaseUser } as any)
    );

    readMock.getDocument.mockReturnValue(of(existingDoc));

    const result = await firstValueFrom(service.googleLogin());

    expect(writeMock.updateDocument).not.toHaveBeenCalled();

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        outcome: 'blocked',
        blockedReason: 'deleted',
        nextRoute: '/login',
        code: 'social-auth/deleted',
      })
    );
  });

  it('deve retornar status da conta para usuário suspenso', async () => {
    const firebaseUser = makeFirebaseUser({
      uid: 'suspended-user',
      email: 'suspended@test.com',
    });

    const existingDoc = makeExistingUserDoc({
      uid: 'suspended-user',
      email: 'suspended@test.com',
      accountStatus: 'suspended',
    });

    vi.spyOn(service as any, 'signInWithPopupInCtx$').mockReturnValue(
      of({ user: firebaseUser } as any)
    );

    readMock.getDocument.mockReturnValue(of(existingDoc));

    const result = await firstValueFrom(service.googleLogin());

    expect(writeMock.updateDocument).not.toHaveBeenCalled();

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        outcome: 'profile-ready',
        nextRoute: '/conta/status',
      })
    );
  });

  it('deve retornar erro estruturado quando popup for bloqueado', async () => {
    vi.spyOn(service as any, 'signInWithPopupInCtx$').mockReturnValue(
      throwError(() => ({ code: 'auth/popup-blocked' }))
    );

    const result = await firstValueFrom(service.googleLogin());

    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'auth/popup-blocked' }),
      {
        feature: 'social-auth',
        operation: 'googleLogin.popup',
        fallbackMessage:
          'Não foi possível concluir uma etapa interna da autenticação social.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'SocialAuthService',
          phase: 'googleLogin.popup',
          code: 'auth/popup-blocked',
          expected: false,
        },
      }
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        outcome: 'error',
        code: 'auth/popup-blocked',
        nextRoute: null,
      })
    );
  });

  it('deve retornar cancelamento estruturado quando usuário fechar o popup', async () => {
    vi.spyOn(service as any, 'signInWithPopupInCtx$').mockReturnValue(
      throwError(() => ({ code: 'auth/popup-closed-by-user' }))
    );

    const result = await firstValueFrom(service.googleLogin());

    expect(applicationErrorMock.report).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        outcome: 'cancelled',
        code: 'social-auth/cancelled',
        nextRoute: null,
      })
    );
  });

  it('deve diagnosticar silenciosamente falha de leitura no bootstrap pós-auth e manter resultado estruturado', async () => {
    const firebaseUser = makeFirebaseUser({
      uid: 'bootstrap-failed',
      email: 'bootstrap-failed@test.com',
    });
    const error = new Error('firestore unavailable');

    vi.spyOn(service as any, 'signInWithPopupInCtx$').mockReturnValue(
      of({ user: firebaseUser } as any)
    );

    readMock.getDocument.mockReturnValue(
      throwError(() => error)
    );

    const result = await firstValueFrom(service.googleLogin());

    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, {
      feature: 'social-auth',
      operation: 'bootstrapUserAfterAuth',
      fallbackMessage:
        'Não foi possível concluir uma etapa interna da autenticação social.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'SocialAuthService',
        phase: 'bootstrapUserAfterAuth',
        uid: 'bootstrap-failed',
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        outcome: 'error',
        code: 'social-auth/bootstrap-failed',
        message: 'Não foi possível preparar sua conta agora.',
        nextRoute: null,
      })
    );
  });

  it('não rediagnostica falha de criação social já pertencente ao RegistrationBootstrapService', async () => {
    const firebaseUser = makeFirebaseUser({
      uid: 'bootstrap-owned',
      email: 'bootstrap-owned@test.com',
    });
    const error = new Error('bootstrap write failed');

    vi.spyOn(service as any, 'signInWithPopupInCtx$').mockReturnValue(
      of({ user: firebaseUser } as any)
    );
    readMock.getDocument.mockReturnValue(of(null));
    registrationBootstrapMock.createSocialSeed$.mockReturnValue(
      throwError(() => error)
    );
    registrationBootstrapMock.hasDiagnosticOwnership.mockImplementation(
      (candidate: unknown) => candidate === error
    );

    const result = await firstValueFrom(service.googleLogin());

    expect(
      registrationBootstrapMock.hasDiagnosticOwnership
    ).toHaveBeenCalledWith(error);
    expect(applicationErrorMock.report).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        outcome: 'error',
        code: 'social-auth/new-user-write-failed',
        message:
          'Não foi possível concluir a criação da conta com Google.',
        nextRoute: null,
      })
    );
  });

  it('assume diagnóstico social quando a falha de criação não tem ownership do bootstrap', async () => {
    const firebaseUser = makeFirebaseUser({
      uid: 'bootstrap-unowned',
      email: 'bootstrap-unowned@test.com',
    });
    const error = new Error('bootstrap diagnostic unavailable');

    vi.spyOn(service as any, 'signInWithPopupInCtx$').mockReturnValue(
      of({ user: firebaseUser } as any)
    );
    readMock.getDocument.mockReturnValue(of(null));
    registrationBootstrapMock.createSocialSeed$.mockReturnValue(
      throwError(() => error)
    );

    const result = await firstValueFrom(service.googleLogin());

    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(applicationErrorMock.report).toHaveBeenCalledWith(error, {
      feature: 'social-auth',
      operation: 'handleNewUserLogin',
      fallbackMessage:
        'Não foi possível concluir uma etapa interna da autenticação social.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'SocialAuthService',
        phase: 'handleNewUserLogin',
        uid: 'bootstrap-unowned',
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        outcome: 'error',
        code: 'social-auth/new-user-write-failed',
        nextRoute: null,
      })
    );
  });

  it('deve manter o resultado público quando a própria camada canônica falhar', async () => {
    const error = { code: 'auth/popup-blocked' };

    vi.spyOn(service as any, 'signInWithPopupInCtx$').mockReturnValue(
      throwError(() => error)
    );
    applicationErrorMock.report.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    const result = await firstValueFrom(service.googleLogin());

    expect(applicationErrorMock.report).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        outcome: 'error',
        code: 'auth/popup-blocked',
        message:
          'O navegador bloqueou o popup do Google. Permita popups e tente novamente.',
        nextRoute: null,
      })
    );
  });

});
