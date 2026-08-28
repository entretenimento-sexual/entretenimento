import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

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

export interface IAdminVideoProcessingQueueStatus {
  counts: AdminVideoProcessingJobCounts;
  activeTotal: number;
  sampledActiveJobs: number;
  oldestActiveAgeMs: number | null;
  staleSampledJobs: number;
  sampleCapped: boolean;
}

export interface IAdminVideoProcessingStatus {
  state: AdminVideoProcessingOperationalState;
  checkedAt: number;
  provider: IAdminVideoProcessingProviderStatus;
  queue: IAdminVideoProcessingQueueStatus;
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
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

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

  private reportError(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha no diagnóstico administrativo de vídeos.');

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