import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { IPublicPhotoProjection } from 'src/app/core/interfaces/media/i-public-photo-item';
import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { PublicPhotoOwnerEnrichmentService } from './public-photo-owner-enrichment.service';

describe('PublicPhotoOwnerEnrichmentService', () => {
  it('hidrata autores de fotos em lote a partir de public_profiles', async () => {
    const getProfilesByUids$ = vi.fn(() => of([
      {
        uid: 'owner-1',
        nickname: 'serale',
        photoURL: 'https://example.test/avatar.webp',
        gender: 'homem',
        orientation: 'heterossexual',
        municipio: 'Rio de Janeiro',
        estado: 'RJ',
      },
    ] as any));

    TestBed.configureTestingModule({
      providers: [
        PublicPhotoOwnerEnrichmentService,
        {
          provide: UserDiscoveryQueryService,
          useValue: { getProfilesByUids$ },
        },
      ],
    });

    const service = TestBed.inject(PublicPhotoOwnerEnrichmentService);
    const result = await firstValueFrom(service.enrich$([
      projection('photo-1', 'owner-1'),
      projection('photo-2', 'owner-1'),
    ]));

    expect(getProfilesByUids$).toHaveBeenCalledTimes(1);
    expect(getProfilesByUids$).toHaveBeenCalledWith(
      ['owner-1'],
      { cacheTTL: 300_000 }
    );
    expect(result[0]).toMatchObject({
      ownerNickname: 'serale',
      ownerPhotoURL: 'https://example.test/avatar.webp',
      ownerGender: 'homem',
      ownerOrientation: 'heterossexual',
      ownerMunicipio: 'Rio de Janeiro',
      ownerEstado: 'RJ',
    });
    expect(result[1].ownerNickname).toBe('serale');
  });

  it('preserva metadados legados quando o public_profile não é retornado', async () => {
    TestBed.configureTestingModule({
      providers: [
        PublicPhotoOwnerEnrichmentService,
        {
          provide: UserDiscoveryQueryService,
          useValue: { getProfilesByUids$: vi.fn(() => of([])) },
        },
      ],
    });

    const service = TestBed.inject(PublicPhotoOwnerEnrichmentService);
    const source = projection('photo-1', 'owner-1', 'Autor legado');
    const result = await firstValueFrom(service.enrich$([source]));

    expect(result[0]).toBe(source);
    expect(result[0].ownerNickname).toBe('Autor legado');
  });
});

function projection(
  id: string,
  ownerUid: string,
  ownerNickname: string | null = null
): IPublicPhotoProjection {
  return {
    id,
    ownerUid,
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    createdAt: 1,
    publishedAt: 1,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    ownerNickname,
  };
}
