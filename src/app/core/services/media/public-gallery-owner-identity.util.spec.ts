import { describe, expect, it } from 'vitest';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import {
  publicGalleryOwnerIdentityFromMedia,
  samePublicGalleryOwnerIdentity,
} from './public-gallery-owner-identity.util';

const photo: IPublicPhotoItem = {
  id: 'photo-1',
  ownerUid: 'owner-1',
  ownerIdentityFromPublicProfile: true,
  createdAt: 1,
  publishedAt: 1,
  orderIndex: 0,
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  url: 'https://example.test/authorized.jpg',
  ownerNickname: 'Pessoa pública',
  ownerGender: 'mulher',
  ownerOrientation: 'heterossexual',
  ownerMunicipio: 'Rio de Janeiro',
  ownerEstado: 'RJ',
};

const video = {
  id: 'video-1',
  ownerUid: 'owner-1',
  ownerIdentityFromPublicProfile: true,
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  owner: {
    nickname: 'Casal público',
    photoURL: null,
    gender: 'casal-ele-ela',
    orientation: 'bissexual',
    municipio: 'Rio de Janeiro',
    estado: 'RJ',
  },
} as IPublicVideoItem;

describe('publicGalleryOwnerIdentityFromMedia', () => {
  it('compõe identidade pública canônica da foto autorizada', () => {
    const identity = publicGalleryOwnerIdentityFromMedia('owner-1', [photo]);
    expect(identity).toMatchObject({
      nickname: 'Pessoa pública',
      identityShortLabel: 'Mulher',
      orientationShortLabel: 'Hétero',
      city: 'Rio de Janeiro',
      state: 'RJ',
    });
  });

  it('não infere orientação individual para casal na projeção de vídeo', () => {
    const identity = publicGalleryOwnerIdentityFromMedia('owner-1', [video]);
    expect(identity?.identityShortLabel).toBe('Casal (Ele/Ela)');
    expect(identity?.orientationShortLabel).toBeUndefined();
  });

  it('falha fechado em proprietário diferente, não público ou moderado', () => {
    expect(publicGalleryOwnerIdentityFromMedia('owner-2', [photo])).toBeNull();
    expect(publicGalleryOwnerIdentityFromMedia('owner-1', [
      { ...photo, visibility: 'FRIENDS' },
    ])).toBeNull();
    expect(publicGalleryOwnerIdentityFromMedia('owner-1', [
      { ...photo, moderationStatus: 'HIDDEN' },
    ])).toBeNull();
    expect(publicGalleryOwnerIdentityFromMedia('owner-1', [
      { ...photo, ownerNickname: null },
    ])).toBeNull();
    expect(publicGalleryOwnerIdentityFromMedia('owner-1', [
      { ...photo, ownerIdentityFromPublicProfile: false },
    ])).toBeNull();
    expect(publicGalleryOwnerIdentityFromMedia('owner-1', [
      { ...video, ownerIdentityFromPublicProfile: false },
    ])).toBeNull();

  });

  it('não substitui a identidade durante paginação equivalente', () => {
    const a = publicGalleryOwnerIdentityFromMedia('owner-1', [photo]);
    const b = publicGalleryOwnerIdentityFromMedia('owner-1', [{ ...photo }]);
    expect(samePublicGalleryOwnerIdentity(a, b)).toBe(true);
    expect(samePublicGalleryOwnerIdentity(a, null)).toBe(false);
    expect(samePublicGalleryOwnerIdentity(null, null)).toBe(true);
  });
});
