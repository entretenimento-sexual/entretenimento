import {
  resolvePublicMediaCallableUserMessage,
} from './public-media-callable-feedback.policy';

describe('public-media-callable-feedback.policy', () => {
  it('normaliza código functions/resource-exhausted sem exibir mensagem bruta', () => {
    const message = resolvePublicMediaCallableUserMessage(
      {
        code: 'functions/resource-exhausted',
        message: 'detalhe interno que não deve aparecer',
      },
      'reaction',
      'Fallback'
    );

    expect(message).toBe(
      'Muitas reações em pouco tempo. Aguarde um momento e tente novamente.'
    );
    expect(message).not.toContain('detalhe interno');
  });

  it('usa quota específica para comentário e resposta', () => {
    const commentMessage = resolvePublicMediaCallableUserMessage(
      { code: 'resource-exhausted' },
      'comment',
      'Fallback'
    );
    const replyMessage = resolvePublicMediaCallableUserMessage(
      { code: 'functions/resource-exhausted' },
      'reply',
      'Fallback'
    );

    expect(commentMessage).toContain('Muitos comentários');
    expect(replyMessage).toContain('Muitos comentários');
  });

  it('mantém failed-precondition seguro e específico por ação sem reason conhecido', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        {
          code: 'functions/failed-precondition',
          message: 'mensagem de backend não confiável para UI',
        },
        'rating',
        'Fallback'
      )
    ).toBe('Esta avaliação não está disponível no momento.');
  });

  it('orienta conta indisponível por reason estruturado', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        {
          code: 'functions/failed-precondition',
          details: { reason: 'ACCOUNT_UNAVAILABLE' },
          message: 'não exibir esta mensagem',
        },
        'reaction',
        'Fallback'
      )
    ).toBe('Sua conta não está disponível para esta interação.');
  });

  it('orienta aceite de termos por reason estruturado', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        {
          code: 'functions/failed-precondition',
          details: { reason: 'TERMS_REQUIRED' },
        },
        'comment',
        'Fallback'
      )
    ).toBe(
      'Aceite os termos e a política de privacidade atuais para continuar.'
    );
  });

  it('orienta consentimento adulto por reason estruturado', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        {
          code: 'failed-precondition',
          details: { reason: 'ADULT_CONSENT_REQUIRED' },
        },
        'rating',
        'Fallback'
      )
    ).toBe(
      'Confirme o consentimento para conteúdo adulto para continuar.'
    );
  });

  it('orienta revalidação de idade por reason estruturado', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        {
          code: 'functions/failed-precondition',
          details: { reason: 'AGE_REVERIFICATION_REQUIRED' },
        },
        'reply',
        'Fallback'
      )
    ).toBe('Conclua a revalidação de idade para continuar.');
  });

  it('aceita reason estruturado anexado em original', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        {
          original: {
            code: 'functions/failed-precondition',
            details: { reason: 'TERMS_REQUIRED' },
          },
        },
        'reaction',
        'Fallback'
      )
    ).toBe(
      'Aceite os termos e a política de privacidade atuais para continuar.'
    );
  });

  it('ignora reason desconhecido e mantém fallback seguro da ação', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        {
          code: 'functions/failed-precondition',
          details: { reason: 'INTERNAL_EXPERIMENT' },
          message: 'não exibir',
        },
        'comment',
        'Fallback'
      )
    ).toBe('Não foi possível publicar este comentário agora.');
  });

  it('não usa reason conhecido fora de failed-precondition', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        {
          code: 'functions/internal',
          details: { reason: 'TERMS_REQUIRED' },
        },
        'reaction',
        'Fallback'
      )
    ).toBe('Fallback');
  });

  it('orienta sessão expirada sem usar payload do erro', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        { code: 'functions/unauthenticated' },
        'comment',
        'Fallback'
      )
    ).toBe('Sua sessão expirou. Entre novamente para continuar.');
  });

  it('trata indisponibilidade transitória com mensagem segura', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        { code: 'functions/unavailable' },
        'reaction',
        'Fallback'
      )
    ).toBe(
      'O serviço está temporariamente indisponível. Tente novamente em instantes.'
    );
  });

  it('usa fallback definido pelo chamador para código desconhecido', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        { code: 'functions/internal', message: 'segredo técnico' },
        'moderation',
        'Não foi possível moderar o comentário.'
      )
    ).toBe('Não foi possível moderar o comentário.');
  });

  it('aceita código anexado em original por handlers centralizados', () => {
    expect(
      resolvePublicMediaCallableUserMessage(
        { original: { code: 'functions/not-found' } },
        'comment',
        'Fallback'
      )
    ).toBe('Este conteúdo não está mais disponível.');
  });
});
