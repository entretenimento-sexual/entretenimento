// src/app/core/services/autentication/register/register.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { FirebaseError } from 'firebase/app';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    confirmsAdult: true,
    ...overrides,
  } as IUserRegistrationData;
}

describe('RegisterService', () => {
  let service: RegisterService;
  let authMock: {
    currentUser: null | {
      uid: string;
      delete: ReturnType<typeof vi.fn>;
      email?: string;
    };
  };
  let checkIfNicknameExists: ReturnType<typeof vi.fn>;
  let hasDiagnosticOwnership: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let reserve: ReturnType<typeof vi.fn>;
  let sendEmail: ReturnType<typeof vi.fn>;
  let acceptTerms: ReturnType<typeof vi.fn>;
  let createFirebaseUser: ReturnType<typeof vi.fn>;
  let updateDisplayName: ReturnType<typeof vi.fn>;

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
    reserve = vi.fn(() => of(void 0));
    sendEmail = vi.fn(() => of(void 0));
    acceptTerms = vi.fn(() => of({ signupAdultDeclarationRecorded: true }));
    createFirebaseUser = vi.fn();
    updateDisplayName = vi.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        RegisterService,
        {
          provide: EmailVerificationService,
          useValue: {
            sendEmailVerification: sendEmail,
          },
        },
        {
          provide: RegistrationBootstrapService,
          useValue: {
            createEmailPasswordSeed$: reserve,
            hasDiagnosticOwnership,
          },
        },
        {
          provide: TermsAcceptanceService,
          useValue: {
            acceptForUser$: acceptTerms,
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
    Object.assign(service, { createFirebaseUser, updateDisplayName });
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

  it('rejeita inscrição diretamente no serviço sem declaração 18+', async () => {
    const data = buildRegistrationData({ confirmsAdult: false });
    await expect(firstValueFrom(service.registerUser(data, 'senha-segura')))
      .rejects.toThrow('exclusiva para maiores de 18 anos');
    expect(report).toHaveBeenCalledTimes(1);
    expect(checkIfNicknameExists).not.toHaveBeenCalled();
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

  afterEach(() => vi.useRealTimers());

  function createUser() {
    const user = { uid: 'uid-test', email: 'pessoa@example.com', delete: vi.fn() };
    createFirebaseUser.mockImplementation(async () => {
      authMock.currentUser = user;
      return { user } as never;
    });
    return user;
  }

  it('repete somente a reserva idempotente após perda de resposta', async () => {
    vi.useFakeTimers();
    const user = createUser();
    reserve.mockReturnValueOnce(throwError(() => ({ code: 'functions/unavailable' })));
    const result = firstValueFrom(service.registerUser(buildRegistrationData(), 'senha-segura'));
    await vi.advanceTimersByTimeAsync(500);

    expect(await result).toMatchObject({ verificationEmailSent: true, registrationWarnings: [] });
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(createFirebaseUser).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith(user);
    expect(user.delete).not.toHaveBeenCalled();
  });

  it('conserva a credencial e prossegue para o e-mail mesmo quando o apelido é recusado', async () => {
    const user = createUser();
    reserve.mockReturnValueOnce(throwError(() => ({ code: 'functions/already-exists' })));

    expect(await firstValueFrom(service.registerUser(buildRegistrationData(), 'senha-segura'))).toMatchObject({
      user,
      verificationEmailSent: true,
      registrationWarnings: ['nickname-reservation-unconfirmed'],
    });
    expect(reserve).toHaveBeenCalledOnce();
    expect(acceptTerms).toHaveBeenCalledWith(user.uid, { signupAdultDeclaration: true });
    expect(updateDisplayName).not.toHaveBeenCalled();
    expect(user.delete).not.toHaveBeenCalled();
  });

  it('confirma termos e declaração numa única tentativa adicional sem recriar a conta', async () => {
    vi.useFakeTimers();
    const user = createUser();
    acceptTerms.mockReturnValueOnce(throwError(() => ({ code: 'functions/unavailable' })));
    const result = firstValueFrom(service.registerUser(buildRegistrationData(), 'senha-segura'));
    await vi.advanceTimersByTimeAsync(500);

    expect(await result).toMatchObject({ verificationEmailSent: true, registrationWarnings: [] });
    expect(acceptTerms.mock.calls).toEqual([
      [user.uid, { signupAdultDeclaration: true }],
      [user.uid, { signupAdultDeclaration: true }],
    ]);
    expect(createFirebaseUser).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('prossegue para o e-mail e sinaliza só a declaração quando o servidor confirma apenas os termos', async () => {
    createUser();
    acceptTerms.mockReturnValueOnce(of({}));

    expect(await firstValueFrom(service.registerUser(buildRegistrationData(), 'senha-segura')))
      .toMatchObject({
        verificationEmailSent: true,
        registrationWarnings: ['adult-declaration-unconfirmed'],
      });
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('bloqueia nova criação enquanto o SDK ainda pode concluir a primeira tentativa', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const user = { uid: 'late', delete: vi.fn() };
    createFirebaseUser.mockImplementation(() => new Promise((resolve) => {
      finish = () => {
        authMock.currentUser = user;
        resolve({ user } as never);
      };
    }));
    const start = () => firstValueFrom(service.registerUser(buildRegistrationData(), 'senha-segura'));
    const pending = expect(start()).rejects.toMatchObject({ code: 'registration-creation-unconfirmed' });
    await vi.advanceTimersByTimeAsync(12_000);
    await pending;

    await expect(start()).rejects.toMatchObject({ code: 'registration-creation-unconfirmed' });
    finish();
    await vi.advanceTimersByTimeAsync(0);
    await expect(start()).rejects.toMatchObject({ code: 'registration-session-active' });
    expect(createFirebaseUser).toHaveBeenCalledOnce();
    expect(user.delete).not.toHaveBeenCalled();
  });

  it('descarta a resposta da reserva quando a sessão muda antes dos termos e do envio', async () => {
    createUser();
    const pending = new Subject<void>();
    reserve.mockReturnValueOnce(pending);
    const result = expect(firstValueFrom(service.registerUser(buildRegistrationData(), 'senha-segura')))
      .rejects.toMatchObject({ code: 'registration-account-created' });
    await vi.waitFor(() => expect(reserve).toHaveBeenCalledOnce());
    authMock.currentUser = { uid: 'other', delete: vi.fn() };
    pending.next();

    await result;
    expect(acceptTerms).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
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
