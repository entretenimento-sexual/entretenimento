import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';

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

export type AdminVideoProcessingJobCounts = Record<
  AdminVideoProcessingJobState,
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

export interface IAdminVideoCancellationBacklog {
  verification: 'UNVERIFIED';
  scheduleMinutes: number;
  sampled: number;
  due: number;
  overdue24h: number;
  missingOrInvalidDue: number;
  samplePartial: boolean;
}

export interface IAdminVideoProcessingQueueStatus {
  counts: AdminVideoProcessingJobCounts;
  activeTotal: number;
  sampledActiveJobs: number;
  oldestActiveAgeMs: number | null;
  staleSampledJobs: number;
  sampleCapped: boolean;
  cancellation: IAdminVideoCancellationBacklog | null;
}

export type AdminVideoSchedulerHealth = 'OPERATIONAL' | 'DEGRADED' | 'FAILED' | 'UNVERIFIED';
export type AdminVideoSchedulerName =
  | 'submitQueuedVideoProcessing'
  | 'reconcileVideoProcessing'
  | 'cleanupCancelledVideoProcessing';
export interface IAdminVideoSchedulerDiagnostic {
  scheduler: AdminVideoSchedulerName;
  intervalMinutes: number;
  health: AdminVideoSchedulerHealth;
  executionHealth: 'EXECUTED' | 'FAILED' | 'UNVERIFIED';
  jobsHealth: 'NO_ALERTS_OBSERVED' | 'ATTENTION' | 'UNVERIFIED';
  lastOutcome: 'OK' | 'ATTENTION' | 'FAILED' | null;
  lastFinishedAt: number | null;
  ageMs: number | null;
  durationMs: number | null;
  metrics: Readonly<Record<string, number | boolean>>;
}

export interface IAdminVideoProcessingStatus {
  state: AdminVideoProcessingOperationalState;
  checkedAt: number;
  provider: IAdminVideoProcessingProviderStatus;
  queue: IAdminVideoProcessingQueueStatus;
  schedulers: IAdminVideoSchedulerDiagnostic[];
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

/**
 * Diagnóstico operacional do pipeline de vídeo.
 *
 * Moderação de conteúdo não pertence a este serviço: denúncias são tratadas por
 * AdminModerationReportService e reviewVideoContentReport.
 */
@Injectable({ providedIn: 'root' })
export class AdminVideoModerationService {
  private readonly functions = inject(Functions);
  private readonly mediaError = inject(MediaApplicationErrorService);

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
        this.mediaError.reportSilently(
          error,
          'adminVideoProcessing.getStatus',
          undefined,
          {
            scope: 'AdminVideoModerationService',
          },
          'video_library_load_failed'
        );
        return throwError(() => error);
      })
    );
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
      schedulers: this.normalizeSchedulers(value?.schedulers),
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
        cancellation: value?.queue?.cancellation?.verification === 'UNVERIFIED'
          ? {
              verification: 'UNVERIFIED',
              scheduleMinutes: 30,
              sampled: this.normalizeNonNegativeInteger(
                value.queue.cancellation.sampled
              ),
              due: this.normalizeNonNegativeInteger(
                value.queue.cancellation.due
              ),
              overdue24h: this.normalizeNonNegativeInteger(
                value.queue.cancellation.overdue24h
              ),
              missingOrInvalidDue: this.normalizeNonNegativeInteger(
                value.queue.cancellation.missingOrInvalidDue
              ),
              samplePartial: value.queue.cancellation.samplePartial === true,
            }
          : null,
      },
    };
  }

  private normalizeSchedulers(
    value: IAdminVideoSchedulerDiagnostic[] | undefined
  ): IAdminVideoSchedulerDiagnostic[] {
    const names: AdminVideoSchedulerName[] = [
      'submitQueuedVideoProcessing', 'reconcileVideoProcessing',
      'cleanupCancelledVideoProcessing',
    ];
    return names.map(scheduler => {
      const item = Array.isArray(value) ? value.find(x => x?.scheduler === scheduler) : null;
      const health = item?.health === 'OPERATIONAL' || item?.health === 'DEGRADED' ||
        item?.health === 'FAILED' ? item.health : 'UNVERIFIED';
      const outcome = item?.lastOutcome === 'OK' || item?.lastOutcome === 'ATTENTION' ||
        item?.lastOutcome === 'FAILED' ? item.lastOutcome : null;
      const intervalMinutes = scheduler === 'cleanupCancelledVideoProcessing' ? 30 : 5;
      const safeMetrics: Record<string, number | boolean> = {};
      for (const key of ['selected', 'claimed', 'completed', 'taskRejected',
        'retryScheduled', 'reviewRequired', 'terminalSelected', 'terminalCompleted',
        'terminalRetryScheduled', 'terminalReviewRequired', 'batchLimitReached',
        'submissionConfirmed', 'submissionUnconfirmed', 'submissionRetryScheduled',
        'submissionFailed', 'submissionDeferred', 'recoveryConfirmed',
        'recoveryUnconfirmed', 'recoveryPollErrors', 'providerPollErrors',
        'providerReviewRequired', 'providerSucceededObserved', 'providerFailedObserved']) {
        const metric = item?.metrics?.[key];
        if (typeof metric === 'boolean' ||
            (typeof metric === 'number' && Number.isSafeInteger(metric) && metric >= 0)) {
          safeMetrics[key] = metric;
        }
      }
      return {
        scheduler, intervalMinutes, health, lastOutcome: outcome,
        executionHealth: item?.executionHealth === 'EXECUTED' ||
          item?.executionHealth === 'FAILED' ? item.executionHealth : 'UNVERIFIED',
        jobsHealth: item?.jobsHealth === 'NO_ALERTS_OBSERVED' ||
          item?.jobsHealth === 'ATTENTION' ? item.jobsHealth : 'UNVERIFIED',
        lastFinishedAt: this.normalizeOptionalPositiveInteger(item?.lastFinishedAt),
        ageMs: this.normalizeOptionalNonNegativeInteger(item?.ageMs),
        durationMs: this.normalizeOptionalNonNegativeInteger(item?.durationMs),
        metrics: safeMetrics,
      };
    });
  }

  private normalizeOptionalNonNegativeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value : null;
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

  private normalizeOptionalPositiveInteger(value: unknown): number | null {
    const numberValue = Number(value ?? 0);

    return Number.isFinite(numberValue) && numberValue > 0
      ? Math.trunc(numberValue)
      : null;
  }


}