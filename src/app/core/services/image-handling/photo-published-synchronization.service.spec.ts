import { describe, expect, it } from 'vitest';
import { firstValueFrom, Subject } from 'rxjs';

import {
  isPublishedPhotoReplacementConfirmed,
  awaitPublishedPhotoSync$,
} from './photo-published-synchronization.service';

const OWNER = 'owner-1';
const PHOTO = 'photo-1';
const SOURCE = `users/${OWNER}/uploads/images/new-photo.jpg`;
const PUBLISHED = `users/${OWNER}/published/images/${PHOTO}/version-2`;

describe('isPublishedPhotoReplacementConfirmed', () => {
  const published = {
    isPublished: true,
    sourceStoragePath: SOURCE,
    publishedStoragePath: PUBLISHED,
  };

  it('confirma exclusivamente a publicação final que referencia a nova origem', () => {
    expect(isPublishedPhotoReplacementConfirmed(
      OWNER, PHOTO, SOURCE, published
    )).toBe(true);
  });

  it('não aceita apenas o registro da origem privada nem a versão antiga', () => {
    for (const value of [
      null,
      { ...published, isPublished: false },
      { ...published, sourceStoragePath: `users/${OWNER}/uploads/images/old.jpg` },
      { ...published, publishedStoragePath: '' },
      { ...published, publishedStoragePath:
        `users/${OWNER}/published/images/${PHOTO}/version-2/extra` },
      { ...published, publishedStoragePath:
        `users/another-owner/published/images/${PHOTO}/version-2` },
      { ...published, publishedStoragePath:
        `users/${OWNER}/published/images/another-photo/version-2` },
    ]) {
      expect(isPublishedPhotoReplacementConfirmed(
        OWNER, PHOTO, SOURCE, value
      )).toBe(false);
    }
  });

  it('nega source estranho, outro proprietário e caminhos inseguros', () => {
    expect(isPublishedPhotoReplacementConfirmed(
      OWNER, PHOTO, 'https://example.test/another.jpg', published
    )).toBe(false);
    expect(isPublishedPhotoReplacementConfirmed(
      'other-owner', PHOTO, SOURCE, published
    )).toBe(false);
    expect(isPublishedPhotoReplacementConfirmed(
      OWNER, PHOTO, SOURCE + '/nested', published
    )).toBe(false);
    expect(isPublishedPhotoReplacementConfirmed(
      OWNER, '../photo', SOURCE, published
    )).toBe(false);
  });
});

describe('awaitPublishedPhotoSync$', () => {
  it('ignora estados antigos e completa só depois do novo ativo publicado', async () => {
    const records = new Subject<{
      isPublished: boolean;
      sourceStoragePath: string;
      publishedStoragePath: string;
    }>();
    let confirmed = false;
    const awaiting = firstValueFrom(
      awaitPublishedPhotoSync$(records, OWNER, PHOTO, SOURCE, 500)
    ).then(() => { confirmed = true; });

    records.next({
      isPublished: true,
      sourceStoragePath: `users/${OWNER}/uploads/images/old.jpg`,
      publishedStoragePath: `users/${OWNER}/published/images/${PHOTO}/version-1`,
    });
    expect(confirmed).toBe(false);

    records.next({
      isPublished: true,
      sourceStoragePath: SOURCE,
      publishedStoragePath: PUBLISHED,
    });
    await awaiting;
    expect(confirmed).toBe(true);
  });

  it('falha por timeout em vez de afirmar sucesso sem confirmação do backend', async () => {
    const records = new Subject<{
      isPublished: boolean;
      sourceStoragePath: string;
      publishedStoragePath: string;
    }>();
    await expect(firstValueFrom(
      awaitPublishedPhotoSync$(records, OWNER, PHOTO, SOURCE, 5)
    )).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
