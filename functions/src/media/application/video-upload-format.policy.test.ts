import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAllowedNewVideoUploadMimeType,
  isDirectPublicPlaybackMimeType,
  isRecognizedRegisteredVideoMimeType,
  normalizeVideoUploadMimeType,
} from './video-upload-format.policy';

test('normaliza o tipo MIME antes da decisão', () => {
  assert.equal(normalizeVideoUploadMimeType(' VIDEO/MP4 '), 'video/mp4');
  assert.equal(normalizeVideoUploadMimeType(undefined), '');
});

test('permite somente formatos atendidos pelo fluxo atual em uploads novos', () => {
  assert.equal(isAllowedNewVideoUploadMimeType('video/mp4'), true);
  assert.equal(isAllowedNewVideoUploadMimeType('video/webm'), true);
  assert.equal(isAllowedNewVideoUploadMimeType('video/quicktime'), true);

  assert.equal(isAllowedNewVideoUploadMimeType('video/x-matroska'), false);
  assert.equal(isAllowedNewVideoUploadMimeType('video/x-msvideo'), false);
  assert.equal(isAllowedNewVideoUploadMimeType('video/x-ms-wmv'), false);
  assert.equal(isAllowedNewVideoUploadMimeType('video/mp2t'), false);
  assert.equal(isAllowedNewVideoUploadMimeType('application/mxf'), false);
});

test('reconhece tipos antigos apenas para preservar retries idempotentes', () => {
  assert.equal(isRecognizedRegisteredVideoMimeType('video/mp4'), true);
  assert.equal(isRecognizedRegisteredVideoMimeType('video/x-matroska'), true);
  assert.equal(isRecognizedRegisteredVideoMimeType('application/mxf'), true);
  assert.equal(isRecognizedRegisteredVideoMimeType('video/unknown'), false);
});

test('marca reprodução direta somente para formatos navegáveis já suportados', () => {
  assert.equal(isDirectPublicPlaybackMimeType('video/mp4'), true);
  assert.equal(isDirectPublicPlaybackMimeType('video/webm'), true);
  assert.equal(isDirectPublicPlaybackMimeType('video/quicktime'), false);
  assert.equal(isDirectPublicPlaybackMimeType('video/x-matroska'), false);
});
