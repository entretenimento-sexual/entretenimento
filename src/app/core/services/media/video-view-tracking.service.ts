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
import { PublicVideoAccessService } from './public-video-access.service';

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
  playbackSessionToken: string;
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

const PLAYBACK_SESSION_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

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
    private readonly publicVideoAccess: PublicVideoAccessService,
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
    evidence?: VideoViewPlaybackEvidence,
    playbackSessionTokenValue?: string
  ): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safeVideoId = (videoId ?? '').trim();
    const safeEvidence = this.normalizeEvidence(evidence);
    const playbackSessionToken = this.normalizePlaybackSessionToken(
      playbackSessionTokenValue
    );

    if (
      !safeOwnerUid ||
      !safeVideoId ||
      !safeEvidence ||
      !playbackSessionToken
    ) {
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
      >(
        this.functions,
        'recordVideoView',
        { limitedUseAppCheckTokens: true }
      );

      const response = await callable({
        ownerUid: safeOwnerUid,
        videoId: safeVideoId,
        source,
        playbackSessionToken,
        evidence: safeEvidence,
      });

      return response.data;
    }).pipe(
      map((response) => {
        this.publicVideoAccess.markPlaybackSessionConsumed(
          playbackSessionToken
        );
        const retryAfterMs = Number(response.retryAfterMs ?? 0);

        if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
          this.nextEligibleAt.set(viewKey, Date.now() + retryAfterMs);
        }

        return void 0;
      }),
      catchError((error: unknown) => {
        // A sessão é de uso único no backend. Mesmo com resposta perdida,
        // ela não deve voltar ao cache nem ser reenviada.
        this.publicVideoAccess.markPlaybackSessionConsumed(
          playbackSessionToken
        );
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

  private normalizePlaybackSessionToken(value: unknown): string {
    const token = String(value ?? '').trim();
    return PLAYBACK_SESSION_PATTERN.test(token) ? token : '';
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
