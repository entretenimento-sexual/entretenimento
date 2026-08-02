import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SUPPORTED_VIDEO_UPLOAD_MIME_TYPES,
  isSupportedVideoUploadMimeType,
  normalizeVideoUploadMimeType,
} from './video-upload-format.policy';

describe('video-upload-format.policy', () => {
  it('mantém somente formatos processáveis pelo pipeline', () => {
    assert.deepEqual(SUPPORTED_VIDEO_UPLOAD_MIME_TYPES, [
      'video/mp4',
      'video/webm',
      'video/quicktime',
    ]);
  });

  it('normaliza e aceita os MIME types processáveis', () => {
    assert.equal(normalizeVideoUploadMimeType(' VIDEO/MP4 '), 'video/mp4');
    assert.equal(isSupportedVideoUploadMimeType('video/mp4'), true);
    assert.equal(isSupportedVideoUploadMimeType('video/webm'), true);
    assert.equal(isSupportedVideoUploadMimeType('video/quicktime'), true);
  });

  it('rejeita formatos apenas selecionáveis, mas não processáveis', () => {
    assert.equal(isSupportedVideoUploadMimeType('video/x-matroska'), false);
    assert.equal(isSupportedVideoUploadMimeType('video/x-msvideo'), false);
    assert.equal(isSupportedVideoUploadMimeType('video/x-ms-wmv'), false);
    assert.equal(isSupportedVideoUploadMimeType('video/mp2t'), false);
    assert.equal(isSupportedVideoUploadMimeType('application/mxf'), false);
  });
});
