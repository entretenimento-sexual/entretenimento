import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, throwError, timer } from 'rxjs';
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

interface StartVideoPlaybackSessionRequest {
  ownerUid: string;
  videoId: string;
}

interface StartVideoPlaybackSessionResponse {
  ownerUid: string;
  videoId: string;
  playbackToken: string;
  issuedAt: number;
  earliestQualifiedAt: number;
  expiresAt: number;
  requiredPlaybackMs: number;
}

type VideoPlaybackSessionGrant = StartVideoPlaybackSessionResponse;

interface VideoRetentionGrant {
  ownerUid: string;
  videoId: string;
  retentionToken: string;
  expiresAt: number;
}

interface RecordVideoViewRequest {
  ownerUid: string;
  videoId: string;
  source: TVideoViewSource;
  playbackToken: string;
  evidence: VideoViewPlaybackEvidence;
}

interface RecordVideoViewResponse {
  ok: true;
  ownerUid: string;
  videoId: string;
  counted: boolean;
  uniqueViewer: boolean;
  retryAfterMs: number;
  retentionToken: string | null;
  retentionTokenExpiresAt: number;
}

interface RecordVideoRetentionRequest {
  ownerUid: string;
  videoId: string;
  retentionToken: string;
  evidence: VideoViewPlaybackEvidence;
}

interface RecordVideoRetentionResponse {
  ok: true;
  ownerUid: string;
  videoId: string;
  improved: boolean;
  retentionScore: number;
  retentionAveragePercent: number;
  completionRate: number;
}

interface FunctionsRateLimitErrorLike {
  code?: unknown;
  details?: unknown;
  customData?: { details?: unknown };
}

const SESSION_EXPIRY_SAFETY_MS = 15_000;
const RETENTION_EXPIRY_SAFETY_MS = 5_000;
const SERVER_CLOCK_SETTLE_MS = 150;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000;
const MAX_RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class VideoViewTrackingService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly functions = inject(Functions);
  private readonly nextEligibleAt = new Map<string, number>();
  private readonly playbackSessions = new Map<string, VideoPlaybackSessionGrant>();
  private readonly retentionGrants = new Map<string, VideoRetentionGrant>();
  private readonly inFlightSessionRequests = new Map<
    string,
    Observable<VideoPlaybackSessionGrant>
  >();
  private readonly inFlight = new Map<string, Observable<boolean>>();
  private readonly inFlightRetention = new Map<string, Observable<boolean>>();
  private playbackSessionStartBlockedUntil = 0;
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
          this.playbackSessions.clear();
          this.retentionGrants.clear();
          this.inFlightSessionRequests.clear();
          this.inFlight.clear();
          this.inFlightRetention.clear();
          this.playbackSessionStartBlockedUntil = 0;
        }

        this.lastSessionUid = normalizedUid;
      });
  }

  prepareVideoViewSession$(
    ownerUid: string,
    videoId: string
  ): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safeVideoId = (videoId ?? '').trim();

    if (
      !safeOwnerUid ||
      !safeVideoId ||
      (!!this.lastSessionUid && this.lastSessionUid === safeOwnerUid) ||
      this.playbackSessionStartBlockedUntil > Date.now()
    ) {
      return of(void 0);
    }

    return this.ensurePlaybackSession$(safeOwnerUid, safeVideoId).pipe(
      map(() => void 0),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'prepareVideoViewSession$',
          hasOwnerUid: true,
          hasVideoId: true,
          rateLimitBackoffActive:
            this.playbackSessionStartBlockedUntil > Date.now(),
        });
        return of(void 0);
      })
    );
  }

  recordVideoView$(
    ownerUid: string,
    videoId: string,
    source: TVideoViewSource = 'unknown',
    evidence?: VideoViewPlaybackEvidence
  ): Observable<boolean> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safeVideoId = (videoId ?? '').trim();
    const safeEvidence = this.normalizeEvidence(evidence);

    if (
      !safeOwnerUid ||
      !safeVideoId ||
      !safeEvidence ||
      (!!this.lastSessionUid && this.lastSessionUid === safeOwnerUid)
    ) {
      return of(false);
    }

    const viewKey = this.buildViewKey(safeOwnerUid, safeVideoId);
    const now = Date.now();

    if ((this.nextEligibleAt.get(viewKey) ?? 0) > now) {
      return of(true);
    }

    const pending = this.inFlight.get(viewKey);
    if (pending) {
      return pending;
    }

    const request$ = this.ensurePlaybackSession$(
      safeOwnerUid,
      safeVideoId
    ).pipe(
      switchMap((session) => {
        const waitMs = Math.max(
          0,
          session.earliestQualifiedAt - Date.now() + SERVER_CLOCK_SETTLE_MS
        );

        return timer(waitMs).pipe(
          switchMap(() => this.submitQualifiedView$(
            safeOwnerUid,
            safeVideoId,
            source,
            session.playbackToken,
            safeEvidence
          ))
        );
      }),
      map((response) => {
        const retryAfterMs = Number(response.retryAfterMs ?? 0);

        if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
          this.nextEligibleAt.set(viewKey, Date.now() + retryAfterMs);
        }

        this.rememberRetentionGrant(response, safeOwnerUid, safeVideoId);
        this.playbackSessions.delete(viewKey);
        return true;
      }),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'recordVideoView$',
          hasOwnerUid: true,
          hasVideoId: true,
          source,
          playbackMs: safeEvidence.playbackMs,
          durationMs: safeEvidence.durationMs,
          hasServerPlaybackSession: this.playbackSessions.has(viewKey),
          rateLimitBackoffActive:
            this.playbackSessionStartBlockedUntil > Date.now(),
        });

        return of(false);
      }),
      finalize(() => this.inFlight.delete(viewKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlight.set(viewKey, request$);
    return request$;
  }

  recordVideoRetention$(
    ownerUid: string,
    videoId: string,
    evidence?: VideoViewPlaybackEvidence
  ): Observable<boolean> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safeVideoId = (videoId ?? '').trim();
    const safeEvidence = this.normalizeEvidence(evidence);

    if (
      !safeOwnerUid ||
      !safeVideoId ||
      !safeEvidence ||
      (!!this.lastSessionUid && this.lastSessionUid === safeOwnerUid)
    ) {
      return of(false);
    }

    const viewKey = this.buildViewKey(safeOwnerUid, safeVideoId);
    const retentionRequestKey = [
      viewKey,
      safeEvidence.sessionId,
      safeEvidence.playbackMs,
    ].join(':');
    const pendingRetention = this.inFlightRetention.get(retentionRequestKey);

    if (pendingRetention) {
      return pendingRetention;
    }

    const request$ = this.resolveRetentionGrant$(viewKey).pipe(
      switchMap((grant) => {
        if (!grant) {
          return of(false);
        }

        return this.submitRetentionProgress$(
          safeOwnerUid,
          safeVideoId,
          grant.retentionToken,
          safeEvidence
        ).pipe(map(() => true));
      }),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'recordVideoRetention$',
          hasOwnerUid: true,
          hasVideoId: true,
          playbackMs: safeEvidence.playbackMs,
          durationMs: safeEvidence.durationMs,
          hasRetentionGrant: this.retentionGrants.has(viewKey),
        });
        return of(false);
      }),
      finalize(() => this.inFlightRetention.delete(retentionRequestKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlightRetention.set(retentionRequestKey, request$);
    return request$;
  }

  private ensurePlaybackSession$(
    ownerUid: string,
    videoId: string
  ): Observable<VideoPlaybackSessionGrant> {
    const viewKey = this.buildViewKey(ownerUid, videoId);
    const now = Date.now();
    const cached = this.playbackSessions.get(viewKey);

    if (
      cached &&
      cached.expiresAt > now + SESSION_EXPIRY_SAFETY_MS &&
      cached.ownerUid === ownerUid &&
      cached.videoId === videoId
    ) {
      return of(cached);
    }

    if (cached) {
      this.playbackSessions.delete(viewKey);
    }

    const inFlight = this.inFlightSessionRequests.get(viewKey);
    if (inFlight) {
      return inFlight;
    }

    if (this.playbackSessionStartBlockedUntil > now) {
      return throwError(
        () => new Error('Início de sessão de reprodução temporariamente limitado.')
      );
    }

    const request$ = this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        StartVideoPlaybackSessionRequest,
        StartVideoPlaybackSessionResponse
      >(this.functions, 'startPublicVideoPlaybackSession');
      const response = await callable({ ownerUid, videoId });
      return response.data;
    }).pipe(
      map((response) => {
        const grant = this.normalizePlaybackSessionGrant(
          response,
          ownerUid,
          videoId
        );

        if (!grant) {
          throw new Error('Sessão de reprodução retornada pelo backend é inválida.');
        }

        this.playbackSessions.set(viewKey, grant);
        return grant;
      }),
      catchError((error: unknown) => {
        this.rememberPlaybackSessionRateLimit(error);
        return throwError(() => error);
      }),
      finalize(() => this.inFlightSessionRequests.delete(viewKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlightSessionRequests.set(viewKey, request$);
    return request$;
  }

  private resolveRetentionGrant$(
    viewKey: string
  ): Observable<VideoRetentionGrant | null> {
    const cached = this.getValidRetentionGrant(viewKey);

    if (cached) {
      return of(cached);
    }

    const pendingView = this.inFlight.get(viewKey);

    if (!pendingView) {
      return of(null);
    }

    return pendingView.pipe(
      switchMap(() => of(this.getValidRetentionGrant(viewKey)))
    );
  }

  private getValidRetentionGrant(viewKey: string): VideoRetentionGrant | null {
    const grant = this.retentionGrants.get(viewKey);

    if (!grant) {
      return null;
    }

    if (grant.expiresAt <= Date.now() + RETENTION_EXPIRY_SAFETY_MS) {
      this.retentionGrants.delete(viewKey);
      return null;
    }

    return grant;
  }

  private rememberRetentionGrant(
    response: RecordVideoViewResponse,
    ownerUid: string,
    videoId: string
  ): void {
    const retentionToken = String(response.retentionToken ?? '').trim();
    const expiresAt = Number(response.retentionTokenExpiresAt ?? 0);

    if (
      response.ownerUid !== ownerUid ||
      response.videoId !== videoId ||
      retentionToken.length < 32 ||
      retentionToken.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(retentionToken) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() + RETENTION_EXPIRY_SAFETY_MS
    ) {
      return;
    }

    this.retentionGrants.set(this.buildViewKey(ownerUid, videoId), {
      ownerUid,
      videoId,
      retentionToken,
      expiresAt: Math.floor(expiresAt),
    });
  }

  private submitQualifiedView$(
    ownerUid: string,
    videoId: string,
    source: TVideoViewSource,
    playbackToken: string,
    evidence: VideoViewPlaybackEvidence
  ): Observable<RecordVideoViewResponse> {
    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        RecordVideoViewRequest,
        RecordVideoViewResponse
      >(this.functions, 'recordVideoView');

      const response = await callable({
        ownerUid,
        videoId,
        source,
        playbackToken,
        evidence,
      });

      return response.data;
    });
  }

  private submitRetentionProgress$(
    ownerUid: string,
    videoId: string,
    retentionToken: string,
    evidence: VideoViewPlaybackEvidence
  ): Observable<RecordVideoRetentionResponse> {
    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        RecordVideoRetentionRequest,
        RecordVideoRetentionResponse
      >(this.functions, 'recordVideoRetention');
      const response = await callable({
        ownerUid,
        videoId,
        retentionToken,
        evidence,
      });
      return response.data;
    });
  }

  private normalizePlaybackSessionGrant(
    response: StartVideoPlaybackSessionResponse | null | undefined,
    ownerUid: string,
    videoId: string
  ): VideoPlaybackSessionGrant | null {
    if (!response) {
      return null;
    }

    const playbackToken = String(response.playbackToken ?? '').trim();
    const issuedAt = Number(response.issuedAt ?? 0);
    const earliestQualifiedAt = Number(response.earliestQualifiedAt ?? 0);
    const expiresAt = Number(response.expiresAt ?? 0);
    const requiredPlaybackMs = Number(response.requiredPlaybackMs ?? 0);

    if (
      response.ownerUid !== ownerUid ||
      response.videoId !== videoId ||
      playbackToken.length < 32 ||
      playbackToken.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(playbackToken) ||
      !Number.isFinite(issuedAt) ||
      issuedAt <= 0 ||
      !Number.isFinite(earliestQualifiedAt) ||
      earliestQualifiedAt < issuedAt ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= earliestQualifiedAt ||
      !Number.isFinite(requiredPlaybackMs) ||
      requiredPlaybackMs <= 0
    ) {
      return null;
    }

    return {
      ownerUid,
      videoId,
      playbackToken,
      issuedAt: Math.floor(issuedAt),
      earliestQualifiedAt: Math.floor(earliestQualifiedAt),
      expiresAt: Math.floor(expiresAt),
      requiredPlaybackMs: Math.floor(requiredPlaybackMs),
    };
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

  private rememberPlaybackSessionRateLimit(error: unknown): void {
    const candidate = error as FunctionsRateLimitErrorLike | null | undefined;
    const code = String(candidate?.code ?? '').trim().toLowerCase();

    if (code !== 'resource-exhausted' && code !== 'functions/resource-exhausted') {
      return;
    }

    const details = (
      candidate?.details ?? candidate?.customData?.details
    ) as { retryAfterMs?: unknown } | null | undefined;
    const rawRetryAfterMs = Number(details?.retryAfterMs ?? 0);
    const retryAfterMs = Number.isFinite(rawRetryAfterMs) && rawRetryAfterMs > 0
      ? Math.min(Math.floor(rawRetryAfterMs), MAX_RATE_LIMIT_BACKOFF_MS)
      : DEFAULT_RATE_LIMIT_BACKOFF_MS;

    this.playbackSessionStartBlockedUntil = Math.max(
      this.playbackSessionStartBlockedUntil,
      Date.now() + retryAfterMs
    );
  }

  private buildViewKey(ownerUid: string, videoId: string): string {
    return `${ownerUid}:${videoId}`;
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
