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

  it('aceita extensão processável quando o navegador não informa MIME type', () => {
    expect(resolveVideoUploadFormat({ name: 'camera.WEBM', type: '' })).toEqual(
      expect.objectContaining({
        extension: 'webm',
        mimeType: 'video/webm',
        browserPreviewLikely: true,
      })
    );
  });

  it('rejeita divergência entre extensão e MIME type conhecidos', () => {
    expect(
      resolveVideoUploadFormat({ name: 'arquivo.mp4', type: 'video/webm' })
    ).toBeNull();
  });

  it.each([
    ['arquivo.mkv', 'video/x-matroska'],
    ['arquivo.avi', 'video/x-msvideo'],
    ['arquivo.wmv', 'video/x-ms-wmv'],
    ['arquivo.m2ts', 'video/mp2t'],
    ['arquivo.mxf', 'application/mxf'],
    ['arquivo.ogv', 'video/ogg'],
  ])('rejeita formato não processável %s', (name, type) => {
    expect(resolveVideoUploadFormat({ name, type })).toBeNull();
    expect(isAcceptedVideoUploadFile({ name, type })).toBe(false);
  });

  it('anuncia somente os formatos realmente suportados', () => {
    expect(VIDEO_UPLOAD_FORMAT_LABEL).toBe('MP4, M4V, MOV ou WebM');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.mp4');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.m4v');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.mov');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.webm');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('.mkv');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('.m2ts');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('video/*');
  });
});
