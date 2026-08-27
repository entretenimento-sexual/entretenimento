import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

import { IPublicVideoProjection } from 'src/app/core/interfaces/media/i-public-video-item';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';

const OWNER_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Hidrata somente o resumo público do proprietário de vídeos.
 *
 * A identidade do autor continua vindo de public_profiles; não duplicamos
 * nickname/foto/localização em cada publicação e não fazemos consulta N+1.
 */
@Injectable({ providedIn: 'root' })
export class PublicVideoOwnerEnrichmentService {
  private readonly discoveryQuery = inject(UserDiscoveryQueryService);

  enrich$(
    projections: readonly IPublicVideoProjection[]
  ): Observable<IPublicVideoProjection[]> {
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
    projection: IPublicVideoProjection,
    owner: IUserDados | null
  ): IPublicVideoProjection {
    if (!owner) {
      return projection;
    }

    const current = projection.owner;

    return {
      ...projection,
      owner: {
        nickname: this.preferText(owner.nickname, current?.nickname),
        photoURL: this.preferText(owner.photoURL, current?.photoURL),
        gender: this.preferText(owner.gender, current?.gender),
        orientation: this.preferText(owner.orientation, current?.orientation),
        municipio: this.preferText(owner.municipio, current?.municipio),
        estado: this.preferText(owner.estado, current?.estado),
      },
    };
  }

  private preferText(
    preferred: unknown,
    fallback: unknown
  ): string | null {
    const preferredText = this.cleanText(preferred);
    return preferredText ?? this.cleanText(fallback);
  }

  private cleanText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text || null;
  }
}
