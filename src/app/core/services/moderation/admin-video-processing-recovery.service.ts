import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import { AdminVideoProcessingJobState } from './admin-video-moderation.service';

export type AdminVideoProcessingRecoveryAction =
  | 'RETRY_FAILED'
  | 'RECHECK_STALE'
  | 'RECHECK_UNCONFIRMED'
  | 'RECHECK_PROVIDER'
  | 'CANCEL_ACTIVE';

export interface IAdminVideoProcessingRecoveryJob {
  jobId: string;
  ownerUid: string;
  videoId: string;
  processingVersion: string;
  state: AdminVideoProcessingJobState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  ageMs: number;
  stale: boolean;
  timestampEvidence: 'UPDATED' | 'CREATED_FALLBACK' | 'UNVERIFIED';
  hasExternalJob: boolean;
  requiresProviderReview: boolean;
  requiresOperationalAttention: boolean;
  providerPollFailureCount: number;
  providerPollLastFailedAt: number | null;
  providerPollReviewRequired: boolean;
  unconfirmedSubmission: boolean;
  lastErrorCode: string | null;
  lastError: string | null;
  availableActions: AdminVideoProcessingRecoveryAction[];
}

export interface IAdminRecoveryPageAudit {
  scope: 'PAGE_ONLY';
  observed: number;
  invalidDocuments: number;
  updatedTimestamp: number;
  createdFallback: number;
  unverifiedTimestamp: number;
  failed: number;
  stale: number;
  providerReview: number;
  providerPollReview: number;
  overdueCancellation: number;
  unconfirmedSubmission: number;
}

interface ListRecoveryJobsRequest {
  limit: number;
  cursor?: string | null;
}

interface ListRecoveryJobsResponse {
  items: IAdminVideoProcessingRecoveryJob[];
  skippedItems: number;
  checkedAt: number;
  scanned: number;
  hasMore: boolean;
  nextCursor: string | null;
  orderScope: 'WITHIN_PAGE';
  audit?: IAdminRecoveryPageAudit;
}

interface RecoverVideoProcessingRequest {
  ownerUid: string;
  videoId: string;
  action: AdminVideoProcessingRecoveryAction;
  reason: string;
  operationId: string;
  expectedProcessingVersion?: string;
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
  audit: IAdminRecoveryPageAudit;
  items: IAdminVideoProcessingRecoveryJob[];
  skippedItems: number;
  checkedAt: number;
  scanned: number;
  hasMore: boolean;
  nextCursor: string | null;
  orderScope: 'WITHIN_PAGE';
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
  'RECHECK_UNCONFIRMED',
  'RECHECK_PROVIDER',
  'CANCEL_ACTIVE',
];

@Injectable({ providedIn: 'root' })
export class AdminVideoProcessingRecoveryService {
  private readonly functions = inject(Functions);
  private readonly mediaError = inject(MediaApplicationErrorService);

  listRecoveryJobs$(limit = 30, cursor: string | null = null): Observable<IAdminVideoProcessingRecoveryQueue> {
    const safeLimit = Math.max(1, Math.min(60, Math.trunc(limit)));

    return defer(() => {
      const callable = httpsCallable<
        ListRecoveryJobsRequest,
        ListRecoveryJobsResponse
      >(this.functions, 'listVideoProcessingRecoveryJobs');

      return from(callable({ limit: safeLimit, cursor }));
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
        scanned: this.normalizeNonNegativeInteger(response.data?.scanned),
        hasMore: response.data?.hasMore === true &&
          typeof response.data?.nextCursor === 'string' &&
          /^[A-Za-z0-9_-]{1,2048}$/.test(response.data.nextCursor),
        nextCursor: response.data?.hasMore === true &&
          typeof response.data?.nextCursor === 'string' &&
          /^[A-Za-z0-9_-]{1,2048}$/.test(response.data.nextCursor)
          ? response.data.nextCursor : null,
        orderScope: 'WITHIN_PAGE' as const,
        audit: this.normalizeAudit(response.data?.audit),
      })),
      catchError((error) => {
        this.mediaError.reportSilently(
          error,
          'adminVideoProcessing.listRecoveryJobs',
          undefined,
          {
            scope: 'AdminVideoProcessingRecoveryService',
          },
          'video_recovery_queue_load_failed'
        );
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
    expectedProcessingVersion?: string;
  }): Observable<IAdminVideoProcessingRecoveryResult> {
    const action = this.normalizeAction(command.action);
    if (!action) {
      return throwError(() => new Error('Ação administrativa desconhecida.'));
    }

    const payload: RecoverVideoProcessingRequest = {
      ownerUid: this.normalizeId(command.ownerUid),
      videoId: this.normalizeId(command.videoId),
      action,
      reason: String(command.reason ?? '').trim().slice(0, 900),
      operationId: this.normalizeOperationId(command.operationId),
      expectedProcessingVersion: this.normalizeId(command.expectedProcessingVersion),
    };

    if (
      !payload.ownerUid ||
      !payload.videoId ||
      !payload.action ||
      !payload.operationId ||
      (payload.action === 'RECHECK_PROVIDER' && !payload.expectedProcessingVersion)
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
        this.mediaError.report(error, {
          operation: 'adminVideoProcessing.recoverJob',
          reasonHint: 'video_recovery_action_failed',
          metadata: {
            scope: 'AdminVideoProcessingRecoveryService',
            action: payload.action,
            hasOwnerUid: true,
            hasVideoId: true,
          },
        });
        return throwError(() => error);
      })
    );
  }

  private normalizeAudit(value: IAdminRecoveryPageAudit | undefined): IAdminRecoveryPageAudit {
    const number = (field: keyof Omit<IAdminRecoveryPageAudit, 'scope'>) =>
      this.normalizeNonNegativeInteger(value?.[field]);
    return {
      scope: 'PAGE_ONLY',
      observed: number('observed'),
      invalidDocuments: number('invalidDocuments'),
      updatedTimestamp: number('updatedTimestamp'),
      createdFallback: number('createdFallback'),
      unverifiedTimestamp: number('unverifiedTimestamp'),
      failed: number('failed'),
      stale: number('stale'),
      providerReview: number('providerReview'),
      providerPollReview: number('providerPollReview'),
      overdueCancellation: number('overdueCancellation'),
      unconfirmedSubmission: number('unconfirmedSubmission'),
    };
  }

  private normalizeItem(
    value: IAdminVideoProcessingRecoveryJob
  ): IAdminVideoProcessingRecoveryJob {
    const state = this.normalizeState(value?.state);

    return {
      jobId: this.normalizeId(value?.jobId),
      ownerUid: this.normalizeId(value?.ownerUid),
      videoId: this.normalizeId(value?.videoId),
      processingVersion: this.normalizeId(value?.processingVersion),
      state,
      attempts: this.normalizeNonNegativeInteger(value?.attempts),
      createdAt: this.normalizeNonNegativeInteger(value?.createdAt),
      updatedAt: this.normalizeNonNegativeInteger(value?.updatedAt),
      ageMs: this.normalizeNonNegativeInteger(value?.ageMs),
      stale: value?.stale === true,
      timestampEvidence: value?.timestampEvidence === 'UPDATED'
        ? 'UPDATED'
        : value?.timestampEvidence === 'CREATED_FALLBACK'
          ? 'CREATED_FALLBACK' : 'UNVERIFIED',
      hasExternalJob: value?.hasExternalJob === true,
      requiresProviderReview: value?.requiresProviderReview === true,
      requiresOperationalAttention: value?.requiresOperationalAttention === true,
      providerPollFailureCount:
        this.normalizeNonNegativeInteger(value?.providerPollFailureCount),
      providerPollLastFailedAt: value?.providerPollLastFailedAt == null
        ? null : this.normalizeNonNegativeInteger(value.providerPollLastFailedAt),
      providerPollReviewRequired: value?.providerPollReviewRequired === true,
      unconfirmedSubmission: value?.unconfirmedSubmission === true,
      lastErrorCode: this.normalizeOptionalText(value?.lastErrorCode, 160),
      lastError: this.normalizeOptionalText(value?.lastError, 500),
      availableActions: Array.isArray(value?.availableActions)
        ? value.availableActions
            .map((action) => this.normalizeAction(action))
            .filter((action): action is AdminVideoProcessingRecoveryAction => action !== null)
        : [],
    };
  }

  private normalizeResult(
    value: IAdminVideoProcessingRecoveryResult
  ): IAdminVideoProcessingRecoveryResult {
    const action = this.normalizeAction(value?.action);
    if (!action) {
      throw new Error('Resposta administrativa com ação desconhecida.');
    }

    return {
      ownerUid: this.normalizeId(value?.ownerUid),
      videoId: this.normalizeId(value?.videoId),
      previousState: this.normalizeState(value?.previousState),
      nextState: this.normalizeState(value?.nextState),
      action,
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

  private normalizeAction(
    value: unknown
  ): AdminVideoProcessingRecoveryAction | null {
    const normalized = String(value ?? '').trim().toUpperCase();
    return RECOVERY_ACTIONS.includes(
      normalized as AdminVideoProcessingRecoveryAction
    )
      ? normalized as AdminVideoProcessingRecoveryAction
      : null;
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


}
