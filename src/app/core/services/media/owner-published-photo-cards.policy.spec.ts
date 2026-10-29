import { describe, expect, it } from 'vitest';

import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPhotoPublicationConfig } from 'src/app/core/interfaces/media/i-photo-publication-config';
import { mapOwnerPublishedPhotoCards } from './owner-published-photo-cards.policy';

const owner = 'galeria_teste02';
const defaultConfig = (ownerUid: string, photoId: string): IPhotoPublicationConfig => ({
  photoId, ownerUid, isPublished: false, visibility: 'PRIVATE',
});
const photo = (index: number): IPublicPhotoItem => ({
  id: `photo-${index}`,
  ownerUid: owner,
  visibility: index % 2 ? 'FRIENDS' : 'PUBLIC',
  moderationStatus: 'APPROVED',
  publishedAt: 2000 + index,
  assetVersion: 2000 + index,
  createdAt: 1000 + index,
  orderIndex: index,
  url: `https://example.test/authorized/${index}`,
});

describe('cards da galeria sem consulta a originais privados', () => {
  it('preserva 32 fotos PUBLIC/FRIENDS, IDs e URLs autorizadas', () => {
    const items = Array.from({ length: 32 }, (_, i) => photo(i));
    const cards = mapOwnerPublishedPhotoCards(owner, items, {}, defaultConfig);
    expect(cards).toHaveLength(32);
    expect(new Set(cards.map((item) => item.id)).size).toBe(32);
    expect(cards.filter((item) => item.visibility === 'FRIENDS')).toHaveLength(16);
    expect(cards.map((item) => item.url)).toEqual(items.map((item) => item.url));
    expect(cards.every((item) => item.publication.isPublished)).toBe(true);
    expect(cards.every((item) => !('path' in item))).toBe(true);
    expect(cards.every((item) => !('fileName' in item))).toBe(true);
  });

  it('não mistura dados de outra conta nem repete itens entre páginas', () => {
    const items = [photo(1), photo(2), photo(1), { ...photo(3), ownerUid: 'other' }];
    const cards = mapOwnerPublishedPhotoCards(owner, items, {}, defaultConfig);
    expect(cards.map((item) => item.id)).toEqual(['photo-1', 'photo-2']);
    expect(mapOwnerPublishedPhotoCards('', items, {}, defaultConfig)).toEqual([]);
  });

  it('usa data canônica, mantém null explícito e não inventa data para legado', () => {
    const items = [photo(1), photo(2), photo(3)];
    const configs = {
      'photo-1': { ...defaultConfig(owner, 'photo-1'), isPublished: true,
        visibility: 'FRIENDS' as const, displayDate: 1_695_000_000_000 },
      'photo-2': { ...defaultConfig(owner, 'photo-2'), isPublished: true,
        visibility: 'PUBLIC' as const, displayDate: null },
    };
    const cards = mapOwnerPublishedPhotoCards(owner, items, configs, defaultConfig);
    expect(cards[0].displayDate).toBe(1_695_000_000_000);
    expect(cards[1].displayDate).toBeNull();
    expect(cards[2].displayDate).toBeUndefined();
    expect(cards[2].createdAt).toBe(items[2].createdAt);
  });

  it('não usa configuração privada de outro dono ou publicação inativa', () => {
    const configs = {
      'photo-1': { ...defaultConfig('foreign', 'photo-1'), isPublished: true,
        displayDate: 123 },
      'photo-2': { ...defaultConfig(owner, 'photo-2'), isPublished: false,
        displayDate: 456 },
    };
    const cards = mapOwnerPublishedPhotoCards(owner, [photo(1), photo(2)],
      configs, defaultConfig);
    // A publicação explicitamente desativada não volta por uma projeção atrasada.
    expect(cards.map((c) => c.id)).toEqual(['photo-1']);
    expect(cards.map((c) => c.displayDate)).toEqual([undefined]);
    expect(cards.every((c) => c.publication.isPublished)).toBe(true);
  });
});
