// src/app/core/services/media/public-media-snapshot.service.ts
// -----------------------------------------------------------------------------
// PUBLIC MEDIA SNAPSHOT SERVICE
// -----------------------------------------------------------------------------
// Cache curto e defensivo somente para projeções públicas de mídia.
//
// Fronteira:
// - persiste somente projeções, nunca URLs/tokens temporários de acesso;
// - cada snapshot persistido pertence ao UID autenticado que o gerou;
// - troca/logout de sessão invalida os snapshots conhecidos da sessão anterior;
// - fotos reidratam URL pela fronteira canônica de foto;
// - vídeos reidratam somente preview/poster pela fronteira canônica de vídeo;
// - playback de vídeo nunca nasce do snapshot persistido.
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
import {
  IPublicVideoItem,
  IPublicVideoProjection,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import {
  normalizeOfficialMediaContextProjection,
} from './official-media-context.projection';
import { PublicPhotoAccessService } from './public-photo-access.service';
import { PublicVideoAccessService } from './public-video-access.service';
import { mapPublicVideoProjection } from './public-video-item.mapper';

export type PublicPhotoSnapshotKind =
  | 'latest-photos'
  | 'top-photos';

export type PublicVideoSnapshotKind =
  | 'latest-videos'
  | 'top-videos';

export type PublicMediaSnapshotKind =
  | PublicPhotoSnapshotKind
  | PublicVideoSnapshotKind;

const PUBLIC_MEDIA_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const MAX_PUBLIC_MEDIA_SNAPSHOT_ITEMS = 48;
const PUBLIC_MEDIA_SNAPSHOT_PREFIX = 'media:public:snapshot:';

@Injectable({ providedIn: 'root' })
export class PublicMediaSnapshotService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly cache = inject(CacheService);
  private readonly authSession = inject(AuthSessionService);
  private readonly publicPhotoAccess = inject(PublicPhotoAccessService);
  private readonly publicVideoAccess = inject(PublicVideoAccessService);

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
    // Remove o formato legado sem escopo de UID que podia conter acesso efêmero.
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

  read$(kind: PublicPhotoSnapshotKind): Observable<IPublicPhotoItem[]>;
  read$(kind: PublicVideoSnapshotKind): Observable<IPublicVideoItem[]>;
  read$(
    kind: PublicMediaSnapshotKind
  ): Observable<IPublicPhotoItem[] | IPublicVideoItem[]> {
    return this.sessionUid$.pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) {
          return of([]);
        }

        return this.cache.get<unknown>(this.cacheKey(kind, uid)).pipe(
          take(1),
          map((value) => this.normalizeProjections(kind, value)),
          switchMap((projections) => {
            if (!projections.length) {
              return of([]);
            }

            if (this.isVideoKind(kind)) {
              return this.publicVideoAccess
                .hydratePublicVideoPreviews$(
                  projections as readonly IPublicVideoProjection[]
                )
                .pipe(
                  catchError(() => of([] as IPublicVideoItem[]))
                );
            }

            return this.publicPhotoAccess
              .hydratePublicPhotoUrls$(
                projections as readonly IPublicPhotoProjection[]
              )
              .pipe(
                catchError(() => of([] as IPublicPhotoItem[]))
              );
          })
        );
      }),
      take(1)
    );
  }

  write(
    kind: PublicPhotoSnapshotKind,
    items: readonly IPublicPhotoProjection[]
  ): void;
  write(
    kind: PublicVideoSnapshotKind,
    items: readonly IPublicVideoProjection[]
  ): void;
  write(
    kind: PublicMediaSnapshotKind,
    items: readonly (IPublicPhotoProjection | IPublicVideoProjection)[]
  ): void {
    const normalized = this.normalizeProjections(kind, items);

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
    return `${PUBLIC_MEDIA_SNAPSHOT_PREFIX}uid:${uid}:${kind}`;
  }

  private clearSessionSnapshots(uid: string): void {
    for (const kind of this.snapshotKinds()) {
      this.cache.delete(this.cacheKey(kind, uid));
    }
  }

  private clearLegacySnapshotKeys(): void {
    for (const kind of this.snapshotKinds()) {
      this.cache.delete(`${PUBLIC_MEDIA_SNAPSHOT_PREFIX}${kind}`);
    }
  }

  private snapshotKinds(): readonly PublicMediaSnapshotKind[] {
    return [
      'latest-photos',
      'top-photos',
      'latest-videos',
      'top-videos',
    ];
  }

  private isVideoKind(
    kind: PublicMediaSnapshotKind
  ): kind is PublicVideoSnapshotKind {
    return kind === 'latest-videos' || kind === 'top-videos';
  }

  private normalizeProjections(
    kind: PublicMediaSnapshotKind,
    value: unknown
  ): Array<IPublicPhotoProjection | IPublicVideoProjection> {
    if (!Array.isArray(value)) return [];

    const unique = new Map<
      string,
      IPublicPhotoProjection | IPublicVideoProjection
    >();

    for (const item of value.slice(0, MAX_PUBLIC_MEDIA_SNAPSHOT_ITEMS)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      const sanitized = this.stripEphemeralAccess(
        item as Record<string, unknown>
      );
      const officialMediaContext =
        normalizeOfficialMediaContextProjection(
          sanitized['officialMediaContext']
        );

      if (officialMediaContext) {
        sanitized['officialMediaContext'] = officialMediaContext;
      } else {
        delete sanitized['officialMediaContext'];
      }
      delete sanitized['officialPhoto'];
      const id = String(sanitized['id'] ?? '').trim();
      const ownerUid = String(sanitized['ownerUid'] ?? '').trim();

      if (
        !id ||
        id.length > 180 ||
        !ownerUid ||
        ownerUid.length > 180
      ) {
        continue;
      }

      if (this.isVideoKind(kind)) {
        const projection = mapPublicVideoProjection({
          documentId: id,
          expectedOwnerUid: ownerUid,
          data: sanitized,
        });

        if (!projection) {
          continue;
        }

        unique.set(`${ownerUid}:${id}`, projection);
        continue;
      }

      unique.set(
        `${ownerUid}:${id}`,
        {
          ...(sanitized as unknown as IPublicPhotoProjection),
          id,
          ownerUid,
        }
      );
    }

    return [...unique.values()];
  }

  private stripEphemeralAccess(
    candidate: Record<string, unknown>
  ): Record<string, unknown> {
    const projection = { ...candidate };

    for (const key of [
      'url',
      'posterUrl',
      'signedUrl',
      'accessUrl',
      'expiresAt',
      'accessExpiresAt',
      'playbackToken',
      'retentionToken',
      'retentionTokenExpiresAt',
    ]) {
      delete projection[key];
    }

    return projection;
  }
}
