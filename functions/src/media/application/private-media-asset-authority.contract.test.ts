import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

function mediaSource(name: string): string {
  return readFileSync(
    resolve(process.cwd(), 'src', 'media', 'application', name),
    'utf8'
  );
}

describe('Private media asset authority contract', () => {
  it('foto privada persiste storagePath sem alias url', () => {
    const source = mediaSource('register-private-photo-upload.handler.ts');

    assert.match(source, /path:\s*storagePath/);
    assert.doesNotMatch(source, /url:\s*String\(request\.data\?\.url/);
    assert.doesNotMatch(source, /urlPath/);
  });

  it('vídeo privado não persiste path como url ou thumbnailUrl', () => {
    const source = mediaSource('register-private-video-upload.handler.ts');

    assert.match(source, /path:\s*videoStoragePath/);
    assert.match(source, /thumbnailPath:\s*posterStoragePath/);
    assert.doesNotMatch(source, /url:\s*videoStoragePath/);
    assert.doesNotMatch(source, /thumbnailUrl:\s*posterStoragePath/);
  });
});
