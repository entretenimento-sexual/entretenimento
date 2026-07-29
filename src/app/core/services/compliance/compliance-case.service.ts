import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { BehaviorSubject, Observable, defer, from, throwError } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';

import {
  ComplianceCaseCategory,
  ComplianceCaseItem,
  ComplianceCaseStatus,
  ComplianceCasesVm,
} from 'src/app/core/interfaces/compliance-case.interface';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

interface GetMyComplianceCasesResponse {
  items?: unknown[];
}

interface SubmitComplianceCaseResponsePayload {
  caseId: string;
  response: string;
}

interface SubmitComplianceCaseResponseResult {
  ok: true;
  caseId: string;
  status: 'USER_RESPONDED';
  respondedAtMs: number;
}

const INITIAL_VM: ComplianceCasesVm = {
  loading: false,
  submittingCaseId: null,
  items: [],
  error: null,
};

@Injectable({ providedIn: 'root' })
export class ComplianceCaseService {
  private readonly functions = inject(Functions);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notifier = inject(ErrorNotificationService);

  private readonly stateSubject = new BehaviorSubject<ComplianceCasesVm>(
    INITIAL_VM
  );

  readonly vm$: Observable<ComplianceCasesVm> = this.stateSubject.asObservable();

  private readonly getCasesCallable = httpsCallable<
    Record<string, never>,
    GetMyComplianceCasesResponse
  >(this.functions, 'getMyComplianceCases');

  private readonly submitResponseCallable = httpsCallable<
    SubmitComplianceCaseResponsePayload,
    SubmitComplianceCaseResponseResult
  >(this.functions, 'submitComplianceCaseResponse');

  load$(): Observable<ComplianceCaseItem[]> {
    this.patchState({ loading: true, error: null });

    return defer(() => from(this.getCasesCallable({}))).pipe(
      map((result) => this.normalizeItems(result.data?.items)),
      tap((items) => this.patchState({ items })),
      catchError((error) => {
        this.report(error, 'load', {});
        this.patchState({
          error: 'Não foi possível carregar os casos de conformidade.',
        });
        return throwError(() => error);
      }),
      finalize(() => this.patchState({ loading: false }))
    );
  }

  submitResponse$(
    caseId: string,
    response: string
  ): Observable<SubmitComplianceCaseResponseResult> {
    const safeCaseId = String(caseId ?? '').trim();
    const safeResponse = String(response ?? '').trim();

    if (!safeCaseId) {
      return throwError(() => new Error('Caso de conformidade inválido.'));
    }

    if (safeResponse.length < 20 || safeResponse.length > 4000) {
      this.notifier.showWarning(
        'Sua manifestação deve ter entre 20 e 4.000 caracteres.'
      );
      return throwError(() => new Error('Manifestação inválida.'));
    }

    this.patchState({ submittingCaseId: safeCaseId, error: null });

    return defer(() => from(this.submitResponseCallable({
      caseId: safeCaseId,
      response: safeResponse,
    }))).pipe(
      map((result) => result.data),
      tap((result) => {
        this.patchState({
          items: this.stateSubject.value.items.map((item) =>
            item.caseId === safeCaseId
              ? {
                  ...item,
                  status: 'USER_RESPONDED',
                  userResponse: safeResponse,
                  userRespondedAt: result.respondedAtMs,
                  updatedAt: result.respondedAtMs,
                }
              : item
          ),
        });
        this.notifier.showSuccess('Manifestação registrada para análise.');
      }),
      catchError((error) => {
        this.report(error, 'submitResponse', { caseId: safeCaseId });
        this.notifier.showError(
          'Não foi possível registrar sua manifestação agora.'
        );
        return throwError(() => error);
      }),
      finalize(() => this.patchState({ submittingCaseId: null }))
    );
  }

  private patchState(patch: Partial<ComplianceCasesVm>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch,
    });
  }

  private normalizeItems(value: unknown): ComplianceCaseItem[] {
    if (!Array.isArray(value)) return [];

    return value
      .map((item) => this.normalizeItem(item))
      .filter((item): item is ComplianceCaseItem => item !== null);
  }

  private normalizeItem(value: unknown): ComplianceCaseItem | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;
    const caseId = this.toText(source['caseId']);
    const summary = this.toText(source['summary']);
    const policySection = this.toText(source['policySection']);

    if (!caseId || !summary || !policySection) return null;

    return {
      caseId,
      category: this.normalizeCategory(source['category']),
      summary,
      policySection,
      preventiveMeasure: this.toText(source['preventiveMeasure']) || null,
      status: this.normalizeStatus(source['status']),
      presumption:
        this.toText(source['presumption']) || 'SUSPECTED_NOT_CONFIRMED',
      responseDueAt: this.toEpoch(source['responseDueAt']),
      userResponse: this.toText(source['userResponse']) || null,
      userRespondedAt: this.toEpoch(source['userRespondedAt']),
      resolution: this.toText(source['resolution']) || null,
      resolvedAt: this.toEpoch(source['resolvedAt']),
      createdAt: this.toEpoch(source['createdAt']),
      updatedAt: this.toEpoch(source['updatedAt']),
    };
  }

  private normalizeCategory(value: unknown): ComplianceCaseCategory {
    const normalized = this.toText(value) as ComplianceCaseCategory;
    const allowed: readonly ComplianceCaseCategory[] = [
      'AGE_OR_IDENTITY',
      'NON_CONSENSUAL_CONTENT',
      'ILLEGAL_CONTENT',
      'HARASSMENT_OR_THREAT',
      'FRAUD_OR_PAYMENT_ABUSE',
      'ACCOUNT_INTEGRITY',
      'OTHER_TERMS_VIOLATION',
    ];

    return allowed.includes(normalized)
      ? normalized
      : 'OTHER_TERMS_VIOLATION';
  }

  private normalizeStatus(value: unknown): ComplianceCaseStatus {
    const normalized = this.toText(value) as ComplianceCaseStatus;
    const allowed: readonly ComplianceCaseStatus[] = [
      'AWAITING_USER_RESPONSE',
      'USER_RESPONDED',
      'UNDER_REVIEW',
      'RESOLVED_NO_VIOLATION',
      'RESOLVED_ACTION_TAKEN',
      'CLOSED',
    ];

    return allowed.includes(normalized) ? normalized : 'UNDER_REVIEW';
  }

  private toText(value: unknown): string {
    return String(value ?? '').trim();
  }

  private toEpoch(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  private report(
    error: unknown,
    operation: string,
    extra: Record<string, unknown>
  ): void {
    try {
      const reportable = error instanceof Error
        ? error
        : new Error('[ComplianceCaseService] operation failed');
      (reportable as any).context = 'ComplianceCaseService';
      (reportable as any).operation = operation;
      (reportable as any).extra = extra;
      (reportable as any).original = error;
      (reportable as any).skipUserNotification = true;
      this.globalError.handleError(reportable);
    } catch {
      // Falha de diagnóstico não interfere no feedback já apresentado.
    }
  }
}
