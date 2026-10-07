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

  it('registro de foto deriva path da reserva e não do payload do cliente', () => {
    const source = mediaSource('register-private-photo-upload.handler.ts');

    assert.match(source, /request\.data\?\.reservationId/);
    assert.match(source, /reservation\.storagePath/);
    assert.match(source, /const storagePath = extractOwnedPrivatePhotoPath/);
    assert.doesNotMatch(source, /request\.data\?\.storagePath/);
  });

  it('vídeo privado não persiste path como url ou thumbnailUrl', () => {
    const source = mediaSource('register-private-video-upload.handler.ts');

    assert.match(source, /path:\s*videoStoragePath/);
    assert.match(source, /thumbnailPath:\s*posterStoragePath/);
    assert.doesNotMatch(source, /url:\s*videoStoragePath/);
    assert.doesNotMatch(source, /thumbnailUrl:\s*posterStoragePath/);
  });

  it('vídeo privado valida lifecycle e limita URL pelo acesso da conta', () => {
    const source = mediaSource('get-private-video-access-urls.handler.ts');

    assert.match(source, /await assertInteractionAccess\(requesterUid\)/);
    assert.match(source, /resolveAuthorizedMediaSignedUrlExpiresAt\(\{/);
    assert.match(source, /requesterAccessExpiresAtMs:\s*requesterAccess\.accessExpiresAtMs/);
    assert.match(source, /if \(expiresAt === null\)/);
  });

});
