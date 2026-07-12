import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
} from 'rxjs/operators';

import {
  IPublicVideoItem,
  IPublicVideoProjection,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

interface PublicVideoAccessRequestItem {
  ownerUid: string;
  videoId: string;
}

interface PublicVideoAccessRequest {
  items: PublicVideoAccessRequestItem[];
}

interface PublicVideoAccessResponseItem {
  ownerUid: string;
  videoId: string;
  url: string;
  posterUrl: string | null;
  expiresAt: number;
}

interface PublicVideoAccessResponse {
  items: PublicVideoAccessResponseItem[];
}

interface PublicVideoAccessCacheEntry {
  url: string;
  posterUrl: string | null;
  expiresAt: number;
}

const MAX_ITEMS_PER_REQUEST = 16;
const CACHE_EXPIRY_SAFETY_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class PublicVideoAccessService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly functions = inject(Functions);
  private readonly accessCache = new Map<
    string,
    PublicVideoAccessCacheEntry
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
        }

        this.lastSessionUid = normalizedUid;
      });
  }

  hydratePublicVideoUrls$(
    projections: readonly IPublicVideoProjection[]
  ): Observable<IPublicVideoItem[]> {
    const eligible = projections.filter((projection) =>
      this.isEligibleProjection(projection)
    );

    if (!eligible.length) {
      return of([]);
    }

    const resolved = new Map<string, PublicVideoAccessCacheEntry>();
    const pending: IPublicVideoProjection[] = [];
    const now = Date.now();

    for (const projection of eligible) {
      const cacheKey = this.buildCacheKey(projection);
      const cached = this.accessCache.get(cacheKey);

      if (
        cached &&
        cached.expiresAt > now + CACHE_EXPIRY_SAFETY_MS
      ) {
        resolved.set(
          this.buildIdentityKey(projection.ownerUid, projection.id),
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
      return of(this.materializeItems(eligible, resolved));
    }

    const requests = this.chunkItems(pending, MAX_ITEMS_PER_REQUEST).map(
      (chunk) => this.requestAccessUrls$(chunk)
    );

    return forkJoin(requests).pipe(
      map((responses) => {
        for (const response of responses) {
          for (const accessItem of response.items) {
            const identityKey = this.buildIdentityKey(
              accessItem.ownerUid,
              accessItem.videoId
            );
            const projection = eligible.find(
              (item) =>
                this.buildIdentityKey(item.ownerUid, item.id) === identityKey
            );

            if (!projection || !this.isHttpUrl(accessItem.url)) {
              continue;
            }

            const cacheEntry: PublicVideoAccessCacheEntry = {
              url: accessItem.url,
              posterUrl: this.isHttpUrl(accessItem.posterUrl)
                ? accessItem.posterUrl
                : null,
              expiresAt: accessItem.expiresAt,
            };

            resolved.set(identityKey, cacheEntry);
            this.accessCache.set(this.buildCacheKey(projection), cacheEntry);
          }
        }

        return this.materializeItems(eligible, resolved);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
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
    resolved: ReadonlyMap<string, PublicVideoAccessCacheEntry>
  ): IPublicVideoItem[] {
    return projections.flatMap((projection) => {
      const access = resolved.get(
        this.buildIdentityKey(projection.ownerUid, projection.id)
      );

      if (!access) {
        return [];
      }

      return [{
        ...projection,
        url: access.url,
        posterUrl: access.posterUrl,
      }];
    });
  }

  private isEligibleProjection(
    projection: IPublicVideoProjection
  ): boolean {
    return (
      !!projection.ownerUid?.trim() &&
      !!projection.id?.trim() &&
      projection.mediaType === 'VIDEO' &&
      projection.visibility === 'PUBLIC' &&
      projection.moderationStatus === 'APPROVED' &&
      projection.assetAccess === 'SIGNED_URL'
    );
  }

  private buildCacheKey(projection: IPublicVideoProjection): string {
    const version = this.toMillis(projection.updatedAt) ||
      this.toMillis(projection.publishedAt);

    return [
      'public-video-access',
      projection.ownerUid,
      projection.id,
      String(version),
    ].join(':');
  }

  private buildIdentityKey(ownerUid: string, videoId: string): string {
    return `${ownerUid.trim()}:${videoId.trim()}`;
  }

  private chunkItems<T>(items: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private isHttpUrl(value: unknown): value is string {
    return /^https?:\/\//i.test(String(value ?? '').trim());
  }

  private toMillis(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    const maybeTimestamp = value as {
      toMillis?: () => number;
    } | null | undefined;

    return typeof maybeTimestamp?.toMillis === 'function'
      ? maybeTimestamp.toMillis()
      : 0;
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
