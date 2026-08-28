import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { IPublicVideoProjection } from 'src/app/core/interfaces/media/i-public-video-item';
import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { PublicVideoOwnerEnrichmentService } from './public-video-owner-enrichment.service';

describe('PublicVideoOwnerEnrichmentService', () => {
  it('hidrata autores em lote a partir de public_profiles', async () => {
    const getProfilesByUids$ = vi.fn(() => of([
      {
        uid: 'owner-1',
        nickname: 'prfseves RJ',
        photoURL: 'https://example.test/avatar.webp',
        gender: 'mulher',
        orientation: 'heterossexual',
        municipio: 'Rio de Janeiro',
        estado: 'RJ',
      },
    ] as any));

    TestBed.configureTestingModule({
      providers: [
        PublicVideoOwnerEnrichmentService,
        {
          provide: UserDiscoveryQueryService,
          useValue: { getProfilesByUids$ },
        },
      ],
    });

    const service = TestBed.inject(PublicVideoOwnerEnrichmentService);
    const result = await firstValueFrom(service.enrich$([
      projection('video-1', 'owner-1'),
      projection('video-2', 'owner-1'),
    ]));

    expect(getProfilesByUids$).toHaveBeenCalledTimes(1);
    expect(getProfilesByUids$).toHaveBeenCalledWith(
      ['owner-1'],
      { cacheTTL: 300_000 }
    );
    expect(result[0].owner).toEqual({
      nickname: 'prfseves RJ',
      photoURL: 'https://example.test/avatar.webp',
      gender: 'mulher',
      orientation: 'heterossexual',
      municipio: 'Rio de Janeiro',
      estado: 'RJ',
    });
    expect(result[1].owner?.nickname).toBe('prfseves RJ');
  });

  it('preserva resumo já existente quando o perfil público não é retornado', async () => {
    TestBed.configureTestingModule({
      providers: [
        PublicVideoOwnerEnrichmentService,
        {
          provide: UserDiscoveryQueryService,
          useValue: { getProfilesByUids$: vi.fn(() => of([])) },
        },
      ],
    });

    const service = TestBed.inject(PublicVideoOwnerEnrichmentService);
    const source = projection('video-1', 'owner-1', {
      nickname: 'Autor legado',
      photoURL: null,
      gender: null,
      orientation: null,
      municipio: null,
      estado: null,
    });
    const result = await firstValueFrom(service.enrich$([source]));

    expect(result[0]).toBe(source);
    expect(result[0].owner?.nickname).toBe('Autor legado');
  });
});

function projection(
  id: string,
  ownerUid: string,
  owner: IPublicVideoProjection['owner'] = null
): IPublicVideoProjection {
  return {
    id,
    ownerUid,
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'NONE',
    title: 'Vídeo',
    description: null,
    alt: 'Vídeo',
    mimeType: 'video/mp4',
    sizeBytes: 1_024,
    durationMs: 10_000,
    createdAt: 1,
    publishedAt: 1,
    updatedAt: 1,
    lastViewedAt: null,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    moderationReason: null,
    reactionsEnabled: true,
    commentsEnabled: true,
    ratingsEnabled: true,
    viewsCount: 0,
    uniqueViewersCount: 0,
    reactionsCount: 0,
    commentsCount: 0,
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
    owner,
  };
}
