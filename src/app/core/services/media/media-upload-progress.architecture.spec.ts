import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Media upload progress architecture', () => {
  it('StorageService não duplica progresso de Media no NgRx global', () => {
    const storage = source(
      'src/app/core/services/image-handling/storage.service.ts'
    );

    expect(storage).not.toContain('uploadProgress');
    expect(storage).not.toContain('uploadSuccess');
    expect(storage).not.toContain('uploadError');
    expect(storage).not.toContain('Store<AppState>');
    expect(storage).toContain('normalizeMediaUploadProgress');
  });

  it('foto consome o progresso já normalizado pelo transporte', () => {
    const photoFlow = source(
      'src/app/core/services/image-handling/photo-upload-flow.service.ts'
    );

    expect(photoFlow).not.toContain('private normalizeProgress');
    expect(photoFlow).toContain("type: 'progress'");
    expect(photoFlow).toContain('progress,');
  });

  it('vídeo compartilha a policy canônica de progresso', () => {
    const videoFlow = source(
      'src/app/core/services/media/video-upload-flow.service.ts'
    );

    expect(videoFlow).toContain('normalizeMediaUploadProgress');
    expect(videoFlow).toContain('mapMediaUploadProgress');
    expect(videoFlow).not.toContain('private normalizeProgress');
    expect(videoFlow).not.toContain('private mapProgress');
  });
});
