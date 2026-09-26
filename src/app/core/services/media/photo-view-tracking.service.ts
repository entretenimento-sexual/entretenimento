import {
  DestroyRef,
  Injectable,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  tap,
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { MediaApplicationErrorService } from './media-application-error.service';

export type TPhotoViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'sponsored'
  | 'unknown';

interface IRecordPhotoViewRequest {
  ownerUid: string;
  photoId: string;
  source: TPhotoViewSource;
}

interface IRecordPhotoViewResponse {
  ok: true;
  ownerUid: string;
  photoId: string;
}

const LOCAL_VIEW_DEDUPE_MS = 5 * 60 * 1000;
const LOCAL_VIEW_CACHE_MAX = 256;

@Injectable({ providedIn: 'root' })
export class PhotoViewTrackingService {
  private readonly functions = inject(Functions);
  private readonly destroyRef = inject(DestroyRef);
  private readonly recentSuccessfulRecords = new Map<string, number>();
  private readonly inFlightRecords = new Map<string, Observable<void>>();

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorHandler: MediaApplicationErrorService,
    authSession: AuthSessionService
  ) {
    authSession.uid$
      .pipe(
        map((uid) => (uid ?? '').trim()),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.recentSuccessfulRecords.clear();
        this.inFlightRecords.clear();
      });
  }

  recordPhotoView$(
    ownerUid: string,
    photoId: string,
    source: TPhotoViewSource = 'unknown'
  ): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(void 0);
    }

    const cacheKey = JSON.stringify([safeOwnerUid, safePhotoId]);
    const lastSuccessfulAt = this.recentSuccessfulRecords.get(cacheKey) ?? 0;

    if (Date.now() - lastSuccessfulAt < LOCAL_VIEW_DEDUPE_MS) {
      return of(void 0);
    }

    const inFlight = this.inFlightRecords.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request$ = this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        IRecordPhotoViewRequest,
        IRecordPhotoViewResponse
      >(this.functions, 'recordPhotoView');

      await callable({
        ownerUid: safeOwnerUid,
        photoId: safePhotoId,
        source,
      });
    }).pipe(
      tap(() => {
        this.touchSuccessfulRecord(cacheKey, Date.now());
      }),
      map(() => void 0),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'recordPhotoView$',
          ownerUid: safeOwnerUid,
          photoId: safePhotoId,
          source,
        });

        return of(void 0);
      }),
      finalize(() => {
        this.inFlightRecords.delete(cacheKey);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlightRecords.set(cacheKey, request$);
    return request$;
  }

  private touchSuccessfulRecord(cacheKey: string, recordedAt: number): void {
    this.recentSuccessfulRecords.delete(cacheKey);
    this.recentSuccessfulRecords.set(cacheKey, recordedAt);

    while (this.recentSuccessfulRecords.size > LOCAL_VIEW_CACHE_MAX) {
      const oldestKey = this.recentSuccessfulRecords.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }
      this.recentSuccessfulRecords.delete(oldestKey);
    }
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    this.errorHandler.reportSilently(
      error,
      String(context['op'] ?? 'recordPhotoView$'),
      'Erro ao registrar visualização da foto.',
      {
        scope: 'PhotoViewTrackingService',
        ...context,
      }
    );
  }
}
