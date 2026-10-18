import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';

export interface IAdminVideoTerminalCleanupReview {
  queueId: string;
  processingVersion: string;
  attempts: number;
  updatedAt: number;
  ageMs: number;
  failureCode: string | null;
  recheckable: boolean;
  blocker: string | null;
}
export interface IAdminVideoTerminalCleanupReviews {
  checkedAt: number;
  totalReview: number;
  samplePartial: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  orderScope: 'WITHIN_PAGE';
  items: IAdminVideoTerminalCleanupReview[];
}
export interface IAdminVideoTerminalCleanupRecheckResult {
  queueId: string;
  scheduled: boolean;
  alreadyApplied: boolean;
}
interface RecheckCommand {
  queueId: string;
  processingVersion: string;
  expectedUpdatedAt: number;
  operationId: string;
  reason: string;
}

@Injectable({ providedIn: 'root' })
export class AdminVideoTerminalTemporaryCleanupService {
  private readonly functions = inject(Functions);
  private readonly mediaError = inject(MediaApplicationErrorService);

  listReviews$(limit = 30, cursor: string | null = null): Observable<IAdminVideoTerminalCleanupReviews> {
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
    return defer(() => from(httpsCallable<
      { limit: number; cursor: string | null }, IAdminVideoTerminalCleanupReviews
    >(this.functions, 'listVideoTerminalTemporaryCleanupReviews')({ limit: safeLimit, cursor }))).pipe(
      map(response => ({
        checkedAt: this.nonNegative(response.data?.checkedAt),
        totalReview: this.nonNegative(response.data?.totalReview),
        samplePartial: response.data?.samplePartial === true,
        hasMore: response.data?.hasMore === true &&
          typeof response.data?.nextCursor === 'string' &&
          /^[a-f0-9]{64}$/.test(response.data.nextCursor),
        nextCursor: response.data?.hasMore === true &&
          typeof response.data?.nextCursor === 'string' &&
          /^[a-f0-9]{64}$/.test(response.data.nextCursor)
          ? response.data.nextCursor : null,
        orderScope: 'WITHIN_PAGE' as const,
        items: Array.isArray(response.data?.items) ? response.data.items.map(item => ({
          queueId: /^[a-f0-9]{64}$/.test(String(item.queueId)) ? item.queueId : '',
          processingVersion: String(item.processingVersion ?? '').slice(0, 160),
          attempts: this.nonNegative(item.attempts),
          updatedAt: this.nonNegative(item.updatedAt),
          ageMs: this.nonNegative(item.ageMs),
          failureCode: String(item.failureCode ?? '').slice(0, 80) || null,
          recheckable: item.recheckable === true,
          blocker: String(item.blocker ?? '').slice(0, 100) || null,
        })).filter(item => !!item.queueId) : [],
      })),
      catchError(error => {
        this.mediaError.reportSilently(error, 'adminVideoTerminalCleanup.list',
          undefined, { scope: 'AdminVideoTerminalTemporaryCleanupService' },
          'video_terminal_cleanup_queue_load_failed');
        return throwError(() => error);
      })
    );
  }

  recheckReview$(command: RecheckCommand): Observable<IAdminVideoTerminalCleanupRecheckResult> {
    if (!/^[a-f0-9]{64}$/.test(command.queueId) ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(command.processingVersion) ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(command.operationId) ||
        !Number.isSafeInteger(command.expectedUpdatedAt) ||
        command.expectedUpdatedAt <= 0 ||
        String(command.reason ?? '').trim().length < 8) {
      return throwError(() => new Error('Dados inválidos para reconferência da limpeza.'));
    }
    const payload = { ...command, reason: command.reason.trim().slice(0, 900) };
    return defer(() => from(httpsCallable<
      RecheckCommand, IAdminVideoTerminalCleanupRecheckResult
    >(this.functions, 'recheckVideoTerminalTemporaryCleanup')(payload))).pipe(
      map(response => response.data),
      catchError(error => {
        this.mediaError.report(error, {
          operation: 'adminVideoTerminalCleanup.recheck',
          reasonHint: 'video_terminal_cleanup_action_failed',
          metadata: { scope: 'AdminVideoTerminalTemporaryCleanupService' },
        });
        return throwError(() => error);
      })
    );
  }

  private nonNegative(value: unknown): number {
    const number = Number(value ?? 0);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }
}
