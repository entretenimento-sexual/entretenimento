import { describe, expect, it } from 'vitest';

import {
  MEDIA_IMAGE_ACCEPT,
  MEDIA_VIDEO_MAX_BYTES,
  MEDIA_VIDEO_POSTER_MAX_BYTES,
  resolveImageEditorPreset,
  resolveImageInputFormat,
  resolveImageMaxBytes,
  validateImageMediaFile,
  validateVideoMediaFile,
} from './media-format.policy';

describe('media-format.policy image contract', () => {
  it.each([
    ['foto.jpg', 'image/jpeg', 'jpg'],
    ['foto.jpeg', 'image/jpeg', 'jpeg'],
    ['foto.png', 'image/png', 'png'],
    ['foto.webp', 'image/webp', 'webp'],
  ])('aceita %s com MIME %s', (name, type, extension) => {
    expect(resolveImageInputFormat({ name, type })).toEqual(
      expect.objectContaining({ extension })
    );
    expect(validateImageMediaFile({ name, type, size: 1024 })).toEqual({
      valid: true,
    });
  });

  it('rejeita extensão e MIME divergentes', () => {
    expect(
      resolveImageInputFormat({ name: 'foto.png', type: 'image/jpeg' })
    ).toBeNull();
  });

  it('não anuncia formatos fora da política', () => {
    expect(MEDIA_IMAGE_ACCEPT).toContain('.jpg');
    expect(MEDIA_IMAGE_ACCEPT).toContain('.jpeg');
    expect(MEDIA_IMAGE_ACCEPT).toContain('.webp');
    expect(MEDIA_IMAGE_ACCEPT).not.toContain('image/*');
    expect(
      validateImageMediaFile({ name: 'foto.gif', type: 'image/gif', size: 1024 })
        .valid
    ).toBe(false);
  });

  it('aplica limite específico de avatar', () => {
    expect(
      validateImageMediaFile(
        {
          name: 'avatar.jpg',
          type: 'image/jpeg',
          size: 8 * 1024 * 1024 + 1,
        },
        'avatar'
      )
    ).toEqual({
      valid: false,
      userMessage: 'A imagem deve ter no máximo 8 MB.',
    });
  });

  it('mantém avatar quadrado, capa horizontal e feed social como presets canônicos', () => {
    expect(resolveImageEditorPreset('avatar-square')).toEqual(
      expect.objectContaining({
        aspectRatio: 'square',
        lockAspectRatio: true,
        maxOutputEdge: 1024,
      })
    );
    expect(resolveImageEditorPreset('community-cover')).toEqual(
      expect.objectContaining({
        aspectRatio: 'landscape',
        lockAspectRatio: true,
      })
    );
    expect(resolveImageEditorPreset('social-feed')).toEqual(
      expect.objectContaining({
        aspectRatio: 'original',
        lockAspectRatio: false,
        maxOutputEdge: 2048,
      })
    );
  });
});

describe('media-format.policy video size contract', () => {
  it('expõe o mesmo limite canônico para a capa de vídeo', () => {
    expect(MEDIA_VIDEO_POSTER_MAX_BYTES).toBe(
      resolveImageMaxBytes('video-poster')
    );
  });

  it('valida o tamanho do vídeo usando o limite gerado pela fonte única', () => {
    expect(MEDIA_VIDEO_MAX_BYTES).toBeGreaterThan(0);
    expect(
      validateVideoMediaFile({
        name: 'video.mp4',
        type: 'video/mp4',
        size: MEDIA_VIDEO_MAX_BYTES,
      })
    ).toEqual({ valid: true });
    expect(
      validateVideoMediaFile({
        name: 'video.mp4',
        type: 'video/mp4',
        size: MEDIA_VIDEO_MAX_BYTES + 1,
      }).valid
    ).toBe(false);
  });
});
