// src/app/core/services/media/public-media-snapshot.service.ts
// -----------------------------------------------------------------------------
// PUBLIC MEDIA SNAPSHOT SERVICE
// -----------------------------------------------------------------------------
// Cache curto e defensivo somente para projeções públicas de mídia.
// Não armazena mídia privada, mensagens, tokens ou dados financeiros.
// -----------------------------------------------------------------------------
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';

export type PublicMediaSnapshotKind = 'top-photos' | 'boosted-photos';

const PUBLIC_MEDIA_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const MAX_PUBLIC_MEDIA_SNAPSHOT_ITEMS = 48;

@Injectable({ providedIn: 'root' })
export class PublicMediaSnapshotService {
  private readonly cache = inject(CacheService);

  read$(kind: PublicMediaSnapshotKind): Observable<IPublicPhotoItem[]> {
    return this.cache
      .get<unknown>(this.cacheKey(kind))
      .pipe(
        take(1),
        map((value) => this.normalizeItems(value))
      );
  }

  write(kind: PublicMediaSnapshotKind, items: readonly IPublicPhotoItem[]): void {
    const normalized = this.normalizeItems(items);

    this.cache.set(
      this.cacheKey(kind),
      normalized,
      PUBLIC_MEDIA_SNAPSHOT_TTL_MS,
      { persist: true }
    );
  }

  private cacheKey(kind: PublicMediaSnapshotKind): string {
    return `media:public:snapshot:${kind}`;
  }

  private normalizeItems(value: unknown): IPublicPhotoItem[] {
    if (!Array.isArray(value)) return [];

    const unique = new Map<string, IPublicPhotoItem>();

    for (const item of value.slice(0, MAX_PUBLIC_MEDIA_SNAPSHOT_ITEMS)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

      const candidate = item as IPublicPhotoItem;
      const id = String(candidate.id ?? '').trim();
      if (!id || id.length > 180) continue;

      unique.set(id, candidate);
    }

    return [...unique.values()];
  }
}
