// src/app/core/services/media/public-media-snapshot.service.ts
// -----------------------------------------------------------------------------
// PUBLIC MEDIA SNAPSHOT SERVICE
// -----------------------------------------------------------------------------
// Cache curto e defensivo somente para projeções públicas de fotos.
//
// Fronteira:
// - persiste somente projeções, nunca URLs temporárias de acesso;
// - cada snapshot persistido pertence ao UID autenticado que o gerou;
// - troca/logout de sessão invalida os snapshots conhecidos da sessão anterior;
// - a reidratação de URL volta a passar pela fronteira canônica de acesso.
// -----------------------------------------------------------------------------
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import {
  IPublicPhotoItem,
  IPublicPhotoProjection,
} from 'src/app/core/interfaces/media/i-public-photo-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { PublicPhotoAccessService } from './public-photo-access.service';

export type PublicMediaSnapshotKind =
  | 'latest-photos'
  | 'top-photos';

const PUBLIC_MEDIA_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const MAX_PUBLIC_MEDIA_SNAPSHOT_ITEMS = 48;
const LEGACY_PUBLIC_MEDIA_SNAPSHOT_PREFIX = 'media:public:snapshot:';

@Injectable({ providedIn: 'root' })
export class PublicMediaSnapshotService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly cache = inject(CacheService);
  private readonly authSession = inject(AuthSessionService);
  private readonly publicPhotoAccess = inject(PublicPhotoAccessService);

  private readonly sessionUid$ = combineLatest([
    this.authSession.ready$,
    this.authSession.uid$,
  ]).pipe(
    filter(([ready]) => ready === true),
    map(([, uid]) => uid?.trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private lastSessionUid: string | null | undefined = undefined;

  constructor() {
    // Remove o formato legado que podia conter IPublicPhotoItem com URL assinada.
    this.clearLegacySnapshotKeys();

    this.sessionUid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        if (
          this.lastSessionUid !== undefined &&
          this.lastSessionUid !== uid &&
          this.lastSessionUid
        ) {
          this.clearSessionSnapshots(this.lastSessionUid);
        }

        this.lastSessionUid = uid;
      });
  }

  read$(kind: PublicMediaSnapshotKind): Observable<IPublicPhotoItem[]> {
    return this.sessionUid$.pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) {
          return of([] as IPublicPhotoItem[]);
        }

        return this.cache.get<unknown>(this.cacheKey(kind, uid)).pipe(
          take(1),
          map((value) => this.normalizeProjections(value)),
          switchMap((projections) => {
            if (!projections.length) {
              return of([] as IPublicPhotoItem[]);
            }

            return this.publicPhotoAccess
              .hydratePublicPhotoUrls$(projections)
              .pipe(
                // Snapshot é best-effort. A carga online seguinte continua
                // responsável pelo feedback de indisponibilidade ao usuário.
                catchError(() => of([] as IPublicPhotoItem[]))
              );
          })
        );
      }),
      take(1)
    );
  }

  write(
    kind: PublicMediaSnapshotKind,
    items: readonly IPublicPhotoProjection[]
  ): void {
    const normalized = this.normalizeProjections(items);

    this.sessionUid$
      .pipe(take(1))
      .subscribe((uid) => {
        if (!uid) {
          return;
        }

        this.cache.set(
          this.cacheKey(kind, uid),
          normalized,
          PUBLIC_MEDIA_SNAPSHOT_TTL_MS,
          { persist: true }
        );
      });
  }

  private cacheKey(kind: PublicMediaSnapshotKind, uid: string): string {
    return `${LEGACY_PUBLIC_MEDIA_SNAPSHOT_PREFIX}uid:${uid}:${kind}`;
  }

  private clearSessionSnapshots(uid: string): void {
    for (const kind of this.snapshotKinds()) {
      this.cache.delete(this.cacheKey(kind, uid));
    }
  }

  private clearLegacySnapshotKeys(): void {
    for (const kind of this.snapshotKinds()) {
      this.cache.delete(`${LEGACY_PUBLIC_MEDIA_SNAPSHOT_PREFIX}${kind}`);
    }
  }

  private snapshotKinds(): readonly PublicMediaSnapshotKind[] {
    return ['latest-photos', 'top-photos'];
  }

  private normalizeProjections(value: unknown): IPublicPhotoProjection[] {
    if (!Array.isArray(value)) return [];

    const unique = new Map<string, IPublicPhotoProjection>();

    for (const item of value.slice(0, MAX_PUBLIC_MEDIA_SNAPSHOT_ITEMS)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      const candidate = item as IPublicPhotoProjection;
      const id = String(candidate.id ?? '').trim();
      const ownerUid = String(candidate.ownerUid ?? '').trim();

      if (
        !id ||
        id.length > 180 ||
        !ownerUid ||
        ownerUid.length > 180
      ) {
        continue;
      }

      const projection: Record<string, unknown> = {
        ...(candidate as unknown as Record<string, unknown>),
        id,
        ownerUid,
      };

      // Campos de acesso são efêmeros e nunca atravessam a persistência.
      delete projection['url'];
      delete projection['signedUrl'];
      delete projection['accessUrl'];
      delete projection['expiresAt'];
      delete projection['accessExpiresAt'];

      unique.set(
        `${ownerUid}:${id}`,
        projection as unknown as IPublicPhotoProjection
      );
    }

    return [...unique.values()];
  }
}
