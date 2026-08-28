import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

import { IPublicPhotoProjection } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';

const OWNER_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Hidrata o resumo público do proprietário de fotos legadas/recentes.
 *
 * A identidade continua tendo public_profiles como fonte canônica; a consulta
 * é feita em lote e reaproveita o cache sensível já mantido por sessão em
 * UserDiscoveryQueryService.
 */
@Injectable({ providedIn: 'root' })
export class PublicPhotoOwnerEnrichmentService {
  private readonly discoveryQuery = inject(UserDiscoveryQueryService);

  enrich$(
    projections: readonly IPublicPhotoProjection[]
  ): Observable<IPublicPhotoProjection[]> {
    const items = [...(projections ?? [])];
    const ownerUids = Array.from(
      new Set(
        items
          .map((item) => String(item?.ownerUid ?? '').trim())
          .filter(Boolean)
      )
    );

    if (!ownerUids.length) {
      return of(items);
    }

    return this.discoveryQuery
      .getProfilesByUids$(ownerUids, {
        cacheTTL: OWNER_PROFILE_CACHE_TTL_MS,
      })
      .pipe(
        map((profiles) => {
          const byUid = new Map<string, IUserDados>();

          for (const profile of profiles ?? []) {
            const uid = String(profile?.uid ?? '').trim();
            if (uid) byUid.set(uid, profile);
          }

          return items.map((item) =>
            this.withOwnerProfile(item, byUid.get(item.ownerUid) ?? null)
          );
        })
      );
  }

  private withOwnerProfile(
    projection: IPublicPhotoProjection,
    owner: IUserDados | null
  ): IPublicPhotoProjection {
    if (!owner) {
      return projection;
    }

    return {
      ...projection,
      ownerNickname: this.preferText(owner.nickname, projection.ownerNickname),
      ownerPhotoURL: this.preferText(owner.photoURL, projection.ownerPhotoURL),
      ownerGender: this.preferText(owner.gender, projection.ownerGender),
      ownerOrientation: this.preferText(
        owner.orientation,
        projection.ownerOrientation
      ),
      ownerMunicipio: this.preferText(
        owner.municipio,
        projection.ownerMunicipio
      ),
      ownerEstado: this.preferText(owner.estado, projection.ownerEstado),
    };
  }

  private preferText(preferred: unknown, fallback: unknown): string | null {
    return this.cleanText(preferred) ?? this.cleanText(fallback);
  }

  private cleanText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text || null;
  }
}
