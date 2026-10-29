import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('galeria própria usa somente publicações canônicas', () => {
  const component = read('src/app/media/photos/profile-photos/profile-photos.component.ts');
  const cards = read('src/app/core/services/media/owner-published-photo-cards.policy.ts');
  const ownerPage = read('src/app/core/services/media/owner-published-photo-gallery.service.ts');

  it('não abre streaming de originais privados ou hidratação privada do Storage', () => {
    expect(component).not.toContain('MediaQueryService');
    expect(component).not.toContain('watchProfilePhotos$(');
    expect(component).not.toContain('filterPublishedProfilePhotos(');
    expect(component).not.toContain('originPhotos');
    expect(component).not.toContain('origin?.');
    expect(component).not.toContain('this.photos$');
    expect(component).toContain('mapOwnerPublishedPhotoCards(');
    expect(component).toContain('this.ownerGalleryState$');
    expect(component).toContain('this.publicationConfigs$');
    expect(ownerPage).toContain('this.ownerPages.loadPhotoPage$(');
  });

  it('mantém viewer, edição local, exclusão e ordenação por data', () => {
    expect(component).toContain('this.publicPhotoViewer.open$({');
    expect(component).toContain('this.publishedReplacement.replace$({');
    expect(component).toContain('this.photoFirestoreService.deletePhoto(');
    expect(component).toContain('this.mediaPublicationService.setCoverPhoto$(');
    expect(component).toContain('this.mediaPublicationService.updatePublishedPhotoDisplayDate$(');
    expect(component).toContain('this.getPhotoSortDate(');
    expect(cards).toContain('displayDate: publication.displayDate');
    expect(cards).not.toContain('users/${ownerUid}/photos');
    expect(cards).not.toContain('sourceStoragePath');
  });
});
