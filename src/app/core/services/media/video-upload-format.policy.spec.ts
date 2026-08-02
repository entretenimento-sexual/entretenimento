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
  ])('aceita %s com tipo %s', (name, type, extension) => {
    expect(resolveVideoUploadFormat({ name, type })).toEqual(
      expect.objectContaining({ extension })
    );
    expect(isAcceptedVideoUploadFile({ name, type })).toBe(true);
  });

  it('aceita extensão suportada quando o navegador não informa MIME type', () => {
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
    ['arquivo.m2ts', 'video/mp2t'],
    ['arquivo.mxf', 'application/mxf'],
    ['arquivo.ogv', 'video/ogg'],
  ])('rejeita formato sem suporte no pipeline: %s', (name, type) => {
    expect(resolveVideoUploadFormat({ name, type })).toBeNull();
    expect(isAcceptedVideoUploadFile({ name, type })).toBe(false);
  });

  it('não anuncia formatos fora da política', () => {
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.mp4');
    expect(VIDEO_UPLOAD_ACCEPT).toContain('.mov');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('.mkv');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('.m2ts');
    expect(VIDEO_UPLOAD_ACCEPT).not.toContain('video/*');
  });
});
