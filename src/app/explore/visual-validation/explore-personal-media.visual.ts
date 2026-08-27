import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, defer, of } from 'rxjs';
import { shareReplay } from 'rxjs/operators';

import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';

export interface ExplorePersonalMediaContext {
  readonly friendUids: readonly string[];
  readonly compatibleOwnerUids: readonly string[];
  readonly personalPhotos: readonly IPublicPhotoItem[];
  readonly personalVideos: readonly IPublicVideoItem[];
  readonly hasMorePersonalMedia: boolean;
  readonly loadingInitialPersonalMedia: boolean;
  readonly loadingMorePersonalMedia: boolean;
  readonly personalMediaLoadFailed: boolean;
}

const VISUAL_PHOTOS: readonly IPublicPhotoItem[] = [
  photo('photo-friend-1', 'visual-friend', 'Camila', 12),
  photo('photo-friend-2', 'visual-friend', 'Camila', 28),
  photo('photo-compatible-1a', 'visual-compatible-1', 'Marina', 18),
  photo('photo-compatible-1b', 'visual-compatible-1', 'Marina', 42),
  photo('photo-compatible-2a', 'visual-compatible-2', 'Rafael', 24),
  photo('photo-compatible-2b', 'visual-compatible-2', 'Rafael', 55),
];

const VISUAL_VIDEOS: readonly IPublicVideoItem[] = [
  video('video-friend', 'visual-friend', 'Camila', 'Encontro no fim da tarde', 16),
  video('video-compatible-1', 'visual-compatible-1', 'Marina', 'Um pouco do meu dia', 35),
  video('video-compatible-2', 'visual-compatible-2', 'Rafael', 'Passeio pela cidade', 48),
];

/**
 * Fonte determinística exclusiva do harness visual de `/descobrir`.
 *
 * SUPRESSÃO EXPLÍCITA DO HARNESS:
 * - não pagina Firestore;
 * - não carrega perfis/amizades reais;
 * - não grava estado.
 *
 * O parâmetro `ownerMore=1`, combinado com `visualState=empty`, simula apenas
 * o contrato visual "não há mídia neste lote, mas ainda existem autores".
 */
@Injectable({ providedIn: 'root' })
export class ExplorePersonalMediaService {
  private readonly router = inject(Router);

  readonly context$: Observable<ExplorePersonalMediaContext> = defer(() => {
    const query = String(this.router.url ?? '').split('?')[1] ?? '';
    const params = new URLSearchParams(query);
    const empty = params.get('visualState') === 'empty';
    const ownerMore = empty && params.get('ownerMore') === '1';

    return of({
      friendUids: empty ? [] : ['visual-friend'],
      compatibleOwnerUids: [
        'visual-compatible-1',
        'visual-compatible-2',
        'visual-compatible-3',
      ],
      personalPhotos: empty ? [] : [...VISUAL_PHOTOS],
      personalVideos: empty ? [] : [...VISUAL_VIDEOS],
      hasMorePersonalMedia: ownerMore,
      loadingInitialPersonalMedia: false,
      loadingMorePersonalMedia: false,
      personalMediaLoadFailed: false,
    });
  }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  loadMore$(): Observable<boolean> {
    return of(false);
  }
}

function photo(
  id: string,
  ownerUid: string,
  ownerNickname: string,
  minutesAgo: number
): IPublicPhotoItem {
  const publishedAt = Date.now() - minutesAgo * 60_000;

  return {
    id,
    ownerUid,
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    url: 'assets/imagem-padrao.webp',
    createdAt: publishedAt,
    publishedAt,
    visibility: 'PUBLIC',
    orderIndex: 0,
    commentsEnabled: true,
    reactionsEnabled: true,
    moderationStatus: 'APPROVED',
    ownerNickname,
    ownerPhotoURL: null,
    ownerGender: null,
    ownerOrientation: null,
    ownerMunicipio: 'Rio de Janeiro',
    ownerEstado: 'RJ',
    reactionsCount: 12,
    commentsCount: 3,
    viewsCount: 80,
  } as IPublicPhotoItem;
}

function video(
  id: string,
  ownerUid: string,
  nickname: string,
  title: string,
  minutesAgo: number
): IPublicVideoItem {
  const publishedAt = Date.now() - minutesAgo * 60_000;

  return {
    id,
    ownerUid,
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'SIGNED_URL',
    title,
    description: null,
    alt: title,
    mimeType: 'video/mp4',
    sizeBytes: 2_048,
    durationMs: 42_000,
    createdAt: publishedAt,
    publishedAt,
    updatedAt: publishedAt,
    lastViewedAt: null,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    moderationReason: null,
    reactionsEnabled: true,
    commentsEnabled: true,
    ratingsEnabled: true,
    viewsCount: 120,
    uniqueViewersCount: 76,
    reactionsCount: 18,
    commentsCount: 4,
    ratingsCount: 0,
    ratingAverage: 0,
    reportsCount: 0,
    openReportsCount: 0,
    confirmedReportsCount: 0,
    viewScore: 0,
    engagementScore: 0,
    score: 0,
    scoreBreakdown: {
      rankingScore: 0,
      qualityScore: 0,
      engagementScore: 0,
      safetyScore: 100,
    },
    owner: {
      nickname,
      photoURL: null,
      gender: null,
      orientation: null,
      municipio: 'Rio de Janeiro',
      estado: 'RJ',
    },
    url: null,
    posterUrl: 'assets/imagem-padrao.webp',
    accessExpiresAt: Date.now() + 60 * 60_000,
  };
}
