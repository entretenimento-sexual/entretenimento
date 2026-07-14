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
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export type TVideoViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'boosted'
  | 'unknown';

export interface VideoViewPlaybackEvidence {
  sessionId: string;
  playbackMs: number;
  durationMs: number;
  qualifiedAt: number;
}

interface RecordVideoViewRequest {
  ownerUid: string;
  videoId: string;
  source: TVideoViewSource;
  evidence: VideoViewPlaybackEvidence;
}

interface RecordVideoViewResponse {
  ok: true;
  ownerUid: string;
  videoId: string;
  counted: boolean;
  uniqueViewer: boolean;
  retryAfterMs: number;
}

@Injectable({ providedIn: 'root' })
export class VideoViewTrackingService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly functions = inject(Functions);
  private readonly nextEligibleAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Observable<void>>();
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
        }

        this.lastSessionUid = normalizedUid;
      });
  }

  recordVideoView$(
    ownerUid: string,
    videoId: string,
    source: TVideoViewSource = 'unknown',
    evidence?: VideoViewPlaybackEvidence
  ): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safeVideoId = (videoId ?? '').trim();
    const safeEvidence = this.normalizeEvidence(evidence);

    if (!safeOwnerUid || !safeVideoId || !safeEvidence) {
      return of(void 0);
    }

    const viewKey = `${safeOwnerUid}:${safeVideoId}`;
    const now = Date.now();

    if ((this.nextEligibleAt.get(viewKey) ?? 0) > now) {
      return of(void 0);
    }

    const pending = this.inFlight.get(viewKey);
    if (pending) {
      return pending;
    }

    const request$ = this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        RecordVideoViewRequest,
        RecordVideoViewResponse
      >(this.functions, 'recordVideoView');

      const response = await callable({
        ownerUid: safeOwnerUid,
        videoId: safeVideoId,
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
          op: 'recordVideoView$',
          hasOwnerUid: true,
          hasVideoId: true,
          source,
          playbackMs: safeEvidence.playbackMs,
          durationMs: safeEvidence.durationMs,
        });

        return of(void 0);
      }),
      finalize(() => this.inFlight.delete(viewKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlight.set(viewKey, request$);
    return request$;
  }

  private normalizeEvidence(
    evidence: VideoViewPlaybackEvidence | undefined
  ): VideoViewPlaybackEvidence | null {
    if (!evidence) {
      return null;
    }

    const sessionId = String(evidence.sessionId ?? '').trim();
    const playbackMs = Number(evidence.playbackMs);
    const durationMs = Number(evidence.durationMs);
    const qualifiedAt = Number(evidence.qualifiedAt);

    if (
      sessionId.length < 16 ||
      sessionId.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(sessionId) ||
      !Number.isFinite(playbackMs) ||
      playbackMs <= 0 ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      !Number.isFinite(qualifiedAt) ||
      qualifiedAt <= 0
    ) {
      return null;
    }

    return {
      sessionId,
      playbackMs: Math.round(playbackMs),
      durationMs: Math.round(durationMs),
      qualifiedAt: Math.round(qualifiedAt),
    };
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('Erro ao registrar visualização do vídeo.');

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'VideoViewTrackingService',
        ...context,
      };
      (normalizedError as any).skipUserNotification = true;

      this.errorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
