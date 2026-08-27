import { describe, expect, it } from 'vitest';

import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { buildPublicMediaIdentity } from './public-media-identity';
import { composePublicProfileMediaPriority } from './public-profile-media-priority';

function photo(id: string, publishedAt: number): IPublicPhotoItem {
  return {
    id,
    ownerUid: `owner-${id}`,
    mediaType: 'PHOTO',
    url: `https://example.test/${id}.jpg`,
    createdAt: publishedAt,
    publishedAt,
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    orderIndex: 0,
  } as IPublicPhotoItem;
}

function video(id: string, publishedAt: number): IPublicVideoItem {
  return {
    id,
    ownerUid: `owner-${id}`,
    mediaType: 'VIDEO',
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    publishedAt,
    createdAt: publishedAt,
    title: id,
    url: null,
    posterUrl: null,
  } as IPublicVideoItem;
}

describe('composePublicProfileMediaPriority', () => {
  it('preserva cronologia quando diversidade de tipo não é solicitada', () => {
    const items = composePublicProfileMediaPriority([
      video('v1', 500),
      video('v2', 400),
      video('v3', 300),
      photo('p1', 200),
    ]);

    expect(items.map((item) => item.id)).toEqual(['v1', 'v2', 'v3', 'p1']);
  });

  it('evita mais de duas mídias consecutivas do mesmo tipo quando há alternativa', () => {
    const items = composePublicProfileMediaPriority(
      [
        video('v1', 500),
        video('v2', 400),
        video('v3', 300),
        photo('p1', 200),
        photo('p2', 100),
      ],
      { maxConsecutiveSameType: 2 }
    );

    expect(items.map((item) => item.id)).toEqual([
      'v1',
      'v2',
      'p1',
      'v3',
      'p2',
    ]);
  });

  it('não cria slot social extra para satisfazer diversidade de tipo', () => {
    const friendPhoto = {
      ...photo('friend', 600),
      ownerUid: 'friend-owner',
    } as IPublicPhotoItem;
    const compatibleVideo = {
      ...video('compatible', 550),
      ownerUid: 'compatible-owner',
    } as IPublicVideoItem;
    const items = composePublicProfileMediaPriority(
      [
        friendPhoto,
        compatibleVideo,
        photo('g1', 500),
        photo('g2', 400),
        video('g3', 300),
        video('g4', 200),
      ],
      {
        connectionOwnerUids: ['friend-owner'],
        compatibleOwnerUids: ['compatible-owner'],
        maxConsecutiveSameType: 2,
      }
    );

    expect(items.slice(0, 6).map((item) => item.ownerUid)).toEqual([
      'friend-owner',
      'owner-g1',
      'owner-g3',
      'compatible-owner',
      'owner-g2',
      'owner-g4',
    ]);
    expect(items[0]?.ownerUid).toBe('friend-owner');
    expect(items[3]?.ownerUid).toBe('compatible-owner');
    expect(items.slice(0, 6).map((item) => item.mediaType)).toEqual([
      'PHOTO',
      'PHOTO',
      'VIDEO',
      'VIDEO',
      'PHOTO',
      'VIDEO',
    ]);
  });

  it('mantém mídia social já vista depois de qualquer mídia inédita', () => {
    const seenConnection = {
      ...photo('seen-connection', 900),
      ownerUid: 'connection-owner',
    } as IPublicPhotoItem;
    const freshGlobal = {
      ...photo('fresh-global', 100),
      ownerUid: 'global-owner',
    } as IPublicPhotoItem;
    const seenKey = buildPublicMediaIdentity(
      'PHOTO',
      seenConnection.ownerUid,
      seenConnection.id
    );

    const items = composePublicProfileMediaPriority(
      [seenConnection, freshGlobal],
      {
        connectionOwnerUids: ['connection-owner'],
        recentViewedKeys: [seenKey],
      }
    );

    expect(items.map((item) => item.id)).toEqual([
      'fresh-global',
      'seen-connection',
    ]);
  });
});
