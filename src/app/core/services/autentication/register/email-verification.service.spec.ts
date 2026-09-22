import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    vi.restoreAllMocks();
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

    service = new EmailVerificationService(
      router as any,
      authSession as any,
      currentUserStore as any,
      userWrite as any,
      applicationError as any,
      auth as any
    );
  });

  it('configura o idioma do Auth sem alterar o contrato público', () => {
    expect(auth.languageCode).toBe('pt-BR');
  });

  it('preserva erro público de sessão ausente no resend sem diagnóstico técnico', async () => {
    await expect(
      firstValueFrom(service.resendVerificationEmail())
    ).rejects.toThrow('Nenhum usuário autenticado encontrado.');

    expect(applicationError.report).not.toHaveBeenCalled();
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

  it('não rediagnostica no resend uma falha já pertencente ao envio inferior', async () => {
    const lowerError = {
      code: 'auth/too-many-requests',
      message: 'Não foi possível enviar o e-mail de verificação.',
    };
    auth.currentUser = {
      uid: 'user-1',
      email: 'user@example.com',
    };

    (service as any).markReported(lowerError);
    vi.spyOn(service, 'sendEmailVerification').mockReturnValue(
      throwError(() => lowerError)
    );

    await expect(
      firstValueFrom(service.resendVerificationEmail('https://app.test/verify'))
    ).rejects.toThrow('Erro ao reenviar e-mail de verificação.');

    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('assume ownership no resend quando a falha inferior ainda não foi diagnosticada', async () => {
    const lowerError = {
      code: 'auth/network-request-failed',
      message: 'Não foi possível enviar o e-mail de verificação.',
    };
    auth.currentUser = {
      uid: 'user-1',
      email: 'user@example.com',
    };

    vi.spyOn(service, 'sendEmailVerification').mockReturnValue(
      throwError(() => lowerError)
    );

    await expect(
      firstValueFrom(service.resendVerificationEmail('https://app.test/verify'))
    ).rejects.toThrow('Erro ao reenviar e-mail de verificação.');

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(lowerError, {
      feature: 'email-verification',
      operation: 'resendVerificationEmail',
      fallbackMessage:
        'Não foi possível concluir uma etapa interna da verificação de e-mail.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'EmailVerificationService',
        operation: 'resendVerificationEmail',
      },
    });
  });

  it('centraliza updateEmailVerificationStatus com snackbar e repropaga o erro original', async () => {
    const original = new Error('firestore write failed');
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

    (service as any).reportErrorIfNeeded(
      original,
      'syncEmailVerificationAfterActionCode'
    );

    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });

  it('preserva patch runtime no sucesso de updateEmailVerificationStatus', async () => {
    userWrite.patchEmailVerified$.mockReturnValue(of(void 0));

    await expect(
      firstValueFrom(
        service.updateEmailVerificationStatus('user-1', true)
      )
    ).resolves.toBeUndefined();

    expect(currentUserStore.patch).toHaveBeenCalledWith({
      emailVerified: true,
    });
    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('impede rediagnóstico verify→handle sem alterar o objeto público mapeado', () => {
    const mapped = {
      code: 'auth/invalid-action-code',
      message: 'O link é inválido. Solicite um novo.',
    };

    (service as any).markReported(mapped);
    (service as any).reportErrorIfNeeded(
      mapped,
      'handleEmailVerification'
    );

    expect(applicationError.report).not.toHaveBeenCalled();
    expect(mapped).toEqual({
      code: 'auth/invalid-action-code',
      message: 'O link é inválido. Solicite um novo.',
    });
  });

  it('mantém handle como owner quando recebe erro ainda não diagnosticado', () => {
    const original = Object.assign(new Error('expired action code'), {
      code: 'auth/expired-action-code',
    });

    (service as any).reportErrorIfNeeded(
      original,
      'handleEmailVerification'
    );

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

    (service as any).reportErrorIfNeeded(
      original,
      'handleEmailVerification'
    );

    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });

  it('preserva mapeamento público dos erros de envio', () => {
    expect(
      (service as any).toVerificationError({
        code: 'deadline-exceeded',
      })
    ).toEqual({
      code: 'deadline-exceeded',
      message:
        'Tempo de resposta excedido ao enviar o e-mail. Tente novamente.',
    });

    expect(
      (service as any).toVerificationError({
        code: 'auth/network-request-failed',
      })
    ).toEqual({
      code: 'auth/network-request-failed',
      message: 'Não foi possível enviar o e-mail de verificação.',
    });
  });

  it('preserva resultados locais de handle antes de chamar Firebase Auth', async () => {
    router.url = '/post-verification/action?mode=resetPassword&oobCode=abc';
    router.parseUrl.mockReturnValue({
      queryParams: {
        mode: 'resetPassword',
        oobCode: 'abc',
      },
    });

    await expect(
      firstValueFrom(service.handleEmailVerification())
    ).resolves.toEqual({
      ok: false,
      reason: 'unknown',
    });

    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('preserva erro de action code ausente sem diagnóstico técnico', async () => {
    router.url = '/post-verification/action?mode=verifyEmail';
    router.parseUrl.mockReturnValue({
      queryParams: {
        mode: 'verifyEmail',
      },
    });

    await expect(
      firstValueFrom(service.handleEmailVerification())
    ).rejects.toThrow('Código de verificação ausente na URL.');

    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('mantém o resultado público quando a camada canônica falha no resend', async () => {
    const lowerError = {
      code: 'auth/network-request-failed',
      message: 'Não foi possível enviar o e-mail de verificação.',
    };
    auth.currentUser = {
      uid: 'user-1',
      email: 'user@example.com',
    };

    vi.spyOn(service, 'sendEmailVerification').mockReturnValue(
      throwError(() => lowerError)
    );
    applicationError.report.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    await expect(
      firstValueFrom(service.resendVerificationEmail('https://app.test/verify'))
    ).rejects.toThrow('Erro ao reenviar e-mail de verificação.');

    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });
});
