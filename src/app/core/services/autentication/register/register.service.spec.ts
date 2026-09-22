// src/app/core/services/autentication/register/register.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom, of } from 'rxjs';
import { FirebaseError } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RegisterService } from './register.service';
import { EmailVerificationService } from './email-verification.service';
import { RegistrationBootstrapService } from './registration-bootstrap.service';
import { TermsAcceptanceService } from '../../compliance/terms-acceptance.service';
import { ApplicationErrorService } from '../../error-handler/application-error.service';
import { FirestoreValidationService } from '../../data-handling/firestore/validation/firestore-validation.service';
import { CacheService } from '../../general/cache/cache.service';
import type { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';

function buildRegistrationData(
  overrides: Partial<IUserRegistrationData> = {}
): IUserRegistrationData {
  return {
    email: 'pessoa@example.com',
    nickname: 'PessoaTeste',
    emailVerified: false,
    isSubscriber: false,
    firstLogin: Date.now(),
    acceptedTerms: {
      accepted: true,
      date: Date.now(),
    },
    ...overrides,
  } as IUserRegistrationData;
}

describe('RegisterService', () => {
  let service: RegisterService;
  let authMock: {
    currentUser: null | {
      uid: string;
      delete: ReturnType<typeof vi.fn>;
      getIdToken?: ReturnType<typeof vi.fn>;
    };
  };
  let checkIfNicknameExists: ReturnType<typeof vi.fn>;
  let hasDiagnosticOwnership: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    authMock = {
      currentUser: null,
    };
    checkIfNicknameExists = vi.fn(() => of(false));
    hasDiagnosticOwnership = vi.fn(() => false);
    report = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        RegisterService,
        {
          provide: EmailVerificationService,
          useValue: {
            sendEmailVerification: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: RegistrationBootstrapService,
          useValue: {
            createEmailPasswordSeed$: vi.fn(() => of(void 0)),
            hasDiagnosticOwnership,
          },
        },
        {
          provide: TermsAcceptanceService,
          useValue: {
            acceptForUser$: vi.fn(() =>
              of({
                uid: 'uid-test',
                record: {
                  accepted: true,
                  version: 'v1',
                  date: Date.now(),
                },
              })
            ),
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: {
            report,
          },
        },
        {
          provide: FirestoreValidationService,
          useValue: {
            validateUserData: vi.fn(() => true),
            checkIfNicknameExists,
          },
        },
        {
          provide: CacheService,
          useValue: {
            set: vi.fn(),
            get: vi.fn(() => of(null)),
          },
        },
        {
          provide: Auth,
          useValue: authMock,
        },
      ],
    });

    service = TestBed.inject(RegisterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('diagnostica validação uma única vez mesmo atravessando o catch externo', async () => {
    const data = buildRegistrationData({
      acceptedTerms: {
        accepted: false,
        date: Date.now(),
      },
    });

    await expect(
      firstValueFrom(service.registerUser(data, 'senha-segura'))
    ).rejects.toThrow(
      'Você precisa aceitar os Termos de Uso para continuar.'
    );

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Você precisa aceitar os Termos de Uso para continuar.',
      }),
      {
        feature: 'register',
        operation: 'handleRegisterError',
        fallbackMessage: '[RegisterService] Validação',
        presentation: { surface: 'none', severity: 'error' },
        metadata: expect.objectContaining({
          scope: 'RegisterService',
          operation: 'handleRegisterError',
          context: 'Validação',
          mappedMessage:
            'Você precisa aceitar os Termos de Uso para continuar.',
        }),
      }
    );
  });

  it('mantém compatibilidade email-exists-soft e marca o erro já diagnosticado', async () => {
    const original = new FirebaseError(
      'auth/email-already-in-use',
      'already exists'
    );

    let received: any = null;
    try {
      await firstValueFrom(
        (service as any).handleRegisterError(
          original,
          'Registro',
          'trace-test'
        )
      );
    } catch (error) {
      received = error;
    }

    expect(received).toBeInstanceOf(Error);
    expect(received.message).toBe(
      'Não foi possível criar uma nova conta com este e-mail. Tente entrar ou recuperar a senha.'
    );
    expect(received.code).toBe('email-exists-soft');
    expect(received.registerApplicationErrorReported).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('não rediagnostica erro já marcado pela fronteira de registro', async () => {
    const error = Object.assign(new Error('erro público'), {
      code: 'validation/test',
      registerApplicationErrorReported: true,
    });

    let received: unknown;
    try {
      await firstValueFrom(
        (service as any).handleRegisterError(
          error,
          'Registro',
          'trace-test'
        )
      );
    } catch (caught) {
      received = caught;
    }

    expect(received).toBe(error);
    expect(report).not.toHaveBeenCalled();
  });

  it('não rediagnostica falha já pertencente ao RegistrationBootstrapService', async () => {
    const original = new FirebaseError(
      'permission-denied',
      'firestore denied'
    );
    hasDiagnosticOwnership.mockImplementation(
      (error: unknown) => error === original
    );

    let received: any = null;
    try {
      await firstValueFrom(
        (service as any).handleRegisterError(
          original,
          'Registro',
          'trace-bootstrap'
        )
      );
    } catch (error) {
      received = error;
    }

    expect(hasDiagnosticOwnership).toHaveBeenCalledWith(original);
    expect(report).not.toHaveBeenCalled();
    expect(received).toBeInstanceOf(Error);
    expect(received.message).toBe(
      'Permissão negada ao salvar seus dados. Tente novamente.'
    );
    expect(received.code).toBe('permission-denied');
    expect(received.registerApplicationErrorReported).toBe(true);
  });

  it('reporta falha de rollback silenciosamente e preserva o erro público existente', async () => {
    const original = new Error('delete failed');
    const deleteUser = vi.fn(() => Promise.reject(original));
    authMock.currentUser = {
      uid: 'uid-test',
      delete: deleteUser,
    };

    await expect(
      firstValueFrom(service.deleteUserOnFailure('uid-test'))
    ).rejects.toThrow('Erro ao deletar usuário.');

    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(original, {
      feature: 'register',
      operation: 'deleteAuthUserOnFailure',
      fallbackMessage:
        '[RegisterService] Falha ao deletar usuário no rollback.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'RegisterService',
        operation: 'deleteAuthUserOnFailure',
        uid: 'uid-test',
      },
    });
  });

  it('não altera o erro público se a própria camada canônica falhar', async () => {
    report.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    const data = buildRegistrationData({
      nickname: 'abc',
    });

    await expect(
      firstValueFrom(service.registerUser(data, 'senha-segura'))
    ).rejects.toThrow('Apelido deve ter entre 4 e 24 caracteres.');

    expect(report).toHaveBeenCalledTimes(1);
  });
});
