import {
  PrivateMediaDraftOperationError,
  normalizePrivateMediaDraftOperationError,
} from './private-media-draft-operation-error';

describe('normalizePrivateMediaDraftOperationError', () => {
  it('preserva código Firebase e expõe código de domínio', () => {
    const result = normalizePrivateMediaDraftOperationError(
      {
        code: 'functions/permission-denied',
        message: 'Conclua o perfil antes de enviar mídia.',
        details: {
          code: 'MEDIA_PROFILE_INCOMPLETE',
          recovery: 'Preencha os dados obrigatórios.',
          retryable: false,
        },
      },
      'Falha no envio.'
    );

    expect(result).toBeInstanceOf(PrivateMediaDraftOperationError);
    const normalized = result as PrivateMediaDraftOperationError;
    expect(normalized.code).toBe('functions/permission-denied');
    expect(normalized.domainCode).toBe('MEDIA_PROFILE_INCOMPLETE');
    expect(normalized.recovery).toBe('Preencha os dados obrigatórios.');
    expect(normalized.retryable).toBe(false);
  });

  it('mantém o erro original quando não há código de domínio reconhecido', () => {
    const original = new Error('Falha de rede');

    expect(
      normalizePrivateMediaDraftOperationError(original, 'Falha no envio.')
    ).toBe(original);
  });

  it('usa fallback quando o valor não é Error', () => {
    const result = normalizePrivateMediaDraftOperationError(
      null,
      'Falha no envio.'
    );

    expect(result.message).toBe('Falha no envio.');
  });
});
