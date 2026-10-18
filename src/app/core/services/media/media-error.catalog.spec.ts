import { describe, expect, it } from 'vitest';

import {
  MEDIA_ERROR_CODE_MESSAGES,
  MEDIA_ERROR_CODE_PRESENTATIONS,
  MEDIA_ERROR_MESSAGES,
  MEDIA_ERROR_PRESENTATIONS,
  resolveMediaErrorMessage,
  resolveMediaErrorPresentation,
} from './media-error.catalog';

describe('media-error.catalog', () => {
  it('mantém presentation para todo reason com mensagem canônica', () => {
    const messageReasons = Object.keys(MEDIA_ERROR_MESSAGES).sort();
    const presentationReasons = Object.keys(MEDIA_ERROR_PRESENTATIONS).sort();

    expect(presentationReasons).toEqual(messageReasons);
  });

  it('resolve reason de conta sem depender de fallback local', () => {
    expect(resolveMediaErrorMessage('ACCOUNT_UNAVAILABLE')).toBe(
      'Esta conta não pode acessar conteúdo de mídia no momento.'
    );
    expect(
      resolveMediaErrorPresentation('ACCOUNT_UNAVAILABLE')
    ).toEqual(
      expect.objectContaining({
        surface: 'modal',
        severity: 'warning',
      })
    );
  });

  it('não mantém assurance etário como reason de Media', () => {
    for (const reason of [
      'AGE_VERIFICATION_REQUIRED',
      'AGE_REVERIFICATION_REQUIRED',
      'verification_required',
      'verification_expired',
      'underage',
    ]) {
      expect(resolveMediaErrorMessage(reason)).toBeNull();
      expect(resolveMediaErrorPresentation(reason)).toBeNull();
    }
  });

  it('não inventa mensagem ou presentation para reason desconhecido', () => {
    expect(resolveMediaErrorMessage('unknown_media_reason')).toBeNull();
    expect(resolveMediaErrorPresentation('unknown_media_reason')).toBeNull();
  });


  it('mantém presentation para todo código de transporte especializado em Media', () => {
    const messageCodes = Object.keys(MEDIA_ERROR_CODE_MESSAGES).sort();
    const presentationCodes = Object.keys(MEDIA_ERROR_CODE_PRESENTATIONS).sort();

    expect(presentationCodes).toEqual(messageCodes);
  });

  it('mantém feedback assertivo para falhas do editor de fotos', () => {
    expect(resolveMediaErrorMessage('photo_editor_owner_mismatch')).toBe(
      'Esta foto só pode ser editada pelo perfil que a publicou.'
    );
    expect(
      resolveMediaErrorPresentation('photo_editor_owner_mismatch')
    ).toEqual(
      expect.objectContaining({
        surface: 'modal',
        severity: 'warning',
        title: 'Edição não permitida',
      })
    );

    expect(resolveMediaErrorMessage('photo_editor_failed')).toBe(
      'Não foi possível abrir ou concluir a edição da foto agora. Tente novamente.'
    );
  });
  it('mantém motivos distintos de falha para vídeo, sem mensagem técnica', () => {
    expect(resolveMediaErrorMessage('video_upload_failed')).toBe(
      'Não foi possível concluir o upload do vídeo.'
    );
    expect(resolveMediaErrorMessage('video_library_load_failed')).toBe(
      'Não foi possível carregar seus vídeos agora.'
    );
    expect(resolveMediaErrorMessage('video_publication_settings_failed')).toBe(
      'Não foi possível salvar as informações do vídeo.'
    );
    expect(resolveMediaErrorMessage('video_comments_load_failed')).toBe(
      'Não foi possível carregar os comentários do vídeo. Tente novamente.'
    );
    expect(resolveMediaErrorMessage('video_recovery_action_failed')).toBe(
      'A ação de recuperação do processamento não pôde ser concluída.'
    );
    expect(resolveMediaErrorPresentation('video_comments_load_failed')).toMatchObject({
      surface: 'inline',
    });
    expect(resolveMediaErrorPresentation('video_recovery_queue_load_failed')).toMatchObject({
      surface: 'inline',
    });
    for (const reason of [
      'video_upload_failed',
      'video_library_load_failed',
      'video_publication_settings_failed',
    ] as const) {
      expect(resolveMediaErrorPresentation(reason)).not.toBeNull();
    }
  });
});
