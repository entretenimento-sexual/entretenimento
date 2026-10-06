import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('photo upload path authority', () => {
  it('StorageService honra o path canônico fornecido pelo caller', () => {
    const storage = source(
      'src/app/core/services/image-handling/storage.service.ts'
    );

    expect(storage).toContain('private resolveOwnedUploadPath(');
    expect(storage).toContain(
      'const resolvedPath = this.resolveOwnedUploadPath('
    );
    expect(storage).toContain('return cleanPath;');

    const uploadStart = storage.indexOf('  uploadFile(');
    const avatarStart = storage.indexOf('  uploadProfileAvatar(', uploadStart);
    const uploadBlock = storage.slice(uploadStart, avatarStart);

    expect(uploadBlock).not.toContain(
      'this.buildImageUploadPath(safeUid, file.name)'
    );
    expect(uploadBlock).not.toContain(
      'this.buildVideoUploadPath(safeUid, file)'
    );
  });

  it('PhotoUploadFlow mantém path como identidade e URL apenas como projeção', () => {
    const flow = source(
      'src/app/core/services/image-handling/photo-upload-flow.service.ts'
    );

    const uploadStart = flow.indexOf('  private uploadNewPhotoBinary$(');
    const persistStart = flow.indexOf('  private persistNewPhoto$(', uploadStart);
    const uploadBlock = flow.slice(uploadStart, persistStart);

    expect(uploadBlock).toContain(
      'extractOwnedPrivatePhotoPath(\n        userId,\n        requestedStoragePath'
    );
    expect(uploadBlock).toContain(
      'this.storageService.uploadFile(\n      file,\n      storagePath'
    );
    expect(uploadBlock).toContain(
      'this.resolveDisplayUrl$(storagePath, location)'
    );
    expect(uploadBlock).toContain('storagePath,');

    const displayStart = flow.indexOf('  private resolveDisplayUrl$(');
    const rollbackStart = flow.indexOf(
      '  private rollbackUploadedPhoto$(',
      displayStart
    );
    const displayBlock = flow.slice(displayStart, rollbackStart);

    expect(displayBlock).not.toContain('extractOwnedPrivatePhotoPath');
    expect(displayBlock).toContain('this.storageService.getPhotoUrl(storagePath)');
  });

  it('metadado crítico persiste path, não URL de exibição', () => {
    const flow = source(
      'src/app/core/services/image-handling/photo-upload-flow.service.ts'
    );

    const replaceStart = flow.indexOf('  replaceProcessedPhoto$(');
    const updateStart = flow.indexOf(
      'this.photoFirestoreService.updatePhotoMetadata(',
      replaceStart
    );
    const updateEnd = flow.indexOf('          )\n        ).pipe(', updateStart);
    const criticalMetadataBlock = flow.slice(updateStart, updateEnd);

    expect(updateStart).toBeGreaterThan(replaceStart);
    expect(updateEnd).toBeGreaterThan(updateStart);
    expect(criticalMetadataBlock).toContain('path: storagePath');
    expect(criticalMetadataBlock).not.toContain('url: displayUrl');
  });
});
