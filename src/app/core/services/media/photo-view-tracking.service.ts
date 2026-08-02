import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export type TPhotoViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'boosted'
  | 'unknown';

export interface PhotoViewEvidence {
  sessionId: string;
  visibleMs: number;
  qualifiedAt: number;
}

export interface PhotoViewSession {
  ownerUid: string;
  photoId: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

interface IssuePhotoViewSessionRequest {
  ownerUid: string;
  photoId: string;
  source: TPhotoViewSource;
}

interface IssuePhotoViewSessionResponse extends PhotoViewSession {
  ok: true;
}

interface RecordPhotoViewRequest {
  ownerUid: string;
  photoId: string;
  source: TPhotoViewSource;
  evidence: PhotoViewEvidence;
}

interface RecordPhotoViewResponse {
  ok: true;
  ownerUid: string;
  photoId: string;
  counted: boolean;
  uniqueViewer: boolean;
  retryAfterMs: number;
}

interface PhotoViewTrackingError extends Error {
  original?: unknown;
  context?: Record<string, unknown>;
  skipUserNotification?: boolean;
}

const PHOTO_VIEW_MIN_VISIBLE_MS = 2_000;
const SESSION_EXPIRY_SAFETY_WINDOW_MS = 10_000;
const VISIBILITY_TICK_MS = 200;
const MAX_TICK_DELTA_MS = 1_000;

@Injectable({ providedIn: 'root' })
export class PhotoViewTrackingService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly functions = inject(Functions);
  private readonly nextEligibleAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Observable<void>>();
  private readonly sessions = new Map<string, PhotoViewSession>();
  private readonly sessionInFlight = new Map<
    string,
    Observable<PhotoViewSession | null>
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
          this.nextEligibleAt.clear();
          this.inFlight.clear();
          this.sessions.clear();
          this.sessionInFlight.clear();
        }

        this.lastSessionUid = normalizedUid;
      });
  }

  preparePhotoViewSession$(
    ownerUid: string,
    photoId: string,
    source: TPhotoViewSource = 'unknown'
  ): Observable<PhotoViewSession | null> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(null);
    }

    const viewKey = this.buildViewKey(safeOwnerUid, safePhotoId);
    const cached = this.sessions.get(viewKey);

    if (
      cached &&
      cached.expiresAt > Date.now() + SESSION_EXPIRY_SAFETY_WINDOW_MS
    ) {
      return of(cached);
    }

    this.sessions.delete(viewKey);

    const pending = this.sessionInFlight.get(viewKey);
    if (pending) {
      return pending;
    }

    const request$ = this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        IssuePhotoViewSessionRequest,
        IssuePhotoViewSessionResponse
      >(this.functions, 'issuePhotoViewSession');
      const response = await callable({
        ownerUid: safeOwnerUid,
        photoId: safePhotoId,
        source,
      });

      return response.data;
    }).pipe(
      map((candidate) => this.normalizeSession(
        candidate,
        safeOwnerUid,
        safePhotoId
      )),
      map((session) => {
        if (session) {
          this.sessions.set(viewKey, session);
        }
        return session;
      }),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'preparePhotoViewSession$',
          hasOwnerUid: true,
          hasPhotoId: true,
          source,
        });
        return of(null);
      }),
      finalize(() => this.sessionInFlight.delete(viewKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.sessionInFlight.set(viewKey, request$);
    return request$;
  }

  trackQualifiedPhotoView$(
    ownerUid: string,
    photoId: string,
    source: TPhotoViewSource = 'unknown'
  ): Observable<void> {
    return this.preparePhotoViewSession$(ownerUid, photoId, source).pipe(
      switchMap((session) => {
        if (!session) {
          return of(void 0);
        }

        return this.waitForVisibleEvidence$(session).pipe(
          switchMap((evidence) =>
            this.recordPhotoView$(ownerUid, photoId, source, evidence)
          )
        );
      }),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'trackQualifiedPhotoView$',
          hasOwnerUid: !!ownerUid,
          hasPhotoId: !!photoId,
          source,
        });
        return of(void 0);
      })
    );
  }

  recordPhotoView$(
    ownerUid: string,
    photoId: string,
    source: TPhotoViewSource = 'unknown',
    evidence?: PhotoViewEvidence
  ): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();
    const safeEvidence = this.normalizeEvidence(evidence);

    if (!safeOwnerUid || !safePhotoId || !safeEvidence) {
      return of(void 0);
    }

    const viewKey = this.buildViewKey(safeOwnerUid, safePhotoId);
    const preparedSession = this.sessions.get(viewKey);

    if (
      !preparedSession ||
      preparedSession.sessionId !== safeEvidence.sessionId ||
      preparedSession.expiresAt <= Date.now()
    ) {
      this.sessions.delete(viewKey);
      return of(void 0);
    }

    const now = Date.now();

    if ((this.nextEligibleAt.get(viewKey) ?? 0) > now) {
      this.sessions.delete(viewKey);
      return of(void 0);
    }

    const pending = this.inFlight.get(viewKey);
    if (pending) {
      return pending;
    }

    this.sessions.delete(viewKey);

    const request$ = this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        RecordPhotoViewRequest,
        RecordPhotoViewResponse
      >(this.functions, 'recordPhotoView');
      const response = await callable({
        ownerUid: safeOwnerUid,
        photoId: safePhotoId,
        source,
        evidence: safeEvidence,
      });

      return response.data;
    }).pipe(
      map((response) => {
        const retryAfterMs = Number(response.retryAfterMs ?? 0);

        if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
          this.nextEligibleAt.set(viewKey, Date.now() + retryAfterMs);
        }

        return void 0;
      }),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'recordPhotoView$',
          hasOwnerUid: true,
          hasPhotoId: true,
          source,
          visibleMs: safeEvidence.visibleMs,
        });
        return of(void 0);
      }),
      finalize(() => this.inFlight.delete(viewKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlight.set(viewKey, request$);
    return request$;
  }

  private waitForVisibleEvidence$(
    session: PhotoViewSession
  ): Observable<PhotoViewEvidence> {
    return new Observable<PhotoViewEvidence>((subscriber) => {
      if (typeof document === 'undefined') {
        subscriber.complete();
        return undefined;
      }

      let visibleMs = 0;
      let lastTickAt = this.monotonicNow();

      const resetTick = (): void => {
        lastTickAt = this.monotonicNow();
      };

      const tick = (): void => {
        const tickAt = this.monotonicNow();
        const deltaMs = Math.max(
          0,
          Math.min(MAX_TICK_DELTA_MS, tickAt - lastTickAt)
        );
        lastTickAt = tickAt;

        if (document.visibilityState !== 'visible') {
          return;
        }

        visibleMs += deltaMs;

        if (visibleMs < PHOTO_VIEW_MIN_VISIBLE_MS) {
          return;
        }

        subscriber.next({
          sessionId: session.sessionId,
          visibleMs: Math.round(visibleMs),
          qualifiedAt: Date.now(),
        });
        subscriber.complete();
      };

      document.addEventListener('visibilitychange', resetTick, {
        passive: true,
      });
      const intervalId = setInterval(tick, VISIBILITY_TICK_MS);

      return () => {
        clearInterval(intervalId);
        document.removeEventListener('visibilitychange', resetTick);
      };
    });
  }

  private buildViewKey(ownerUid: string, photoId: string): string {
    return `${ownerUid}:${photoId}`;
  }

  private monotonicNow(): number {
    return typeof performance !== 'undefined' &&
      typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  private normalizeSession(
    candidate: IssuePhotoViewSessionResponse,
    expectedOwnerUid: string,
    expectedPhotoId: string
  ): PhotoViewSession | null {
    const ownerUid = String(candidate?.ownerUid ?? '').trim();
    const photoId = String(candidate?.photoId ?? '').trim();
    const sessionId = String(candidate?.sessionId ?? '').trim();
    const issuedAt = Number(candidate?.issuedAt ?? 0);
    const expiresAt = Number(candidate?.expiresAt ?? 0);

    if (
      candidate?.ok !== true ||
      ownerUid !== expectedOwnerUid ||
      photoId !== expectedPhotoId ||
      sessionId.length < 32 ||
      sessionId.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(sessionId) ||
      !Number.isFinite(issuedAt) ||
      issuedAt <= 0 ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() + SESSION_EXPIRY_SAFETY_WINDOW_MS
    ) {
      return null;
    }

    return {
      ownerUid,
      photoId,
      sessionId,
      issuedAt: Math.floor(issuedAt),
      expiresAt: Math.floor(expiresAt),
    };
  }

  private normalizeEvidence(
    evidence: PhotoViewEvidence | undefined
  ): PhotoViewEvidence | null {
    if (!evidence) {
      return null;
    }

    const sessionId = String(evidence.sessionId ?? '').trim();
    const visibleMs = Number(evidence.visibleMs);
    const qualifiedAt = Number(evidence.qualifiedAt);

    if (
      sessionId.length < 32 ||
      sessionId.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(sessionId) ||
      !Number.isFinite(visibleMs) ||
      visibleMs < PHOTO_VIEW_MIN_VISIBLE_MS ||
      !Number.isFinite(qualifiedAt) ||
      qualifiedAt <= 0
    ) {
      return null;
    }

    return {
      sessionId,
      visibleMs: Math.round(visibleMs),
      qualifiedAt: Math.round(qualifiedAt),
    };
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalizedError: PhotoViewTrackingError = error instanceof Error
        ? error
        : new Error('Erro ao registrar visualização da foto.');

      normalizedError.original = error;
      normalizedError.context = {
        scope: 'PhotoViewTrackingService',
        ...context,
      };
      normalizedError.skipUserNotification = true;

      this.errorHandler.handleError(normalizedError);
    } catch {
      // Métricas não podem interromper a exibição da foto.
    }
  }
}
