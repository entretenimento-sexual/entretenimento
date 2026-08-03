import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export interface IAdminVideoModerationItem {
  ownerUid: string;
  videoId: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  publishedAt: number;
  moderationStatus: 'PENDING_REVIEW';
  url: string;
  posterUrl: string | null;
  accessExpiresAt: number;
}

interface ListVideoModerationQueueRequest {
  limit: number;
}

interface ListVideoModerationQueueResponse {
  items: IAdminVideoModerationItem[];
  skippedItems: number;
}

export type AdminVideoModerationDecision = 'APPROVE' | 'REJECT';

interface ReviewVideoModerationRequest {
  ownerUid: string;
  videoId: string;
  decision: AdminVideoModerationDecision;
  reason: string | null;
}

export interface IAdminVideoModerationResult {
  ownerUid: string;
  videoId: string;
  moderationStatus: 'APPROVED' | 'REJECTED';
  cleanupPending: boolean;
}

export type AdminVideoProcessingOperationalState =
  | 'READY'
  | 'DEGRADED'
  | 'EMULATOR';

export type AdminVideoProcessingProviderStatus =
  | 'READY'
  | 'EMULATOR_SKIPPED'
  | 'UNAVAILABLE';

export type AdminVideoProcessingJobState =
  | 'QUEUED'
  | 'SUBMITTING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED';

export type AdminVideoProcessingDispatchState =
  | 'ENQUEUEING'
  | 'ENQUEUED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EMULATOR_SKIPPED';

export type AdminVideoProcessingAlertSeverity =
  | 'INFO'
  | 'WARNING'
  | 'CRITICAL';

export type AdminVideoProcessingAlertCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'STALE_JOBS'
  | 'DISPATCH_BACKLOG'
  | 'DISPATCH_FAILURES'
  | 'RECENT_DEAD_LETTERS'
  | 'ACTIVE_SAMPLE_CAPPED';

export type AdminVideoProcessingJobCounts = Record<
  AdminVideoProcessingJobState,
  number
>;

export type AdminVideoProcessingDispatchCounts = Record<
  AdminVideoProcessingDispatchState,
  number
>;

export interface IAdminVideoProcessingProviderStatus {
  status: AdminVideoProcessingProviderStatus;
  reachable: boolean;
  projectId: string | null;
  location: string;
  templateId: string;
  bucketName: string | null;
  checkedAt: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface IAdminVideoProcessingQueueStatus {
  counts: AdminVideoProcessingJobCounts;
  activeTotal: number;
  sampledActiveJobs: number;
  oldestActiveAgeMs: number | null;
  staleSampledJobs: number;
  sampleCapped: boolean;
}

export interface IAdminVideoProcessingDispatchStatus {
  counts: AdminVideoProcessingDispatchCounts;
  pendingTotal: number;
  oldestPendingAgeMs: number | null;
  recentWindowMs: number;
  recentTotal: number;
  completedRecent: number;
  failedRecent: number;
  duplicateRecent: number;
  latencySampleSize: number;
  averageLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  sampleCapped: boolean;
}

export interface IAdminVideoProcessingFailureCode {
  code: string;
  count: number;
  lastSeenAt: number;
}

export interface IAdminVideoProcessingDeadLetterItem {
  deadLetterId: string;
  jobId: string;
  ownerUid: string;
  videoId: string;
  processingVersion: string;
  attempts: number;
  providerState: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  failedAt: number;
}

export interface IAdminVideoProcessingDeadLetters {
  total: number;
  recentWindowMs: number;
  recentTotal: number;
  sampledItems: number;
  sampleCapped: boolean;
  failureCodes: IAdminVideoProcessingFailureCode[];
  items: IAdminVideoProcessingDeadLetterItem[];
}

export interface IAdminVideoProcessingAuditItem {
  logId: string;
  adminUid: string;
  ownerUid: string;
  videoId: string;
  operation: string;
  operationId: string;
  previousState: string | null;
  nextState: string | null;
  reason: string;
  timestamp: number;
}

export interface IAdminVideoProcessingAudit {
  items: IAdminVideoProcessingAuditItem[];
  skippedItems: number;
  sampleCapped: boolean;
}

export interface IAdminVideoProcessingAlert {
  code: AdminVideoProcessingAlertCode;
  severity: AdminVideoProcessingAlertSeverity;
  title: string;
  message: string;
  value: number | null;
}

export interface IAdminVideoProcessingStatus {
  state: AdminVideoProcessingOperationalState;
  checkedAt: number;
  provider: IAdminVideoProcessingProviderStatus;
  queue: IAdminVideoProcessingQueueStatus;
  dispatch: IAdminVideoProcessingDispatchStatus;
  deadLetters: IAdminVideoProcessingDeadLetters;
  audit: IAdminVideoProcessingAudit;
  alerts: IAdminVideoProcessingAlert[];
}

const PROCESSING_JOB_STATES: AdminVideoProcessingJobState[] = [
  'QUEUED',
  'SUBMITTING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
];

const PROCESSING_DISPATCH_STATES: AdminVideoProcessingDispatchState[] = [
  'ENQUEUEING',
  'ENQUEUED',
  'COMPLETED',
  'FAILED',
  'EMULATOR_SKIPPED',
];

const PROCESSING_ALERT_CODES: AdminVideoProcessingAlertCode[] = [
  'PROVIDER_UNAVAILABLE',
  'STALE_JOBS',
  'DISPATCH_BACKLOG',
  'DISPATCH_FAILURES',
  'RECENT_DEAD_LETTERS',
  'ACTIVE_SAMPLE_CAPPED',
];

const PROCESSING_ALERT_SEVERITIES: AdminVideoProcessingAlertSeverity[] = [
  'INFO',
  'WARNING',
  'CRITICAL',
];

@Injectable({ providedIn: 'root' })
export class AdminVideoModerationService {
  private readonly functions = inject(Functions);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  listPendingVideos$(limit = 40): Observable<{
    items: IAdminVideoModerationItem[];
    skippedItems: number;
  }> {
    const safeLimit = Math.max(1, Math.min(80, Math.trunc(limit)));

    return defer(() => {
      const callable = httpsCallable<
        ListVideoModerationQueueRequest,
        ListVideoModerationQueueResponse
      >(this.functions, 'listVideoModerationQueue');

      return from(callable({ limit: safeLimit }));
    }).pipe(
      map((response) => ({
        items: Array.isArray(response.data?.items)
          ? response.data.items.map((item) => this.normalizeItem(item))
          : [],
        skippedItems: this.normalizeNonNegativeInteger(
          response.data?.skippedItems
        ),
      })),
      catchError((error) => {
        this.reportError(error, 'listPendingVideos$', {});
        return throwError(() => error);
      })
    );
  }

  getProcessingStatus$(): Observable<IAdminVideoProcessingStatus> {
    return defer(() => {
      const callable = httpsCallable<
        Record<string, never>,
        IAdminVideoProcessingStatus
      >(this.functions, 'getVideoProcessingOperationalStatus');

      return from(callable({}));
    }).pipe(
      map((response) => this.normalizeProcessingStatus(response.data)),
      catchError((error) => {
        this.reportError(error, 'getProcessingStatus$', {});
        return throwError(() => error);
      })
    );
  }

  reviewVideo$(command: {
    ownerUid: string;
    videoId: string;
    decision: AdminVideoModerationDecision;
    reason?: string | null;
  }): Observable<IAdminVideoModerationResult> {
    const payload: ReviewVideoModerationRequest = {
      ownerUid: this.normalizeId(command.ownerUid),
      videoId: this.normalizeId(command.videoId),
      decision: command.decision,
      reason: this.normalizeOptionalText(command.reason, 900),
    };

    if (!payload.ownerUid || !payload.videoId) {
      return throwError(
        () => new Error('Vídeo inválido para revisão administrativa.')
      );
    }

    if (
      payload.decision === 'REJECT' &&
      String(payload.reason ?? '').length < 8
    ) {
      return throwError(
        () => new Error('Informe um motivo objetivo para rejeitar o vídeo.')
      );
    }

    return defer(() => {
      const callable = httpsCallable<
        ReviewVideoModerationRequest,
        IAdminVideoModerationResult
      >(this.functions, 'reviewVideoModeration');

      return from(callable(payload));
    }).pipe(
      map((response) => response.data),
      catchError((error) => {
        this.reportError(error, 'reviewVideo$', {
          decision: payload.decision,
          hasOwnerUid: true,
          hasVideoId: true,
        });
        return throwError(() => error);
      })
    );
  }

  private normalizeItem(
    item: IAdminVideoModerationItem
  ): IAdminVideoModerationItem {
    return {
      ownerUid: this.normalizeId(item.ownerUid),
      videoId: this.normalizeId(item.videoId),
      title: this.normalizeOptionalText(item.title, 160) || 'Vídeo do perfil',
      mimeType: this.normalizeOptionalText(item.mimeType, 80) || 'video/mp4',
      sizeBytes: this.normalizeNonNegativeInteger(item.sizeBytes),
      durationMs: this.normalizeOptionalPositiveInteger(item.durationMs),
      publishedAt: this.normalizeNonNegativeInteger(item.publishedAt),
      moderationStatus: 'PENDING_REVIEW',
      url: String(item.url ?? '').trim(),
      posterUrl: this.normalizeOptionalText(item.posterUrl, 4096),
      accessExpiresAt: this.normalizeNonNegativeInteger(item.accessExpiresAt),
    };
  }

  private normalizeProcessingStatus(
    value: IAdminVideoProcessingStatus
  ): IAdminVideoProcessingStatus {
    const providerStatus = value?.provider?.status === 'READY' ||
      value?.provider?.status === 'EMULATOR_SKIPPED'
      ? value.provider.status
      : 'UNAVAILABLE';
    const operationalState = value?.state === 'READY' ||
      value?.state === 'EMULATOR'
      ? value.state
      : 'DEGRADED';

    return {
      state: operationalState,
      checkedAt: this.normalizeNonNegativeInteger(value?.checkedAt),
      provider: {
        status: providerStatus,
        reachable: value?.provider?.reachable === true,
        projectId: this.normalizeOptionalText(value?.provider?.projectId, 160),
        location:
          this.normalizeOptionalText(value?.provider?.location, 120) ||
          'não informada',
        templateId:
          this.normalizeOptionalText(value?.provider?.templateId, 180) ||
          'não informado',
        bucketName: this.normalizeOptionalText(
          value?.provider?.bucketName,
          240
        ),
        checkedAt: this.normalizeNonNegativeInteger(
          value?.provider?.checkedAt
        ),
        errorCode: this.normalizeOptionalText(
          value?.provider?.errorCode,
          160
        ),
        errorMessage: this.normalizeOptionalText(
          value?.provider?.errorMessage,
          500
        ),
      },
      queue: {
        counts: this.normalizeProcessingCounts(value?.queue?.counts),
        activeTotal: this.normalizeNonNegativeInteger(
          value?.queue?.activeTotal
        ),
        sampledActiveJobs: this.normalizeNonNegativeInteger(
          value?.queue?.sampledActiveJobs
        ),
        oldestActiveAgeMs: this.normalizeOptionalPositiveInteger(
          value?.queue?.oldestActiveAgeMs
        ),
        staleSampledJobs: this.normalizeNonNegativeInteger(
          value?.queue?.staleSampledJobs
        ),
        sampleCapped: value?.queue?.sampleCapped === true,
      },
      dispatch: this.normalizeDispatchStatus(value?.dispatch),
      deadLetters: this.normalizeDeadLetters(value?.deadLetters),
      audit: this.normalizeAudit(value?.audit),
      alerts: Array.isArray(value?.alerts)
        ? value.alerts.map((alert) => this.normalizeAlert(alert))
        : [],
    };
  }

  private normalizeDispatchStatus(
    value: IAdminVideoProcessingDispatchStatus | null | undefined
  ): IAdminVideoProcessingDispatchStatus {
    return {
      counts: this.normalizeDispatchCounts(value?.counts),
      pendingTotal: this.normalizeNonNegativeInteger(value?.pendingTotal),
      oldestPendingAgeMs: this.normalizeOptionalPositiveInteger(
        value?.oldestPendingAgeMs
      ),
      recentWindowMs: this.normalizeNonNegativeInteger(value?.recentWindowMs),
      recentTotal: this.normalizeNonNegativeInteger(value?.recentTotal),
      completedRecent: this.normalizeNonNegativeInteger(
        value?.completedRecent
      ),
      failedRecent: this.normalizeNonNegativeInteger(value?.failedRecent),
      duplicateRecent: this.normalizeNonNegativeInteger(
        value?.duplicateRecent
      ),
      latencySampleSize: this.normalizeNonNegativeInteger(
        value?.latencySampleSize
      ),
      averageLatencyMs: this.normalizeOptionalPositiveInteger(
        value?.averageLatencyMs
      ),
      p50LatencyMs: this.normalizeOptionalPositiveInteger(value?.p50LatencyMs),
      p95LatencyMs: this.normalizeOptionalPositiveInteger(value?.p95LatencyMs),
      sampleCapped: value?.sampleCapped === true,
    };
  }

  private normalizeDeadLetters(
    value: IAdminVideoProcessingDeadLetters | null | undefined
  ): IAdminVideoProcessingDeadLetters {
    return {
      total: this.normalizeNonNegativeInteger(value?.total),
      recentWindowMs: this.normalizeNonNegativeInteger(value?.recentWindowMs),
      recentTotal: this.normalizeNonNegativeInteger(value?.recentTotal),
      sampledItems: this.normalizeNonNegativeInteger(value?.sampledItems),
      sampleCapped: value?.sampleCapped === true,
      failureCodes: Array.isArray(value?.failureCodes)
        ? value.failureCodes.map((item) => ({
            code:
              this.normalizeOptionalText(item?.code, 120) ||
              'UNCLASSIFIED_PROCESSING_FAILURE',
            count: this.normalizeNonNegativeInteger(item?.count),
            lastSeenAt: this.normalizeNonNegativeInteger(item?.lastSeenAt),
          }))
        : [],
      items: Array.isArray(value?.items)
        ? value.items
            .map((item) => this.normalizeDeadLetterItem(item))
            .filter((item) => !!item.ownerUid && !!item.videoId)
        : [],
    };
  }

  private normalizeDeadLetterItem(
    value: IAdminVideoProcessingDeadLetterItem
  ): IAdminVideoProcessingDeadLetterItem {
    return {
      deadLetterId: this.normalizeOptionalText(value?.deadLetterId, 128) || '',
      jobId: this.normalizeJobId(value?.jobId),
      ownerUid: this.normalizeId(value?.ownerUid),
      videoId: this.normalizeId(value?.videoId),
      processingVersion:
        this.normalizeOptionalText(value?.processingVersion, 128) || '',
      attempts: this.normalizeNonNegativeInteger(value?.attempts),
      providerState: this.normalizeOptionalText(value?.providerState, 160),
      errorCode: this.normalizeOptionalText(value?.errorCode, 120),
      errorMessage: this.normalizeOptionalText(value?.errorMessage, 500),
      failedAt: this.normalizeNonNegativeInteger(value?.failedAt),
    };
  }

  private normalizeAudit(
    value: IAdminVideoProcessingAudit | null | undefined
  ): IAdminVideoProcessingAudit {
    return {
      items: Array.isArray(value?.items)
        ? value.items
            .map((item) => this.normalizeAuditItem(item))
            .filter((item) => !!item.adminUid && !!item.videoId)
        : [],
      skippedItems: this.normalizeNonNegativeInteger(value?.skippedItems),
      sampleCapped: value?.sampleCapped === true,
    };
  }

  private normalizeAuditItem(
    value: IAdminVideoProcessingAuditItem
  ): IAdminVideoProcessingAuditItem {
    return {
      logId: this.normalizeOptionalText(value?.logId, 128) || '',
      adminUid: this.normalizeId(value?.adminUid),
      ownerUid: this.normalizeId(value?.ownerUid),
      videoId: this.normalizeId(value?.videoId),
      operation: this.normalizeOptionalText(value?.operation, 80) || '',
      operationId: this.normalizeOptionalText(value?.operationId, 128) || '',
      previousState: this.normalizeOptionalText(value?.previousState, 80),
      nextState: this.normalizeOptionalText(value?.nextState, 80),
      reason: this.normalizeOptionalText(value?.reason, 900) || '',
      timestamp: this.normalizeNonNegativeInteger(value?.timestamp),
    };
  }

  private normalizeAlert(
    value: IAdminVideoProcessingAlert
  ): IAdminVideoProcessingAlert {
    const code = String(value?.code ?? '').trim().toUpperCase();
    const severity = String(value?.severity ?? '').trim().toUpperCase();

    return {
      code: PROCESSING_ALERT_CODES.includes(
        code as AdminVideoProcessingAlertCode
      )
        ? code as AdminVideoProcessingAlertCode
        : 'ACTIVE_SAMPLE_CAPPED',
      severity: PROCESSING_ALERT_SEVERITIES.includes(
        severity as AdminVideoProcessingAlertSeverity
      )
        ? severity as AdminVideoProcessingAlertSeverity
        : 'INFO',
      title: this.normalizeOptionalText(value?.title, 160) ||
        'Alerta operacional',
      message: this.normalizeOptionalText(value?.message, 500) ||
        'O processamento requer verificação administrativa.',
      value: this.normalizeOptionalNonNegativeInteger(value?.value),
    };
  }

  private normalizeProcessingCounts(
    value: Partial<AdminVideoProcessingJobCounts> | null | undefined
  ): AdminVideoProcessingJobCounts {
    const counts = {} as AdminVideoProcessingJobCounts;

    PROCESSING_JOB_STATES.forEach((state) => {
      counts[state] = this.normalizeNonNegativeInteger(value?.[state]);
    });

    return counts;
  }

  private normalizeDispatchCounts(
    value: Partial<AdminVideoProcessingDispatchCounts> | null | undefined
  ): AdminVideoProcessingDispatchCounts {
    const counts = {} as AdminVideoProcessingDispatchCounts;

    PROCESSING_DISPATCH_STATES.forEach((state) => {
      counts[state] = this.normalizeNonNegativeInteger(value?.[state]);
    });

    return counts;
  }

  private normalizeId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
  }

  private normalizeJobId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,300}$/.test(normalized) ? normalized : '';
  }

  private normalizeOptionalText(
    value: unknown,
    maxLength: number
  ): string | null {
    const normalized = String(value ?? '').trim().slice(0, maxLength);
    return normalized || null;
  }

  private normalizeNonNegativeInteger(value: unknown): number {
    const numberValue = Number(value ?? 0);

    return Number.isFinite(numberValue) && numberValue >= 0
      ? Math.trunc(numberValue)
      : 0;
  }

  private normalizeOptionalNonNegativeInteger(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0
      ? Math.trunc(numberValue)
      : null;
  }

  private normalizeOptionalPositiveInteger(value: unknown): number | null {
    const numberValue = Number(value ?? 0);

    return Number.isFinite(numberValue) && numberValue > 0
      ? Math.trunc(numberValue)
      : null;
  }

  private reportError(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha na moderação administrativa de vídeos.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'AdminVideoModerationService',
        operation,
        ...context,
      };
      (normalized as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
