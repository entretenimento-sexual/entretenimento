import { describe, expect, it } from 'vitest';

import { mapPasswordResetCodeValidationError } from './password-reset-code-validation.service';

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
