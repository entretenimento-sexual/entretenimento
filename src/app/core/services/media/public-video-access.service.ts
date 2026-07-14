import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
} from 'rxjs/operators';

import {
  IPublicVideoAccess,
  IPublicVideoItem,
  IPublicVideoProjection,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  buildPublicVideoKey,
  hydratePublicVideoItem,
  isPublicVideoAccessUsable,
  mapPublicVideoProjection,
} from './public-video-item.mapper';

interface PublicVideoAccessRequestItem {
  ownerUid: string;
  videoId: string;
}

interface PublicVideoAccessRequest {
  items: PublicVideoAccessRequestItem[];
}

interface PublicVideoAccessResponse {
  items: IPublicVideoAccess[];
}

const MAX_ITEMS_PER_REQUEST = 16;
const CACHE_EXPIRY_SAFETY_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class PublicVideoAccessService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly functions = inject(Functions);
  private readonly accessCache = new Map<string, IPublicVideoAccess>();
  private readonly inFlightRefreshes = new Map<
    string,
    Observable<IPublicVideoItem | null>
  >();
  private lastSessionUid: string | null | undefined = undefined;

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly authSession: AuthSessionService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {
    this.authSession.uid$
      .pipe(
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((uid) => {
        const normalizedUid = uid?.trim() || null;

        if (
          this.lastSessionUid !== undefined &&
          this.lastSessionUid !== normalizedUid
        ) {
          this.accessCache.clear();
          this.inFlightRefreshes.clear();
        }

        this.lastSessionUid = normalizedUid;
      });
  }

  hydratePublicVideoUrls$(
    projections: readonly IPublicVideoProjection[]
  ): Observable<IPublicVideoItem[]> {
    const eligible = projections.flatMap((candidate) => {
      const projection = this.normalizeProjection(candidate);
      return projection ? [projection] : [];
    });

    if (!eligible.length) {
      return of([]);
    }

    const resolved = new Map<string, IPublicVideoAccess>();
    const pending: IPublicVideoProjection[] = [];
    const now = Date.now();

    for (const projection of eligible) {
      const cacheKey = this.buildCacheKey(projection);
      const cached = this.accessCache.get(cacheKey);

      if (
        cached &&
        cached.expiresAt > now + CACHE_EXPIRY_SAFETY_MS &&
        isPublicVideoAccessUsable(projection, cached, now)
      ) {
        resolved.set(
          buildPublicVideoKey(projection.ownerUid, projection.id),
          cached
        );
        continue;
      }

      if (cached) {
        this.accessCache.delete(cacheKey);
      }

      pending.push(projection);
    }

    if (!pending.length) {
      return of(this.materializeItems(eligible, resolved, now));
    }

    const requests = this.chunkItems(pending, MAX_ITEMS_PER_REQUEST).map(
      (chunk) => this.requestAccessUrls$(chunk)
    );

    return forkJoin(requests).pipe(
      map((responses) => {
        const projectionByIdentity = new Map(
          eligible.map((projection) => [
            buildPublicVideoKey(projection.ownerUid, projection.id),
            projection,
          ])
        );

        for (const response of responses) {
          for (const access of response.items ?? []) {
            const identityKey = buildPublicVideoKey(
              access.ownerUid,
              access.videoId
            );
            const projection = projectionByIdentity.get(identityKey);

            if (!projection || !isPublicVideoAccessUsable(
              projection,
              access,
              now
            )) {
              continue;
            }

            resolved.set(identityKey, access);
            this.accessCache.set(this.buildCacheKey(projection), access);
          }
        }

        return this.materializeItems(eligible, resolved, now);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Renova um único item sem reutilizar a URL cacheada.
   * Chamadas concorrentes para o mesmo vídeo compartilham a mesma requisição.
   */
  refreshPublicVideoUrl$(
    candidate: IPublicVideoProjection
  ): Observable<IPublicVideoItem | null> {
    const projection = this.normalizeProjection(candidate);

    if (!projection) {
      return of(null);
    }

    const identityKey = buildPublicVideoKey(projection.ownerUid, projection.id);
    const inFlight = this.inFlightRefreshes.get(identityKey);

    if (inFlight) {
      return inFlight;
    }

    this.accessCache.delete(this.buildCacheKey(projection));

    const refresh$ = this.requestAccessUrls$([projection]).pipe(
      map((response) => {
        const now = Date.now();
        const access = (response.items ?? []).find((item) =>
          buildPublicVideoKey(item.ownerUid, item.videoId) === identityKey
        );

        if (!access || !isPublicVideoAccessUsable(projection, access, now)) {
          return null;
        }

        this.accessCache.set(this.buildCacheKey(projection), access);
        return hydratePublicVideoItem(projection, access, now);
      }),
      finalize(() => this.inFlightRefreshes.delete(identityKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlightRefreshes.set(identityKey, refresh$);
    return refresh$;
  }

  invalidatePublicVideoAccess(candidate: IPublicVideoProjection): void {
    const projection = this.normalizeProjection(candidate);

    if (!projection) {
      return;
    }

    this.accessCache.delete(this.buildCacheKey(projection));
  }

  private requestAccessUrls$(
    projections: readonly IPublicVideoProjection[]
  ): Observable<PublicVideoAccessResponse> {
    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        PublicVideoAccessRequest,
        PublicVideoAccessResponse
      >(this.functions, 'getPublicVideoAccessUrls');
      const response = await callable({
        items: projections.map((projection) => ({
          ownerUid: projection.ownerUid,
          videoId: projection.id,
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
    projections: readonly IPublicVideoProjection[],
    resolved: ReadonlyMap<string, IPublicVideoAccess>,
    now: number
  ): IPublicVideoItem[] {
    return projections.flatMap((projection) => {
      const access = resolved.get(
        buildPublicVideoKey(projection.ownerUid, projection.id)
      );
      const item = access
        ? hydratePublicVideoItem(projection, access, now)
        : null;

      return item ? [item] : [];
    });
  }

  private normalizeProjection(
    candidate: IPublicVideoProjection
  ): IPublicVideoProjection | null {
    const projection = mapPublicVideoProjection({
      documentId: candidate.id,
      expectedOwnerUid: candidate.ownerUid,
      data: candidate,
    });

    return projection && this.isEligibleProjection(projection)
      ? projection
      : null;
  }

  private isEligibleProjection(
    projection: IPublicVideoProjection
  ): boolean {
    return !!projection.ownerUid?.trim() &&
      !!projection.id?.trim() &&
      projection.mediaType === 'VIDEO' &&
      projection.visibility === 'PUBLIC' &&
      projection.moderationStatus === 'APPROVED' &&
      projection.assetAccess === 'SIGNED_URL';
  }

  private buildCacheKey(projection: IPublicVideoProjection): string {
    const version = projection.updatedAt || projection.publishedAt;

    return [
      'public-video-access',
      projection.ownerUid,
      projection.id,
      String(version),
    ].join(':');
  }

  private chunkItems<T>(items: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('Erro ao autorizar acesso temporário ao vídeo.');

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'PublicVideoAccessService',
        ...context,
      };
      (normalizedError as any).skipUserNotification = true;

      this.errorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
