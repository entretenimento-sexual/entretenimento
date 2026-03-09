// src/app/core/services/autentication/social-auth.service.spec.ts
// =============================================================================
// TESTES DO SOCIAL AUTH SERVICE
//
// Objetivo desta suíte:
// - validar a criação do service
// - validar fluxo de novo usuário via Google
// - validar fluxo de usuário existente
// - validar bloqueios por conta deletada/suspensa
// - validar tratamento de erro do popup
//
// Observações:
// - usamos spy em método interno para evitar acoplamento com signInWithPopup real
// - mantemos Jasmine
// - usamos mocks mínimos, focados apenas nos métodos necessários
// =============================================================================

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Auth } from '@angular/fire/auth';

import { SocialAuthService } from './social-auth.service';
import { FirestoreReadService } from '../data-handling/firestore/core/firestore-read.service';
import { FirestoreWriteService } from '../data-handling/firestore/core/firestore-write.service';
import { UserRepositoryService } from '../data-handling/firestore/repositories/user-repository.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';

describe('SocialAuthService', () => {
  let service: SocialAuthService;

  let authMock: Partial<Auth>;

  let readMock: {
    getDocument: jasmine.Spy;
  };

  let writeMock: {
    setDocument: jasmine.Spy;
    updateDocument: jasmine.Spy;
  };

  let userRepoMock: {
    updateUserInStateAndCache: jasmine.Spy;
  };

  let globalErrorHandlerMock: {
    handleError: jasmine.Spy;
  };

  let errorNotifierMock: {
    showError: jasmine.Spy;
  };

  let routerMock: {
    navigate: jasmine.Spy;
  };

  beforeEach(() => {
    authMock = {} as Partial<Auth>;

    readMock = {
      getDocument: jasmine.createSpy('getDocument'),
    };

    writeMock = {
      setDocument: jasmine.createSpy('setDocument'),
      updateDocument: jasmine.createSpy('updateDocument'),
    };

    userRepoMock = {
      updateUserInStateAndCache: jasmine.createSpy('updateUserInStateAndCache'),
    };

    globalErrorHandlerMock = {
      handleError: jasmine.createSpy('handleError'),
    };

    errorNotifierMock = {
      showError: jasmine.createSpy('showError'),
    };

    routerMock = {
      navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)),
    };

    TestBed.configureTestingModule({
      providers: [
        SocialAuthService,
        { provide: Auth, useValue: authMock },
        { provide: FirestoreReadService, useValue: readMock },
        { provide: FirestoreWriteService, useValue: writeMock },
        { provide: UserRepositoryService, useValue: userRepoMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorHandlerMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: Router, useValue: routerMock },
      ],
    });

    service = TestBed.inject(SocialAuthService);
  });

  // ---------------------------------------------------------------------------
  // Helpers de teste
  // ---------------------------------------------------------------------------

  function makeFirebaseUser(overrides: Partial<any> = {}): any {
    return {
      uid: 'uid-123',
      email: 'user@test.com',
      emailVerified: true,
      photoURL: 'https://cdn.test/avatar.jpg',
      displayName: 'Usuário Google',
      ...overrides,
    };
  }

  function makeExistingUserDoc(overrides: Partial<any> = {}): any {
    return {
      uid: 'uid-123',
      email: 'user@test.com',
      nickname: 'alex',
      photoURL: 'https://cdn.test/avatar.jpg',
      role: 'basic',
      emailVerified: true,
      isSubscriber: false,
      firstLogin: 1700000000000,
      lastLogin: 1700000000000,
      acceptedTerms: { accepted: true, date: 1700000000000 },
      profileCompleted: true,
      suspended: false,
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // Testes básicos
  // ---------------------------------------------------------------------------

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('deve criar novo usuário via Google e navegar para finalizar cadastro', () => {
    const firebaseUser = makeFirebaseUser({
      uid: 'new-user-1',
      email: 'new-user@test.com',
      emailVerified: true,
      photoURL: 'https://cdn.test/new-user.jpg',
    });

    spyOn<any>(service, 'signInWithPopupInCtx$').and.returnValue(
      of({ user: firebaseUser })
    );

    readMock.getDocument.and.returnValue(of(null));
    writeMock.setDocument.and.returnValue(of(void 0));

    let result: any = null;

    service.googleLogin().subscribe((value) => {
      result = value;
    });

    expect(readMock.getDocument).toHaveBeenCalledWith('users', 'new-user-1', {
      source: 'server',
    });

    expect(writeMock.setDocument).toHaveBeenCalledWith(
      'users',
      'new-user-1',
      jasmine.objectContaining({
        uid: 'new-user-1',
        email: 'new-user@test.com',
        role: 'basic',
        emailVerified: true,
        profileCompleted: false,
      }),
      jasmine.objectContaining({
        merge: true,
        context: 'SocialAuthService.onNewUserLogin',
      })
    );

    expect(userRepoMock.updateUserInStateAndCache).toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/register/finalizar-cadastro']);

    expect(result).toEqual(
      jasmine.objectContaining({
        uid: 'new-user-1',
        email: 'new-user@test.com',
        role: 'basic',
        emailVerified: true,
      })
    );
  });

  it('deve atualizar usuário existente e navegar para finalizar cadastro quando perfil estiver incompleto', () => {
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
      role: 'basic',
    });

    spyOn<any>(service, 'signInWithPopupInCtx$').and.returnValue(
      of({ user: firebaseUser })
    );

    readMock.getDocument.and.returnValue(of(existingDoc));
    writeMock.updateDocument.and.returnValue(of(void 0));

    let result: any = null;

    service.googleLogin().subscribe((value) => {
      result = value;
    });

    expect(writeMock.updateDocument).toHaveBeenCalledWith(
      'users',
      'existing-incomplete',
      jasmine.objectContaining({
        emailVerified: true,
        photoURL: 'https://cdn.test/existing-incomplete.jpg',
        role: 'basic',
        tier: 'basic',
      }),
      jasmine.objectContaining({
        context: 'SocialAuthService.onExistingUserLogin',
      })
    );

    expect(userRepoMock.updateUserInStateAndCache).toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/register/finalizar-cadastro']);

    expect(result).toEqual(
      jasmine.objectContaining({
        uid: 'existing-incomplete',
        email: 'existing-incomplete@test.com',
        role: 'basic',
      })
    );
  });

  it('deve atualizar usuário existente e navegar para dashboard quando perfil estiver completo', () => {
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

    spyOn<any>(service, 'signInWithPopupInCtx$').and.returnValue(
      of({ user: firebaseUser })
    );

    readMock.getDocument.and.returnValue(of(existingDoc));
    writeMock.updateDocument.and.returnValue(of(void 0));

    let result: any = null;

    service.googleLogin().subscribe((value) => {
      result = value;
    });

    expect(writeMock.updateDocument).toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard/principal']);

    expect(result).toEqual(
      jasmine.objectContaining({
        uid: 'existing-complete',
        email: 'existing-complete@test.com',
        role: 'premium',
      })
    );
  });

  it('deve tratar conta deletada e redirecionar para login', () => {
    const firebaseUser = makeFirebaseUser({
      uid: 'deleted-user',
      email: 'deleted@test.com',
    });

    const existingDoc = makeExistingUserDoc({
      uid: 'deleted-user',
      email: 'deleted@test.com',
      accountStatus: 'deleted',
    });

    spyOn<any>(service, 'signInWithPopupInCtx$').and.returnValue(
      of({ user: firebaseUser })
    );

    readMock.getDocument.and.returnValue(of(existingDoc));

    let result: any = null;

    service.googleLogin().subscribe((value) => {
      result = value;
    });

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Conta indisponível. Entre em contato com o suporte.'
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
    expect(writeMock.updateDocument).not.toHaveBeenCalled();

    expect(result).toEqual(
      jasmine.objectContaining({
        uid: 'deleted-user',
      })
    );
  });

  it('deve tratar conta suspensa e redirecionar para login', () => {
    const firebaseUser = makeFirebaseUser({
      uid: 'suspended-user',
      email: 'suspended@test.com',
    });

    const existingDoc = makeExistingUserDoc({
      uid: 'suspended-user',
      email: 'suspended@test.com',
      accountStatus: 'suspended',
    });

    spyOn<any>(service, 'signInWithPopupInCtx$').and.returnValue(
      of({ user: firebaseUser })
    );

    readMock.getDocument.and.returnValue(of(existingDoc));

    let result: any = null;

    service.googleLogin().subscribe((value) => {
      result = value;
    });

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Sua conta está temporariamente restrita.'
    );
    expect(routerMock.navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
    expect(writeMock.updateDocument).not.toHaveBeenCalled();

    expect(result).toEqual(
      jasmine.objectContaining({
        uid: 'suspended-user',
      })
    );
  });

  it('deve retornar null e notificar quando o popup for bloqueado', () => {
    spyOn<any>(service, 'signInWithPopupInCtx$').and.returnValue(
      throwError(() => ({ code: 'auth/popup-blocked' }))
    );

    let result: any = 'not-null';

    service.googleLogin().subscribe((value) => {
      result = value;
    });

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'O navegador bloqueou o popup. Permita popups e tente novamente.'
    );
    expect(globalErrorHandlerMock.handleError).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('deve retornar null quando o usuário fechar o popup', () => {
    spyOn<any>(service, 'signInWithPopupInCtx$').and.returnValue(
      throwError(() => ({ code: 'auth/popup-closed-by-user' }))
    );

    let result: any = 'not-null';

    service.googleLogin().subscribe((value) => {
      result = value;
    });

    expect(globalErrorHandlerMock.handleError).toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
