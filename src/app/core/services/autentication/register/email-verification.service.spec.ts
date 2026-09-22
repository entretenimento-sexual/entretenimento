import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuthMocks = vi.hoisted(() => ({
  applyActionCode: vi.fn(),
  checkActionCode: vi.fn(),
  sendEmailVerification: vi.fn(),
}));

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();

  return {
    ...actual,
    applyActionCode: firebaseAuthMocks.applyActionCode,
    checkActionCode: firebaseAuthMocks.checkActionCode,
    sendEmailVerification: firebaseAuthMocks.sendEmailVerification,
  };
});

import { EmailVerificationService } from './email-verification.service';

describe('EmailVerificationService canonical errors', () => {
  let router: {
    url: string;
    parseUrl: ReturnType<typeof vi.fn>;
  };
  let authSession: {
    refreshCurrentUser$: ReturnType<typeof vi.fn>;
  };
  let currentUserStore: {
    patch: ReturnType<typeof vi.fn>;
  };
  let userWrite: {
    patchEmailVerified$: ReturnType<typeof vi.fn>;
    saveUserDataAfterEmailVerification$: ReturnType<typeof vi.fn>;
  };
  let applicationError: {
    report: ReturnType<typeof vi.fn>;
  };
  let auth: {
    currentUser: any;
    languageCode: string | null;
  };
  let service: EmailVerificationService;

  beforeEach(() => {
    vi.clearAllMocks();

    router = {
      url: '',
      parseUrl: vi.fn(() => ({ queryParams: {} })),
    };
    authSession = {
      refreshCurrentUser$: vi.fn(() => of(null)),
    };
    currentUserStore = {
      patch: vi.fn(),
    };
    userWrite = {
      patchEmailVerified$: vi.fn(() => of(void 0)),
      saveUserDataAfterEmailVerification$: vi.fn(() => of(void 0)),
    };
    applicationError = {
      report: vi.fn(),
    };
    auth = {
      currentUser: null,
      languageCode: null,
    };

    firebaseAuthMocks.applyActionCode.mockResolvedValue(undefined);
    firebaseAuthMocks.checkActionCode.mockResolvedValue({ data: {} });
    firebaseAuthMocks.sendEmailVerification.mockResolvedValue(undefined);

    service = new EmailVerificationService(
      router as any,
      authSession as any,
      currentUserStore as any,
      userWrite as any,
      applicationError as any,
      auth as any
    );
  });

  it('preserva erro público de sessão ausente no resend sem diagnóstico técnico', async () => {
    await expect(
      firstValueFrom(service.resendVerificationEmail())
    ).rejects.toThrow('Nenhum usuário autenticado encontrado.');

    expect(applicationError.report).not.toHaveBeenCalled();
    expect(firebaseAuthMocks.sendEmailVerification).not.toHaveBeenCalled();
  });

  it('mantém reloadCurrentUser silencioso e retorna false em falha', async () => {
    const original = new Error('refresh failed');
    authSession.refreshCurrentUser$.mockReturnValue(
      throwError(() => original)
    );

    await expect(firstValueFrom(service.reloadCurrentUser())).resolves.toBe(false);

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(original, {
      feature: 'email-verification',
      operation: 'reloadCurrentUser',
      fallbackMessage:
        'Não foi possível concluir uma etapa interna da verificação de e-mail.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'EmailVerificationService',
        operation: 'reloadCurrentUser',
      },
    });
  });

  it('não rediagnostica no resend uma falha já reportada por sendEmailVerification', async () => {
    const original = Object.assign(new Error('too many requests'), {
      code: 'auth/too-many-requests',
    });
    auth.currentUser = {
      uid: 'user-1',
      email: 'user@example.com',
    };
    firebaseAuthMocks.sendEmailVerification.mockRejectedValue(original);

    await expect(
      firstValueFrom(service.resendVerificationEmail('https://app.test/verify'))
    ).rejects.toThrow('Erro ao reenviar e-mail de verificação.');

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(original, {
      feature: 'email-verification',
      operation: 'sendEmailVerification',
      fallbackMessage:
        'Não foi possível concluir uma etapa interna da verificação de e-mail.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'EmailVerificationService',
        operation: 'sendEmailVerification',
      },
    });
  });

  it('diagnostica apenas a falha do fallback de envio quando o domínio primário é rejeitado', async () => {
    const primary = Object.assign(new Error('unauthorized domain'), {
      code: 'auth/unauthorized-domain',
    });
    const fallback = Object.assign(new Error('fallback failed'), {
      code: 'auth/network-request-failed',
    });
    auth.currentUser = {
      uid: 'user-1',
      email: 'user@example.com',
    };
    firebaseAuthMocks.sendEmailVerification
      .mockRejectedValueOnce(primary)
      .mockRejectedValueOnce(fallback);

    await expect(
      firstValueFrom(service.resendVerificationEmail('https://app.test/verify'))
    ).rejects.toThrow('Erro ao reenviar e-mail de verificação.');

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(fallback, {
      feature: 'email-verification',
      operation: 'sendEmailVerificationFallback',
      fallbackMessage:
        'Não foi possível concluir uma etapa interna da verificação de e-mail.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'EmailVerificationService',
        operation: 'sendEmailVerificationFallback',
      },
    });
  });

  it('não rediagnostica em handleEmailVerification uma falha já reportada por verifyEmail', async () => {
    const original = Object.assign(new Error('invalid action code'), {
      code: 'auth/invalid-action-code',
    });
    router.url = '/post-verification/action?mode=verifyEmail&oobCode=abc';
    router.parseUrl.mockReturnValue({
      queryParams: {
        mode: 'verifyEmail',
        oobCode: 'abc',
      },
    });
    firebaseAuthMocks.checkActionCode.mockResolvedValue({ data: {} });
    firebaseAuthMocks.applyActionCode.mockRejectedValue(original);

    await expect(firstValueFrom(service.handleEmailVerification())).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(original, {
      feature: 'email-verification',
      operation: 'verifyEmail',
      fallbackMessage:
        'Não foi possível concluir uma etapa interna da verificação de e-mail.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'EmailVerificationService',
        operation: 'verifyEmail',
      },
    });
  });

  it('mantém handleEmailVerification como owner de falha ainda não diagnosticada em checkActionCode', async () => {
    const original = Object.assign(new Error('expired action code'), {
      code: 'auth/expired-action-code',
    });
    router.url = '/post-verification/action?mode=verifyEmail&oobCode=abc';
    router.parseUrl.mockReturnValue({
      queryParams: {
        mode: 'verifyEmail',
        oobCode: 'abc',
      },
    });
    firebaseAuthMocks.checkActionCode.mockRejectedValue(original);

    await expect(firstValueFrom(service.handleEmailVerification())).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });

    expect(firebaseAuthMocks.applyActionCode).not.toHaveBeenCalled();
    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(original, {
      feature: 'email-verification',
      operation: 'handleEmailVerification',
      fallbackMessage:
        'Não foi possível concluir uma etapa interna da verificação de e-mail.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'EmailVerificationService',
        operation: 'handleEmailVerification',
      },
    });
  });

  it('não rediagnostica no sync uma falha já pertencente a updateEmailVerificationStatus', async () => {
    const original = new Error('firestore write failed');
    router.url = '/post-verification/action?mode=verifyEmail&oobCode=abc';
    router.parseUrl.mockReturnValue({
      queryParams: {
        mode: 'verifyEmail',
        oobCode: 'abc',
      },
    });
    auth.currentUser = {
      uid: 'user-1',
      email: 'user@example.com',
      emailVerified: true,
    };
    authSession.refreshCurrentUser$.mockReturnValue(
      of({
        uid: 'user-1',
        emailVerified: true,
      })
    );
    userWrite.patchEmailVerified$.mockReturnValue(
      throwError(() => original)
    );

    await expect(firstValueFrom(service.handleEmailVerification())).resolves.toEqual({
      ok: true,
      firestoreUpdated: false,
    });

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(original, {
      feature: 'email-verification',
      operation: 'updateEmailVerificationStatus',
      fallbackMessage:
        'Não foi possível atualizar a verificação agora. Entre novamente e repita a conferência.',
      presentation: { surface: 'snackbar', severity: 'error' },
      metadata: {
        scope: 'EmailVerificationService',
        operation: 'updateEmailVerificationStatus',
        uid: 'user-1',
      },
    });
  });

  it('repropaga o erro original no updateEmailVerificationStatus', async () => {
    const original = new Error('write failed');
    userWrite.patchEmailVerified$.mockReturnValue(
      throwError(() => original)
    );

    let received: unknown;
    try {
      await firstValueFrom(
        service.updateEmailVerificationStatus('user-1', true)
      );
    } catch (error) {
      received = error;
    }

    expect(received).toBe(original);
    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });

  it('mantém o resultado público mesmo se a camada canônica falhar no resend', async () => {
    const original = Object.assign(new Error('network failed'), {
      code: 'auth/network-request-failed',
    });
    auth.currentUser = {
      uid: 'user-1',
      email: 'user@example.com',
    };
    firebaseAuthMocks.sendEmailVerification.mockRejectedValue(original);
    applicationError.report
      .mockImplementationOnce(() => {
        throw new Error('diagnostic unavailable');
      })
      .mockImplementationOnce(() => undefined);

    await expect(
      firstValueFrom(service.resendVerificationEmail('https://app.test/verify'))
    ).rejects.toThrow('Erro ao reenviar e-mail de verificação.');

    expect(applicationError.report).toHaveBeenCalledTimes(2);
    expect(applicationError.report.mock.calls[0]?.[1]?.operation).toBe(
      'sendEmailVerification'
    );
    expect(applicationError.report.mock.calls[1]?.[1]?.operation).toBe(
      'resendVerificationEmail'
    );
  });
});
