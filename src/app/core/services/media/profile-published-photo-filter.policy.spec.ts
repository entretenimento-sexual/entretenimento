import { describe, expect, it } from 'vitest';

import { filterPublishedProfilePhotos, filterOwnerPublishedPhotoPage } from './profile-published-photo-filter.policy';

describe('filterPublishedProfilePhotos', () => {
  const photos = [
    { id: 'publicada', url: 'https://example.test/publicada.jpg' },
    { id: 'preparo', url: 'https://example.test/preparo.jpg' },
    { id: 'sem-publicacao', url: 'https://example.test/sem-publicacao.jpg' },
    { id: 'outra-conta', url: 'https://example.test/outra.jpg' },
  ];

  const publications = {
    publicada: { ownerUid: 'autor-1', isPublished: true },
    preparo: { ownerUid: 'autor-1', isPublished: false },
    'outra-conta': { ownerUid: 'autor-2', isPublished: true },
  };

  it('mostra somente mídias efetivamente publicadas para o proprietário', () => {
    expect(filterPublishedProfilePhotos(photos, publications, 'autor-1')).toEqual([
      photos[0],
    ]);
  });

  it('não cria uma galeria somente eu para uploads sem publicação', () => {
    expect(filterPublishedProfilePhotos([photos[1], photos[2]], publications, 'autor-1')).toEqual([]);
  });

  it('recusa configurações de outro proprietário e UID ausente', () => {
    expect(filterPublishedProfilePhotos(photos, publications, 'autor-2')).toEqual([
      photos[3],
    ]);
    expect(filterPublishedProfilePhotos(photos, publications, '')).toEqual([]);
  });

  it('mantém a ordem das publicações sem modificar os dados originais', () => {
    const original = [...photos];
    const result = filterPublishedProfilePhotos(photos, publications, 'autor-1');
    expect(result).toEqual([photos[0]]);
    expect(photos).toEqual(original);
  });
});

describe('filterOwnerPublishedPhotoPage', () => {
  it('não confia em IDs vazios, mistura de proprietários ou ausência de sessão', () => {
    const page = [
      { id: 'a', ownerUid: 'owner', url: 'https://example.test/a' },
      { id: 'a', ownerUid: 'other', url: 'https://example.test/other' },
      { id: ' ', ownerUid: 'owner', url: 'https://example.test/empty' },
    ];
    expect(filterOwnerPublishedPhotoPage(page, 'owner')).toEqual([page[0]]);
    expect(filterOwnerPublishedPhotoPage(page, '')).toEqual([]);
  });
});
