import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { AdminVideoProcessingJobState } from './admin-video-moderation.service';

export type AdminVideoProcessingRecoveryAction =
  | 'RETRY_FAILED'
  | 'RECHECK_STALE'
  | 'CANCEL_ACTIVE';

export interface IAdminVideoProcessingRecoveryJob {
  jobId: string;
  ownerUid: string;
  videoId: string;
  state: AdminVideoProcessingJobState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  ageMs: number;
  stale: boolean;
  hasExternalJob: boolean;
  lastErrorCode: string | null;
  lastError: string | null;
  availableActions: AdminVideoProcessingRecoveryAction[];
}

interface ListRecoveryJobsRequest {
  limit: number;
}

interface ListRecoveryJobsResponse {
  items: IAdminVideoProcessingRecoveryJob[];
  skippedItems: number;
  checkedAt: number;
}

interface RecoverVideoProcessingRequest {
  ownerUid: string;
  videoId: string;
  action: AdminVideoProcessingRecoveryAction;
  reason: string;
  operationId: string;
}

export interface IAdminVideoProcessingRecoveryResult {
  ownerUid: string;
  videoId: string;
  previousState: AdminVideoProcessingJobState;
  nextState: AdminVideoProcessingJobState;
  action: AdminVideoProcessingRecoveryAction;
  alreadyApplied: boolean;
  cleanupPending: boolean;
}

export interface IAdminVideoProcessingRecoveryQueue {
  items: IAdminVideoProcessingRecoveryJob[];
  skippedItems: number;
  checkedAt: number;
}

const JOB_STATES: AdminVideoProcessingJobState[] = [
  'QUEUED',
  'SUBMITTING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
];

const RECOVERY_ACTIONS: AdminVideoProcessingRecoveryAction[] = [
  'RETRY_FAILED',
  'RECHECK_STALE',
  'CANCEL_ACTIVE',
];

@Injectable({ providedIn: 'root' })
export class AdminVideoProcessingRecoveryService {
  private readonly functions = inject(Functions);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  listRecoveryJobs$(limit = 30): Observable<IAdminVideoProcessingRecoveryQueue> {
    const safeLimit = Math.max(1, Math.min(60, Math.trunc(limit)));

    return defer(() => {
      const callable = httpsCallable<
        ListRecoveryJobsRequest,
        ListRecoveryJobsResponse
      >(this.functions, 'listVideoProcessingRecoveryJobs');

      return from(callable({ limit: safeLimit }));
    }).pipe(
      map((response) => ({
        items: Array.isArray(response.data?.items)
          ? response.data.items
              .map((item) => this.normalizeItem(item))
              .filter((item) => !!item.ownerUid && !!item.videoId)
          : [],
        skippedItems: this.normalizeNonNegativeInteger(
          response.data?.skippedItems
        ),
        checkedAt: this.normalizeNonNegativeInteger(response.data?.checkedAt),
      })),
      catchError((error) => {
        this.reportError(error, 'listRecoveryJobs$', {});
        return throwError(() => error);
      })
    );
  }

  recoverJob$(command: {
    ownerUid: string;
    videoId: string;
    action: AdminVideoProcessingRecoveryAction;
    reason: string;
    operationId: string;
  }): Observable<IAdminVideoProcessingRecoveryResult> {
    const payload: RecoverVideoProcessingRequest = {
      ownerUid: this.normalizeId(command.ownerUid),
      videoId: this.normalizeId(command.videoId),
      action: this.normalizeAction(command.action),
      reason: String(command.reason ?? '').trim().slice(0, 900),
      operationId: this.normalizeOperationId(command.operationId),
    };

    if (
      !payload.ownerUid ||
      !payload.videoId ||
      !payload.action ||
      !payload.operationId
    ) {
      return throwError(
        () => new Error('Comando inválido para recuperação do processamento.')
      );
    }

    if (payload.reason.length < 8) {
      return throwError(
        () => new Error('Informe uma justificativa objetiva para esta ação.')
      );
    }

    return defer(() => {
      const callable = httpsCallable<
        RecoverVideoProcessingRequest,
        IAdminVideoProcessingRecoveryResult
      >(this.functions, 'recoverVideoProcessingJob');

      return from(callable(payload));
    }).pipe(
      map((response) => this.normalizeResult(response.data)),
      catchError((error) => {
        this.reportError(error, 'recoverJob$', {
          action: payload.action,
          hasOwnerUid: true,
          hasVideoId: true,
        });
        return throwError(() => error);
      })
    );
  }

  private normalizeItem(
    value: IAdminVideoProcessingRecoveryJob
  ): IAdminVideoProcessingRecoveryJob {
    const state = this.normalizeState(value?.state);

    return {
      jobId: this.normalizeId(value?.jobId),
      ownerUid: this.normalizeId(value?.ownerUid),
      videoId: this.normalizeId(value?.videoId),
      state,
      attempts: this.normalizeNonNegativeInteger(value?.attempts),
      createdAt: this.normalizeNonNegativeInteger(value?.createdAt),
      updatedAt: this.normalizeNonNegativeInteger(value?.updatedAt),
      ageMs: this.normalizeNonNegativeInteger(value?.ageMs),
      stale: value?.stale === true,
      hasExternalJob: value?.hasExternalJob === true,
      lastErrorCode: this.normalizeOptionalText(value?.lastErrorCode, 160),
      lastError: this.normalizeOptionalText(value?.lastError, 500),
      availableActions: Array.isArray(value?.availableActions)
        ? value.availableActions
            .map((action) => this.normalizeAction(action))
            .filter((action) => !!action)
        : [],
    };
  }

  private normalizeResult(
    value: IAdminVideoProcessingRecoveryResult
  ): IAdminVideoProcessingRecoveryResult {
    return {
      ownerUid: this.normalizeId(value?.ownerUid),
      videoId: this.normalizeId(value?.videoId),
      previousState: this.normalizeState(value?.previousState),
      nextState: this.normalizeState(value?.nextState),
      action: this.normalizeAction(value?.action),
      alreadyApplied: value?.alreadyApplied === true,
      cleanupPending: value?.cleanupPending === true,
    };
  }

  private normalizeState(value: unknown): AdminVideoProcessingJobState {
    const normalized = String(value ?? '').trim().toUpperCase();
    return JOB_STATES.includes(normalized as AdminVideoProcessingJobState)
      ? normalized as AdminVideoProcessingJobState
      : 'FAILED';
  }

  private normalizeAction(value: unknown): AdminVideoProcessingRecoveryAction {
    const normalized = String(value ?? '').trim().toUpperCase();
    return RECOVERY_ACTIONS.includes(
      normalized as AdminVideoProcessingRecoveryAction
    )
      ? normalized as AdminVideoProcessingRecoveryAction
      : 'RECHECK_STALE';
  }

  private normalizeId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
  }

  private normalizeOperationId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{8,128}$/.test(normalized) ? normalized : '';
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

  private reportError(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha na recuperação administrativa de vídeos.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'AdminVideoProcessingRecoveryService',
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
