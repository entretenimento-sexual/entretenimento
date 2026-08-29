// src/app/community/feed/community-composer-attachment.model.spec.ts
import { describe, expect, it } from 'vitest';

import {
  validateImageMediaFile,
} from 'src/app/core/services/media/media-format.policy';
import {
  MAX_COMMUNITY_COMPOSER_IMAGE_BYTES,
  createCommunityComposerLocationAttachment,
  validateCommunityComposerImage,
} from './community-composer-attachment.model';

describe('community composer attachment model', () => {
  it('delega a validação de formatos para a política canônica de imagem', () => {
    const accepted = new File(['image'], 'foto.webp', { type: 'image/webp' });
    const rejected = new File(['image'], 'foto.gif', { type: 'image/gif' });

    expect(validateCommunityComposerImage(accepted)).toEqual({ valid: true });
    expect(validateCommunityComposerImage(rejected)).toEqual(
      validateImageMediaFile(rejected, 'default')
    );
  });

  it('delega o limite de tamanho para a política canônica de imagem', () => {
    const oversized = {
      type: 'image/jpeg',
      size: MAX_COMMUNITY_COMPOSER_IMAGE_BYTES + 1,
    } as File;

    expect(validateCommunityComposerImage(oversized)).toEqual(
      validateImageMediaFile(oversized, 'default')
    );
  });

  it('preserva localização precisa após gesto explícito e normaliza a acurácia', () => {
    expect(createCommunityComposerLocationAttachment(
      -22.9123454,
      -43.1765434,
      8.4
    )).toEqual({
      kind: 'location',
      latitude: -22.912345,
      longitude: -43.176543,
      precision: 'precise',
      accuracyMeters: 8,
    });
  });
});
