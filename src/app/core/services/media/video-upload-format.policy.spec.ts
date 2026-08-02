import { describe, expect, it } from 'vitest';

import {
  VIDEO_UPLOAD_ACCEPT,
  VIDEO_UPLOAD_FORMAT_LABEL,
  isAcceptedVideoUploadFile,
  resolveVideoUploadFormat,
} from './video-upload-format.policy';

describe('video-upload-format.policy', () => {
  it.each([
    ['video.mp4', 'video/mp4', 'mp4'],
    ['video.m4v', 'video/x-m4v', 'm4v'],
    ['video.mov', 'video/quicktime', 'mov'],
    ['video.webm', 'video/webm', 'webm'],
  ])('aceita %s com tipo %s', (name, type, extension) => {
    expect(resolveVideoUploadFormat({ name, type })).toEqual(
      expect.objectContaining({ extension })
    );
    expect(isAcceptedVideoUploadFile({ name, type })).toBe(true);
  });

  it('normaliza M4V para o MIME processável de MP4', () => {
    expect(
      resolveVideoUploadFormat({ name: 'video.m4v', type: 'video/x-m4v' })
    ).toEqual({
      extension: 'm4v',
      mimeType: 'video/mp4',
      browserPreviewLikely: true,
    });
  });

  it('aceita extensão processável quando o navegador não informa MIME type', () => {
    expect(resolveVideoUploadFormat({ name: 'camera.WEBM', type: '' })).toEqual({
      extension: 'webm',
      mimeType: 'video/webm',
      browserPreviewLikely: true,
    });
  });

  it.each([
    ['video.mkv', 'video/x-matroska'],
    ['video.avi', 'video/x-msvideo'],
    ['video.wmv', 'video/x-ms-wmv'],
    ['video.mts', 'video/mp2t'],
    ['video.m2ts', ''],
    ['video.mxf', 'application/mxf'],
  ])('rejeita formato não processado: %s', (name, type) => {
    expect(resolveVideoUploadFormat({ name, type })).toBeNull();
    expect(isAcceptedVideoUploadFile({ name, type })).toBe(false);
  });

  it('rejeita divergência entre extensão e MIME type conhecidos', () => {
    expect(
      resolveVideoUploadFormat({ name: 'arquivo.mp4', type: 'video/webm' })
    ).toBeNull();
  });

  it('mantém texto e atributo accept alinhados', () => {
    expect(VIDEO_UPLOAD_FORMAT_LABEL).toBe('MP4, M4V, MOV ou WebM');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.mp4');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.m4v');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.mov');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.webm');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('.mkv');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('video/*');
  });
});
