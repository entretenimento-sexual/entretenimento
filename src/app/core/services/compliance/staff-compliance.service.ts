import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

export interface IssueSuspectedViolationNoticeInput {
  targetUid: string;
  category: string;
  summary: string;
  policySection: string;
  responseDueAt?: number | null;
  preventiveMeasure?: string | null;
}

export interface IssueSuspectedViolationNoticeResult {
  ok: true;
  caseId: string;
  status: 'AWAITING_USER_RESPONSE';
  responseDueAt: number;
}

@Injectable({ providedIn: 'root' })
export class StaffComplianceService {
  private readonly functions = inject(Functions);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notifier = inject(ErrorNotificationService);

  private readonly issueNoticeCallable = httpsCallable<
    IssueSuspectedViolationNoticeInput,
    IssueSuspectedViolationNoticeResult
  >(this.functions, 'issueSuspectedViolationNotice');

  issueSuspectedViolationNotice$(
    input: IssueSuspectedViolationNoticeInput
  ): Observable<IssueSuspectedViolationNoticeResult> {
    const payload = this.normalizeInput(input);

    if (!payload.targetUid || payload.summary.length < 20) {
      return throwError(() => new Error('Dados do aviso de conformidade inválidos.'));
    }

    return defer(() => from(this.issueNoticeCallable(payload))).pipe(
      map((response) => response.data),
      catchError((error) => {
        this.report(error, payload.targetUid);
        this.notifier.showError(
          'Não foi possível emitir o aviso de possível violação.'
        );
        return throwError(() => error);
      })
    );
  }

  private normalizeInput(
    input: IssueSuspectedViolationNoticeInput
  ): IssueSuspectedViolationNoticeInput {
    return {
      targetUid: String(input?.targetUid ?? '').trim(),
      category: String(input?.category ?? '').trim().toUpperCase(),
      summary: String(input?.summary ?? '').trim(),
      policySection: String(input?.policySection ?? '').trim(),
      responseDueAt:
        typeof input?.responseDueAt === 'number' &&
        Number.isFinite(input.responseDueAt)
          ? Math.trunc(input.responseDueAt)
          : null,
      preventiveMeasure:
        String(input?.preventiveMeasure ?? '').trim() || null,
    };
  }

  private report(error: unknown, targetUid: string): void {
    try {
      const reportable = error instanceof Error
        ? error
        : new Error('[StaffComplianceService] issue notice failed');
      (reportable as any).context = 'StaffComplianceService';
      (reportable as any).operation = 'issueSuspectedViolationNotice';
      (reportable as any).extra = { targetUid };
      (reportable as any).original = error;
      (reportable as any).skipUserNotification = true;
      this.globalError.handleError(reportable);
    } catch {
      // noop
    }
  }
}
