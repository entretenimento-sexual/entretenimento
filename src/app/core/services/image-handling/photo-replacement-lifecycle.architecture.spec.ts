import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ordem de substituição de foto publicada', () => {
  const flow = readFileSync(resolve(
    process.cwd(),
    'src/app/core/services/image-handling/photo-upload-flow.service.ts'
  ), 'utf8');
  const method = flow.split('  replaceProcessedPhoto$(')[1]
    ?.split('  uploadProcessedPhotoWithProgress$(')[0] ?? '';

  it('confirma a nova mídia publicada antes de excluir a origem anterior', () => {
    const register = method.indexOf('this.photoFirestoreService.updatePhotoMetadata(');
    const confirmed = method.indexOf('this.publishedSync.waitForPublishedReplacement$(');
    const deleteOld = method.indexOf(" 'cleanup-replaced-photo-confirmed'");
    expect(register).toBeGreaterThanOrEqual(0);
    expect(confirmed).toBeGreaterThan(register);
    expect(deleteOld).toBeGreaterThan(confirmed);
    expect(method).not.toContain("'cleanup-replaced-photo'");
  });

  it('não converte falha de sincronização em sucesso ou rollback do ativo novo', () => {
    const catchMetadata = method.indexOf('catchError((metadataError)');
    const confirmed = method.indexOf('this.publishedSync.waitForPublishedReplacement$(');
    expect(catchMetadata).toBeGreaterThanOrEqual(0);
    expect(catchMetadata).toBeLessThan(confirmed);
    expect(method).toContain('takeUntil(this.ownerSessionEnded$(safeUserId))');
  });
});
