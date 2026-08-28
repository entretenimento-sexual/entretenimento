import { describe, expect, it } from 'vitest';

import {
  VIDEO_UPLOAD_ACCEPT,
  isAcceptedVideoUploadFile,
  resolveVideoUploadFormat,
} from './video-upload-format.policy';

describe('video-upload-format.policy', () => {
  it.each([
    ['video.mp4', 'video/mp4', 'mp4'],
    ['video.m4v', 'video/x-m4v', 'm4v'],
    ['video.mov', 'video/quicktime', 'mov'],
    ['video.webm', 'video/webm', 'webm'],
    ['video.mkv', 'video/x-matroska', 'mkv'],
    ['video.avi', 'video/x-msvideo', 'avi'],
    ['video.wmv', 'video/x-ms-wmv', 'wmv'],
    ['video.mts', 'video/mp2t', 'mts'],
    ['video.m2ts', '', 'm2ts'],
    ['video.mxf', 'application/mxf', 'mxf'],
  ])('aceita %s com tipo %s', (name, type, extension) => {
    expect(resolveVideoUploadFormat({ name, type })).toEqual(
      expect.objectContaining({ extension })
    );
    expect(isAcceptedVideoUploadFile({ name, type })).toBe(true);
  });

  it('aceita extensão conhecida quando o navegador não informa MIME type', () => {
    expect(resolveVideoUploadFormat({ name: 'camera.MKV', type: '' })).toEqual(
      expect.objectContaining({
        extension: 'mkv',
        mimeType: 'video/x-matroska',
        browserPreviewLikely: false,
      })
    );
  });

  it('rejeita divergência entre extensão e MIME type conhecidos', () => {
    expect(
      resolveVideoUploadFormat({ name: 'arquivo.mp4', type: 'video/x-msvideo' })
    ).toBeNull();
  });

  it('não anuncia formatos fora da política', () => {
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.mkv');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.m2ts');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('video/*');
    expect(isAcceptedVideoUploadFile({ name: 'arquivo.ogv', type: 'video/ogg' }))
      .toBe(false);
  });
});
