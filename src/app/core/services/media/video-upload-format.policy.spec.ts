import { describe, expect, it } from 'vitest';

import {
  VIDEO_UPLOAD_ACCEPT,
  VIDEO_UPLOAD_FORMAT_LABEL,
  isAcceptedVideoUploadFile,
  resolveVideoUploadFormat,
} from './video-upload-format.policy';

describe('video-upload-format.policy', () => {
  it.each([
    ['video.mp4', 'video/mp4', 'mp4', 'video/mp4'],
    ['video.m4v', 'video/x-m4v', 'm4v', 'video/mp4'],
    ['video.mov', 'video/quicktime', 'mov', 'video/quicktime'],
    ['video.webm', 'video/webm', 'webm', 'video/webm'],
  ])(
    'aceita %s com tipo %s, extensão %s e MIME normalizado %s',
    (name, type, extension, mimeType) => {
      expect(resolveVideoUploadFormat({ name, type })).toEqual(
        expect.objectContaining({ extension, mimeType })
      );
      expect(isAcceptedVideoUploadFile({ name, type })).toBe(true);
    }
  );

  it('aceita extensão compatível quando o navegador não informa MIME type', () => {
    expect(resolveVideoUploadFormat({ name: 'camera.MOV', type: '' })).toEqual(
      expect.objectContaining({
        extension: 'mov',
        mimeType: 'video/quicktime',
        browserPreviewLikely: false,
      })
    );
  });

  it('rejeita divergência entre extensão e MIME type conhecidos', () => {
    expect(
      resolveVideoUploadFormat({ name: 'arquivo.mp4', type: 'video/quicktime' })
    ).toBeNull();
  });

  it.each([
    ['arquivo.mkv', 'video/x-matroska'],
    ['arquivo.avi', 'video/x-msvideo'],
    ['arquivo.wmv', 'video/x-ms-wmv'],
    ['arquivo.ts', 'video/mp2t'],
    ['arquivo.mts', 'video/mp2t'],
    ['arquivo.m2ts', 'video/mp2t'],
    ['arquivo.mxf', 'application/mxf'],
    ['arquivo.ogv', 'video/ogg'],
  ])('rejeita formato sem suporte integral: %s', (name, type) => {
    expect(resolveVideoUploadFormat({ name, type })).toBeNull();
    expect(isAcceptedVideoUploadFile({ name, type })).toBe(false);
  });

  it('anuncia somente formatos processáveis pelo pipeline atual', () => {
    expect(VIDEO_UPLOAD_FORMAT_LABEL).toBe('MP4, M4V, MOV ou WebM');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.mp4');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.m4v');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.mov');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.webm');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('.mkv');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('.m2ts');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('application/mxf');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('video/*');
  });
});
