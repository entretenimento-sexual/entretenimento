import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';

export type AdminPhotoRankingBackfillStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED';

export type AdminPhotoRankingBackfillAction =
  | 'START_OR_RESUME'
  | 'PAUSE'
  | 'RUN_PAGE'
  | 'RESET';

export interface IAdminPhotoRankingBackfillState {
  version: number;
  status: AdminPhotoRankingBackfillStatus;
  pageSize: number;
  processedCount: number;
  updatedCount: number;
  skippedCount: number;
  pagesCount: number;
  consecutiveFailures: number;
  startedAt: number | null;
  updatedAt: number;
  completedAt: number | null;
  lastBatchAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastAdminAction: AdminPhotoRankingBackfillAction | null;
  generation: number;
}

export interface IAdminPhotoRankingBackfillStatusResponse {
  state: IAdminPhotoRankingBackfillState;
  leaseActive: boolean;
  checkedAt: number;
}

export interface IAdminPhotoRankingBackfillBatchResult {
  acquired: boolean;
  completed: boolean;
  processed: number;
  updated: number;
  skipped: number;
  status: AdminPhotoRankingBackfillStatus;
}

export interface IAdminPhotoRankingBackfillControlResult {
  action: AdminPhotoRankingBackfillAction;
  alreadyApplied: boolean;
  state: IAdminPhotoRankingBackfillState;
  batch: IAdminPhotoRankingBackfillBatchResult | null;
}

interface RawBackfillState {
  version?: unknown;
  status?: unknown;
  pageSize?: unknown;
  processedCount?: unknown;
  updatedCount?: unknown;
  skippedCount?: unknown;
  pagesCount?: unknown;
  consecutiveFailures?: unknown;
  startedAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
  lastBatchAt?: unknown;
  lastErrorCode?: unknown;
  lastErrorMessage?: unknown;
  lastAdminAction?: unknown;
  generation?: unknown;
}

interface RawStatusResponse {
  state?: RawBackfillState;
  leaseActive?: unknown;
  checkedAt?: unknown;
}

interface RawBatchResult {
  acquired?: unknown;
  completed?: unknown;
  processed?: unknown;
  updated?: unknown;
  skipped?: unknown;
  status?: unknown;
}

interface RawControlResponse {
  action?: unknown;
  alreadyApplied?: unknown;
  state?: RawBackfillState;
  batch?: RawBatchResult | null;
}

interface ControlRequest {
  action: AdminPhotoRankingBackfillAction;
  operationId: string;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 120;
const MIN_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 180;

function normalizeNonNegativeInteger(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : 0;
}

function normalizeNullableTimestamp(value: unknown): number | null {
  const timestamp = normalizeNonNegativeInteger(value);
  return timestamp > 0 ? timestamp : null;
}

function normalizePageSize(value: unknown): number {
  const numeric = Number(value ?? DEFAULT_PAGE_SIZE);

  if (!Number.isFinite(numeric)) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.max(MIN_PAGE_SIZE, Math.min(MAX_PAGE_SIZE, Math.trunc(numeric)));
}

function normalizeStatus(value: unknown): AdminPhotoRankingBackfillStatus {
  const status = String(value ?? '').trim().toUpperCase();

  if (
    status === 'IDLE' ||
    status === 'RUNNING' ||
    status === 'PAUSED' ||
    status === 'COMPLETED' ||
    status === 'FAILED'
  ) {
    return status;
  }

  return 'IDLE';
}

function normalizeAction(value: unknown): AdminPhotoRankingBackfillAction | null {
  const action = String(value ?? '').trim().toUpperCase();

  if (
    action === 'START_OR_RESUME' ||
    action === 'PAUSE' ||
    action === 'RUN_PAGE' ||
    action === 'RESET'
  ) {
    return action;
  }

  return null;
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  const text = String(value ?? '').trim().slice(0, maxLength);
  return text || null;
}

export function normalizeAdminPhotoRankingBackfillState(
  value: unknown
): IAdminPhotoRankingBackfillState {
  const state = typeof value === 'object' && value !== null
    ? value as RawBackfillState
    : {};

  return {
    version: normalizeNonNegativeInteger(state.version),
    status: normalizeStatus(state.status),
    pageSize: normalizePageSize(state.pageSize),
    processedCount: normalizeNonNegativeInteger(state.processedCount),
    updatedCount: normalizeNonNegativeInteger(state.updatedCount),
    skippedCount: normalizeNonNegativeInteger(state.skippedCount),
    pagesCount: normalizeNonNegativeInteger(state.pagesCount),
    consecutiveFailures: normalizeNonNegativeInteger(
      state.consecutiveFailures
    ),
    startedAt: normalizeNullableTimestamp(state.startedAt),
    updatedAt: normalizeNonNegativeInteger(state.updatedAt),
    completedAt: normalizeNullableTimestamp(state.completedAt),
    lastBatchAt: normalizeNullableTimestamp(state.lastBatchAt),
    lastErrorCode: normalizeOptionalText(state.lastErrorCode, 100),
    lastErrorMessage: normalizeOptionalText(state.lastErrorMessage, 300),
    lastAdminAction: normalizeAction(state.lastAdminAction),
    generation: Math.max(1, normalizeNonNegativeInteger(state.generation)),
  };
}

export function normalizeAdminPhotoRankingBackfillStatusResponse(
  value: unknown
): IAdminPhotoRankingBackfillStatusResponse {
  const response = typeof value === 'object' && value !== null
    ? value as RawStatusResponse
    : {};

  return {
    state: normalizeAdminPhotoRankingBackfillState(response.state),
    leaseActive: response.leaseActive === true,
    checkedAt: normalizeNonNegativeInteger(response.checkedAt),
  };
}

function normalizeBatchResult(
  value: RawBatchResult | null | undefined
): IAdminPhotoRankingBackfillBatchResult | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    acquired: value.acquired === true,
    completed: value.completed === true,
    processed: normalizeNonNegativeInteger(value.processed),
    updated: normalizeNonNegativeInteger(value.updated),
    skipped: normalizeNonNegativeInteger(value.skipped),
    status: normalizeStatus(value.status),
  };
}

@Injectable({ providedIn: 'root' })
export class AdminPhotoRankingBackfillService {
  private readonly functions = inject(Functions);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  getStatus$(): Observable<IAdminPhotoRankingBackfillStatusResponse> {
    return defer(() => {
      const callable = httpsCallable<
        Record<string, never>,
        RawStatusResponse
      >(this.functions, 'getPhotoRankingBackfillStatus');

      return from(callable({}));
    }).pipe(
      map((response) =>
        normalizeAdminPhotoRankingBackfillStatusResponse(response.data)
      ),
      catchError((error) => {
        this.reportError(error, 'getStatus$', {});
        return throwError(() => error);
      })
    );
  }

  control$(command: {
    action: AdminPhotoRankingBackfillAction;
    operationId: string;
    pageSize: number;
  }): Observable<IAdminPhotoRankingBackfillControlResult> {
    const payload: ControlRequest = {
      action: command.action,
      operationId: this.normalizeOperationId(command.operationId),
      pageSize: normalizePageSize(command.pageSize),
    };

    if (!payload.operationId) {
      return throwError(
        () => new Error('Identificador da operação administrativa inválido.')
      );
    }

    return defer(() => {
      const callable = httpsCallable<ControlRequest, RawControlResponse>(
        this.functions,
        'controlPhotoRankingBackfill'
      );

      return from(callable(payload));
    }).pipe(
      map((response) => {
        const action = normalizeAction(response.data?.action);

        if (!action) {
          throw new Error('Resposta inválida do controle de backfill.');
        }

        return {
          action,
          alreadyApplied: response.data?.alreadyApplied === true,
          state: normalizeAdminPhotoRankingBackfillState(
            response.data?.state
          ),
          batch: normalizeBatchResult(response.data?.batch),
        };
      }),
      catchError((error) => {
        this.reportError(error, 'control$', {
          action: payload.action,
          pageSize: payload.pageSize,
        });
        return throwError(() => error);
      })
    );
  }

  private normalizeOperationId(value: unknown): string {
    const operationId = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{8,128}$/.test(operationId) ? operationId : '';
  }

  private reportError(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha no painel de migração do ranking de fotos.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'AdminPhotoRankingBackfillService',
        operation,
        ...context,
      };
      (normalized as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalized);
    } catch {
      // O painel não deve falhar caso a telemetria esteja indisponível.
    }
  }
}
