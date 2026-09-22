import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PasswordResetCodeValidationService,
  mapPasswordResetCodeValidationError,
} from './password-reset-code-validation.service';

describe('mapPasswordResetCodeValidationError', () => {
  it('classifica código expirado sem tratar como falha operacional', () => {
    expect(
      mapPasswordResetCodeValidationError({
        code: 'auth/expired-action-code',
      })
    ).toEqual({
      ok: false,
      reason: 'expired',
      message: 'O link de redefinição de senha expirou.',
    });
  });

  it('classifica código inválido ou já utilizado', () => {
    expect(
      mapPasswordResetCodeValidationError({
        code: 'auth/invalid-action-code',
      })
    ).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'O código de redefinição é inválido ou já foi usado.',
    });
  });

  it('mantém falha de rede como indisponibilidade temporária', () => {
    expect(
      mapPasswordResetCodeValidationError({
        code: 'auth/network-request-failed',
      })
    ).toEqual({
      ok: false,
      reason: 'unavailable',
      message:
        'Não foi possível validar o link agora. Verifique sua conexão e tente novamente.',
    });
  });

  it('apresenta mensagem própria para timeout', () => {
    expect(
      mapPasswordResetCodeValidationError({ name: 'TimeoutError' })
    ).toEqual({
      ok: false,
      reason: 'unavailable',
      message:
        'A validação do link demorou além do esperado. Tente novamente.',
    });
  });
});

describe('PasswordResetCodeValidationService canonical errors', () => {
  let ctx: {
    deferPromise$: ReturnType<typeof vi.fn>;
  };
  let applicationError: {
    report: ReturnType<typeof vi.fn>;
  };
  let service: PasswordResetCodeValidationService;

  beforeEach(() => {
    vi.clearAllMocks();

    ctx = {
      deferPromise$: vi.fn(),
    };
    applicationError = {
      report: vi.fn(),
    };

    service = new PasswordResetCodeValidationService(
      {} as any,
      ctx as any,
      applicationError as any
    );
  });

  it('falha fechado para código ausente sem diagnóstico técnico', async () => {
    await expect(firstValueFrom(service.validate$('   '))).resolves.toEqual({
      ok: false,
      reason: 'invalid',
      message: 'O link de redefinição é inválido ou está incompleto.',
    });

    expect(ctx.deferPromise$).not.toHaveBeenCalled();
    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('preserva resultado de sucesso e normaliza o e-mail', async () => {
    ctx.deferPromise$.mockReturnValue(
      of('  USER@Example.COM  ')
    );

    await expect(
      firstValueFrom(service.validate$('abc123'))
    ).resolves.toEqual({
      ok: true,
      reason: 'valid',
      email: 'user@example.com',
      message: 'Link válido.',
    });

    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('trata código expirado como estado esperado sem diagnóstico', async () => {
    ctx.deferPromise$.mockReturnValue(
      throwError(() => ({
        code: 'auth/expired-action-code',
      }))
    );

    await expect(
      firstValueFrom(service.validate$('abc123'))
    ).resolves.toEqual({
      ok: false,
      reason: 'expired',
      message: 'O link de redefinição de senha expirou.',
    });

    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('trata código inválido como estado esperado sem diagnóstico', async () => {
    ctx.deferPromise$.mockReturnValue(
      throwError(() => ({
        code: 'auth/invalid-action-code',
      }))
    );

    await expect(
      firstValueFrom(service.validate$('abc123'))
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid',
      message: 'O código de redefinição é inválido ou já foi usado.',
    });

    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('diagnostica indisponibilidade operacional silenciosamente e mantém o resultado público', async () => {
    const original = Object.assign(new Error('network failed'), {
      code: 'auth/network-request-failed',
    });
    ctx.deferPromise$.mockReturnValue(
      throwError(() => original)
    );

    await expect(
      firstValueFrom(service.validate$('abc123'))
    ).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      message:
        'Não foi possível validar o link agora. Verifique sua conexão e tente novamente.',
    });

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(original, {
      feature: 'password-reset-code-validation',
      operation: 'validate$',
      fallbackMessage:
        'Não foi possível validar o link de redefinição de senha.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'PasswordResetCodeValidationService',
        operation: 'validate$',
        codePresent: true,
      },
    });
  });

  it('preserva mensagem de timeout e diagnóstico silencioso', async () => {
    const original = Object.assign(new Error('timeout'), {
      name: 'TimeoutError',
    });
    ctx.deferPromise$.mockReturnValue(
      throwError(() => original)
    );

    await expect(
      firstValueFrom(service.validate$('abc123'))
    ).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      message:
        'A validação do link demorou além do esperado. Tente novamente.',
    });

    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });

  it('mantém o resultado público se a própria camada canônica falhar', async () => {
    const original = new Error('backend unavailable');
    ctx.deferPromise$.mockReturnValue(
      throwError(() => original)
    );
    applicationError.report.mockImplementationOnce(() => {
      throw new Error('diagnostic unavailable');
    });

    await expect(
      firstValueFrom(service.validate$('abc123'))
    ).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      message:
        'Não foi possível validar o link agora. Verifique sua conexão e tente novamente.',
    });

    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });
});
