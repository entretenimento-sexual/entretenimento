import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('substituição canônica de foto publicada', () => {
  it('a galeria usa o ativo autorizado e não precisa do arquivo privado', () => {
    const component = source('src/app/media/photos/profile-photos/profile-photos.component.ts');
    const template = source('src/app/media/photos/profile-photos/profile-photos.component.html');
    expect(component).toContain('this.publishedReplacement.replace$({');
    expect(component).toContain('const storedImageUrl = String(item.url ??');
    expect(component).toContain('storedImageUrl,');
    expect(component).toContain('expectedAssetVersion');
    expect(component).not.toContain('this.photoUploadFlow.replaceProcessedPhoto$({');
    expect(template).toContain('[showEditAction]="!!item.url"');
    expect(template).toContain('[showSecondaryAction]="!!item.path"');
  });
  it('upload da câmera e edição local seguem a mesma reserva e não criam biblioteca', () => {
    const service = source('src/app/core/services/image-handling/published-photo-replacement.service.ts');
    expect(service).toContain('this.storage.uploadOwnedPhotoFile(');
    expect(service).toContain("'replacePublishedPhoto'");
    expect(service).not.toContain('savePhotoMetadata(');
    expect(service).not.toContain('updatePhotoMetadata(');
    expect(service).not.toContain('saveImageState(');
  });
  it('backend revalida publicação, geração, moderação e autoriza somente com App Check', () => {
    const backend = source('functions/src/media/application/replace-published-photo.handler.ts');
    expect(backend).toContain('enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK');
    expect(backend).toContain('assertMediaAuthoringEligibility(ownerUid)');
    expect(backend).toContain('tx.get(publicationRef)');
    expect(backend).toContain('tx.get(projectionRef)');
    expect(backend).toContain('tx.get(reservationRef)');
    expect(backend).toContain('normalizeGcsGeneration(metadata.generation)');
    expect(backend).toContain('deleteGenerationPinnedVideoFile(');
    expect(backend).toContain('sourceStoragePath: FieldValue.delete()');
    expect(backend).toContain('previousPath');
  });
});
