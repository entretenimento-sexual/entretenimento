import { describe, expect, it } from 'vitest';

import {
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

  it('resolve reason conhecido sem depender de fallback local', () => {
    expect(resolveMediaErrorMessage('AGE_REVERIFICATION_REQUIRED')).toBe(
      'Conclua a revalidação de idade antes de acessar este conteúdo.'
    );
    expect(
      resolveMediaErrorPresentation('AGE_REVERIFICATION_REQUIRED')
    ).toEqual(
      expect.objectContaining({
        surface: 'modal',
        severity: 'warning',
      })
    );
  });

  it('não inventa mensagem ou presentation para reason desconhecido', () => {
    expect(resolveMediaErrorMessage('unknown_media_reason')).toBeNull();
    expect(resolveMediaErrorPresentation('unknown_media_reason')).toBeNull();
  });
});
