import { resolveMediaPolicyDeniedMessage } from './media-policy-feedback.policy';

describe('media policy feedback policy', () => {
  it('mantém mensagens consistentes entre foto e vídeo para o mesmo motivo', () => {
    expect(
      resolveMediaPolicyDeniedMessage('EMAIL_UNVERIFIED', 'upload-photo')
    ).toBe('Confirme seu e-mail antes de enviar fotos.');

    expect(
      resolveMediaPolicyDeniedMessage('EMAIL_UNVERIFIED', 'upload-video')
    ).toBe('Confirme seu e-mail antes de enviar vídeos.');
  });

  it('preserva bloqueio de conta e ownership sem fallback local', () => {
    expect(
      resolveMediaPolicyDeniedMessage('INTERACTION_BLOCKED', 'upload-video')
    ).toBe('Sua conta não pode enviar vídeos no momento.');

    expect(
      resolveMediaPolicyDeniedMessage('NOT_OWNER', 'edit-photo')
    ).toBe('Você só pode editar fotos no seu próprio perfil.');
  });

  it('usa fallback seguro para motivo desconhecido', () => {
    expect(
      resolveMediaPolicyDeniedMessage('UNKNOWN', 'manage-media')
    ).toBe('Não foi possível autorizar alterar mídias agora.');
  });
});
