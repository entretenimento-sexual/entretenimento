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

import type { Photo } from 'src/app/core/services/image-handling/photo-firestore.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

interface PrivatePhotoAccessRequest {
  readonly ownerUid: string;
  readonly photoIds: string[];
}

interface PrivatePhotoAccessResponseItem {
  readonly photoId: string;
  readonly url: string;
  readonly storagePath: string;
  readonly expiresAt: number;
}

interface PrivatePhotoAccessResponse {
  readonly items: PrivatePhotoAccessResponseItem[];
}

interface PrivatePhotoAccessCacheEntry {
  readonly url: string;
  readonly storagePath: string;
  readonly expiresAt: number;
}

const MAX_ITEMS_PER_REQUEST = 60;
const CACHE_EXPIRY_SAFETY_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class PrivatePhotoAccessService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly functions = inject(Functions);
  private readonly accessCache = new Map<
    string,
    PrivatePhotoAccessCacheEntry
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

  hydratePrivatePhotoUrls$(
    ownerUid: string,
    photos: readonly Photo[]
  ): Observable<Photo[]> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const eligible = photos.filter((photo) =>
      this.cleanId(photo.id) && this.hasOwnedPath(safeOwnerUid, photo.path)
    );

    if (!safeOwnerUid || !eligible.length) {
      return of([]);
    }

    const resolvedUrls = new Map<string, string>();
    const pending: Photo[] = [];
    const now = Date.now();

    for (const photo of eligible) {
      const cacheKey = this.buildCacheKey(safeOwnerUid, photo);
      const cached = this.accessCache.get(cacheKey);

      if (
        cached &&
        cached.expiresAt > now + CACHE_EXPIRY_SAFETY_MS &&
        cached.storagePath === String(photo.path ?? '').trim()
      ) {
        resolvedUrls.set(photo.id, cached.url);
        continue;
      }

      if (cached) {
        this.accessCache.delete(cacheKey);
      }

      pending.push(photo);
    }

    if (!pending.length) {
      return of(this.materializePhotos(eligible, resolvedUrls));
    }

    const requests = this.chunkItems(pending, MAX_ITEMS_PER_REQUEST).map(
      (chunk) => this.requestAccessUrls$(safeOwnerUid, chunk)
    );

    return forkJoin(requests).pipe(
      map((responses) => {
        for (const response of responses) {
          for (const accessItem of response.items) {
            const photo = eligible.find(
              (candidate) => candidate.id === accessItem.photoId
            );

            if (
              !photo ||
              !this.isHttpUrl(accessItem.url) ||
              accessItem.storagePath !== String(photo.path ?? '').trim()
            ) {
              continue;
            }

            resolvedUrls.set(photo.id, accessItem.url);
            this.accessCache.set(
              this.buildCacheKey(safeOwnerUid, photo),
              {
                url: accessItem.url,
                storagePath: accessItem.storagePath,
                expiresAt: accessItem.expiresAt,
              }
            );
          }
        }

        return this.materializePhotos(eligible, resolvedUrls);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private requestAccessUrls$(
    ownerUid: string,
    photos: readonly Photo[]
  ): Observable<PrivatePhotoAccessResponse> {
    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        PrivatePhotoAccessRequest,
        PrivatePhotoAccessResponse
      >(this.functions, 'getPrivatePhotoAccessUrls');
      const response = await callable({
        ownerUid,
        photoIds: photos.map((photo) => photo.id),
      });

      return response.data;
    }).pipe(
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'requestAccessUrls$',
          ownerUid,
          count: photos.length,
        });
        return throwError(() => error);
      })
    );
  }

  private materializePhotos(
    photos: readonly Photo[],
    resolvedUrls: ReadonlyMap<string, string>
  ): Photo[] {
    return photos.flatMap((photo) => {
      const url = resolvedUrls.get(photo.id);
      return url ? [{ ...photo, url }] : [];
    });
  }

  private buildCacheKey(ownerUid: string, photo: Photo): string {
    return [
      'private-photo-access',
      ownerUid,
      photo.id,
      String(photo.path ?? '').trim(),
    ].join(':');
  }

  private hasOwnedPath(ownerUid: string, value: unknown): boolean {
    const path = String(value ?? '').trim().replace(/^\/+/, '');
    return !!ownerUid && path.startsWith(`users/${ownerUid}/uploads/images/`);
  }

  private cleanId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
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
        : new Error('Erro ao autorizar acesso temporário à foto privada.');

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'PrivatePhotoAccessService',
        ...context,
      };
      (normalizedError as any).skipUserNotification = true;
      this.errorHandler.handleError(normalizedError);
    } catch {
      // A telemetria não pode quebrar o fluxo de leitura.
    }
  }
}
