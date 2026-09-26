import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import {
  IPublicPhotoItem,
  IPublicPhotoProjection,
} from 'src/app/core/interfaces/media/i-public-photo-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { MediaApplicationErrorService } from './media-application-error.service';
import { buildPublicMediaAccessCacheKey } from './public-media-access-cache-key';
import { PublicPhotoOwnerEnrichmentService } from './public-photo-owner-enrichment.service';

interface PublicPhotoAccessRequestItem {
  ownerUid: string;
  photoId: string;
}

interface PublicPhotoAccessRequest {
  items: PublicPhotoAccessRequestItem[];
}

interface PublicPhotoAccessResponseItem {
  ownerUid: string;
  photoId: string;
  url: string;
  expiresAt: number;
}

interface PublicPhotoAccessResponse {
  items: PublicPhotoAccessResponseItem[];
}

interface PublicPhotoAccessCacheEntry {
  url: string;
  expiresAt: number;
}

const MAX_ITEMS_PER_REQUEST = 32;
const CACHE_EXPIRY_SAFETY_MS = 30_000;
export const PUBLIC_PHOTO_ACCESS_CACHE_MAX_ENTRIES = 192;

export function isSupportedPublicPhotoAccessAudience(value: unknown): boolean {
  const visibility = String(value ?? '').trim().toUpperCase();
  return visibility === 'PUBLIC' || visibility === 'FRIENDS';
}

@Injectable({ providedIn: 'root' })
export class PublicPhotoAccessService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly functions = inject(Functions);
  private readonly ownerEnrichment = inject(PublicPhotoOwnerEnrichmentService);
  private readonly accessCache = new Map<
    string,
    PublicPhotoAccessCacheEntry
  >();
  private lastSessionUid: string | null | undefined = undefined;

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly authSession: AuthSessionService,
    private readonly errorHandler: MediaApplicationErrorService
  ) {
    this.authSession.uid$
      .pipe(
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((uid) => {
        const normalizedUid = uid?.trim() || null;

        if (this.lastSessionUid !== normalizedUid) {
          this.accessCache.clear();
        }

        this.lastSessionUid = normalizedUid;
      });
  }

  hydratePublicPhotoUrls$(
    projections: readonly IPublicPhotoProjection[]
  ): Observable<IPublicPhotoItem[]> {
    return this.ownerEnrichment.enrich$(projections).pipe(
      switchMap((enriched) => this.hydrateAccess$(enriched))
    );
  }

  private hydrateAccess$(
    projections: readonly IPublicPhotoProjection[]
  ): Observable<IPublicPhotoItem[]> {
    const eligible = projections.filter((projection) =>
      this.isEligibleProjection(projection)
    );

    if (!eligible.length) {
      return of([]);
    }

    const sessionScope = this.currentSessionScope();
    const resolvedUrls = new Map<string, string>();
    const projectionByIdentity = new Map(
      eligible.map((projection) => [
        this.buildIdentityKey(projection.ownerUid, projection.id),
        projection,
      ])
    );
    const pending: IPublicPhotoProjection[] = [];
    const now = Date.now();

    for (const projection of eligible) {
      const cacheKey = this.buildCacheKey(projection, sessionScope);
      const cached = this.getCachedAccess(cacheKey, now);

      if (cached) {
        resolvedUrls.set(
          this.buildIdentityKey(projection.ownerUid, projection.id),
          cached.url
        );
        continue;
      }

      pending.push(projection);
    }

    if (!pending.length) {
      return of(this.materializeItems(eligible, resolvedUrls));
    }

    const requests = this.chunkItems(pending, MAX_ITEMS_PER_REQUEST).map(
      (chunk) => this.requestAccessUrls$(chunk)
    );

    return forkJoin(requests).pipe(
      map((responses) => {
        if (sessionScope !== this.currentSessionScope()) {
          return [];
        }

        for (const response of responses) {
          for (const accessItem of response.items) {
            const identityKey = this.buildIdentityKey(
              accessItem.ownerUid,
              accessItem.photoId
            );
            const projection = projectionByIdentity.get(identityKey);

            if (!projection || !this.isHttpUrl(accessItem.url)) {
              continue;
            }

            resolvedUrls.set(identityKey, accessItem.url);
            this.setCachedAccess(
              this.buildCacheKey(projection, sessionScope),
              {
                url: accessItem.url,
                expiresAt: accessItem.expiresAt,
              }
            );
          }
        }

        return this.materializeItems(eligible, resolvedUrls);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private requestAccessUrls$(
    projections: readonly IPublicPhotoProjection[]
  ): Observable<PublicPhotoAccessResponse> {
    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        PublicPhotoAccessRequest,
        PublicPhotoAccessResponse
      >(this.functions, 'getPublicPhotoAccessUrls');
      const response = await callable({
        items: projections.map((projection) => ({
          ownerUid: projection.ownerUid,
          photoId: projection.id,
        })),
      });

      return response.data;
    }).pipe(
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'requestAccessUrls$',
          count: projections.length,
        });

        return throwError(() => error);
      })
    );
  }

  private materializeItems(
    projections: readonly IPublicPhotoProjection[],
    resolvedUrls: ReadonlyMap<string, string>
  ): IPublicPhotoItem[] {
    return projections.flatMap((projection) => {
      const url = resolvedUrls.get(
        this.buildIdentityKey(projection.ownerUid, projection.id)
      );

      if (!url) {
        return [];
      }

      return [{
        ...projection,
        url,
      }];
    });
  }

  private isEligibleProjection(
    projection: IPublicPhotoProjection
  ): boolean {
    return (
      !!projection.ownerUid?.trim() &&
      !!projection.id?.trim() &&
      isSupportedPublicPhotoAccessAudience(projection.visibility) &&
      projection.moderationStatus === 'APPROVED' &&
      projection.assetAccess === 'SIGNED_URL'
    );
  }

  private buildCacheKey(
    projection: IPublicPhotoProjection,
    sessionScope = this.currentSessionScope()
  ): string {
    const mediaKey = buildPublicMediaAccessCacheKey({
      namespace: 'public-photo-access',
      ownerUid: projection.ownerUid,
      mediaId: projection.id,
      assetVersion: projection.assetVersion,
      publishedAt: projection.publishedAt,
    });

    return `${sessionScope}:${mediaKey}`;
  }

  private currentSessionScope(): string {
    if (this.lastSessionUid === undefined) {
      return 'session:pending';
    }

    return this.lastSessionUid
      ? `session:uid:${this.lastSessionUid}`
      : 'session:anonymous';
  }

  private getCachedAccess(
    cacheKey: string,
    now: number
  ): PublicPhotoAccessCacheEntry | null {
    const cached = this.accessCache.get(cacheKey);

    if (
      !cached ||
      !this.isHttpUrl(cached.url) ||
      !Number.isFinite(cached.expiresAt) ||
      cached.expiresAt <= now + CACHE_EXPIRY_SAFETY_MS
    ) {
      if (cached) {
        this.accessCache.delete(cacheKey);
      }
      return null;
    }

    // Map mantém ordem de inserção: remover + reinserir promove para MRU.
    this.accessCache.delete(cacheKey);
    this.accessCache.set(cacheKey, cached);
    return cached;
  }

  private setCachedAccess(
    cacheKey: string,
    entry: PublicPhotoAccessCacheEntry
  ): void {
    if (
      !cacheKey ||
      !this.isHttpUrl(entry.url) ||
      !Number.isFinite(entry.expiresAt)
    ) {
      return;
    }

    this.accessCache.delete(cacheKey);
    this.accessCache.set(cacheKey, entry);
    this.enforceAccessCacheLimit();
  }

  private enforceAccessCacheLimit(): void {
    while (
      this.accessCache.size >
      PUBLIC_PHOTO_ACCESS_CACHE_MAX_ENTRIES
    ) {
      const oldestKey = this.accessCache.keys().next().value as
        | string
        | undefined;

      if (!oldestKey) {
        break;
      }

      this.accessCache.delete(oldestKey);
    }
  }

  private buildIdentityKey(ownerUid: string, photoId: string): string {
    return `${ownerUid.trim()}:${photoId.trim()}`;
  }

  private chunkItems<T>(items: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(String(value ?? '').trim());
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('Erro ao autorizar acesso temporário à foto.');

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'PublicPhotoAccessService',
        ...context,
      };
      (normalizedError as any).skipUserNotification = true;

      this.errorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
