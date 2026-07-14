// src/app/core/services/moderation/admin-moderation-report.service.ts
// -----------------------------------------------------------------------------
// ADMIN MODERATION REPORT SERVICE
// -----------------------------------------------------------------------------
// Serviço operacional para moderação/admin revisar denúncias.
//
// Decisões:
// - leitura/listagem depende das Firestore Rules com claim admin;
// - atualizações genéricas preservam o fluxo existente;
// - decisões sobre conteúdo de vídeo passam por Callable administrativa;
// - decisões são registradas também em /admin_logs;
// - operações AngularFire rodam via FirestoreContextService;
// - erros são reportados ao GlobalErrorHandlerService.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  IModerationReportVm,
  ModerationReportAction,
  ModerationReportReason,
  ModerationReportStatus,
  ModerationReportTargetType,
} from 'src/app/core/interfaces/moderation/moderation-report.interface';
import { toErrorInstance } from 'src/app/core/utils/firebase-error-utils';

export interface ModerationReportReviewPatch {
  status: Exclude<ModerationReportStatus, 'open'>;
  resolution?: string | null;
  previousStatus?: ModerationReportStatus | null;
  targetUserUid?: string | null;
  reportReason?: ModerationReportReason | null;
  reportTargetType?: ModerationReportTargetType | null;
}

interface NormalizedModerationReportReviewPatch {
  status: Exclude<ModerationReportStatus, 'open'>;
  previousStatus: ModerationReportStatus;
  targetUserUid: string;
  reportReason: ModerationReportReason | null;
  reportTargetType: ModerationReportTargetType | null;
  resolution: string | null;
}

interface ReviewVideoContentReportRequest {
  reportId: string;
  decision: ModerationReportAction;
  resolution: string;
}

interface ReviewVideoContentReportResponse {
  reportId: string;
  decision: ModerationReportAction;
  targetType: 'video' | 'video_comment' | 'video_rating';
  cleanupPending: boolean;
}

export interface AdminModerationReportVm extends IModerationReportVm {
  reviewedBy?: string | null;
  reviewedAt?: unknown;
  resolution?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminModerationReportService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly authSession = inject(AuthSessionService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly reviewVideoContentReportCallable = httpsCallable<
    ReviewVideoContentReportRequest,
    ReviewVideoContentReportResponse
  >(this.functions, 'reviewVideoContentReport');

  listReports$(): Observable<AdminModerationReportVm[]> {
    return this.firestoreContext.deferObservable$(() => {
      const reportsRef = collection(this.firestore, 'moderation_reports');
      const reportsQuery = query(reportsRef, orderBy('createdAt', 'desc'));

      return collectionData(
        reportsQuery,
        { idField: 'id' }
      ) as Observable<AdminModerationReportVm[]>;
    }).pipe(
      map((reports) => reports.map((report) => this.normalizeReport(report))),
      catchError((error) => {
        this.reportError(error, 'listReports', {});
        return throwError(() => error);
      })
    );
  }

  reviewReport$(
    reportId: string,
    patch: ModerationReportReviewPatch
  ): Observable<void> {
    const safeReportId = String(reportId ?? '').trim();
    const normalized = this.normalizePatch(patch);

    if (!safeReportId || !normalized) {
      return throwError(() => new Error('Revisão de denúncia inválida.'));
    }

    return this.authSession.readyUid$.pipe(
      take(1),
      switchMap((uid) => {
        const reviewerUid = String(uid ?? '').trim();

        if (!reviewerUid) {
          return throwError(
            () => new Error('Sessão administrativa não identificada.')
          );
        }

        return this.firestoreContext.deferPromise$(() => {
          const batch = writeBatch(this.firestore);
          const reportRef = doc(
            this.firestore,
            'moderation_reports',
            safeReportId
          );
          const adminLogRef = doc(collection(this.firestore, 'admin_logs'));
          const timestamp = serverTimestamp();

          batch.update(reportRef, {
            status: normalized.status,
            resolution: normalized.resolution,
            reviewedBy: reviewerUid,
            reviewedAt: timestamp,
            updatedAt: timestamp,
          });

          batch.set(adminLogRef, {
            adminUid: reviewerUid,
            action: 'moderationReportReview',
            targetUserUid: normalized.targetUserUid,
            details: {
              reportId: safeReportId,
              previousStatus: normalized.previousStatus,
              nextStatus: normalized.status,
              reason: normalized.reportReason,
              targetType: normalized.reportTargetType,
              resolution: normalized.resolution,
            },
            timestamp,
          });

          return batch.commit();
        }).pipe(map(() => void 0));
      }),
      catchError((error) => {
        this.reportError(error, 'reviewReport', {
          hasReportId: !!safeReportId,
          status: normalized.status,
        });

        return throwError(() => error);
      })
    );
  }

  reviewVideoContentReport$(
    reportId: string,
    decision: ModerationReportAction,
    resolution: string
  ): Observable<void> {
    const safeReportId = String(reportId ?? '').trim();
    const safeResolution = String(resolution ?? '').trim().slice(0, 900);

    if (
      !safeReportId ||
      !['KEEP', 'REMOVE'].includes(decision) ||
      safeResolution.length < 8
    ) {
      return throwError(
        () => new Error('Decisão de conteúdo de vídeo inválida.')
      );
    }

    return from(
      this.reviewVideoContentReportCallable({
        reportId: safeReportId,
        decision,
        resolution: safeResolution,
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(error, 'reviewVideoContentReport', {
          hasReportId: !!safeReportId,
          decision,
        });
        return throwError(() => error);
      })
    );
  }

  private normalizeReport(
    report: AdminModerationReportVm
  ): AdminModerationReportVm {
    return {
      ...report,
      id: String(report.id ?? '').trim(),
      reporterUid: String(report.reporterUid ?? '').trim(),
      targetType: report.targetType,
      targetId: String(report.targetId ?? '').trim(),
      parentTargetId: String(report.parentTargetId ?? '').trim() || null,
      targetOwnerUid: String(report.targetOwnerUid ?? '').trim() || null,
      targetAuthorUid: String(report.targetAuthorUid ?? '').trim() || null,
      reason: report.reason,
      details: String(report.details ?? '').trim() || null,
      route: String(report.route ?? '').trim() || null,
      status: report.status,
      moderationAction: report.moderationAction ?? null,
      source: report.source,
      resolution: String(report.resolution ?? '').trim() || null,
      reviewedBy: String(report.reviewedBy ?? '').trim() || null,
    };
  }

  private normalizePatch(
    patch: ModerationReportReviewPatch
  ): NormalizedModerationReportReviewPatch | null {
    const status = String(
      patch?.status ?? ''
    ).trim() as ModerationReportReviewPatch['status'];
    const previousStatus = String(
      patch?.previousStatus ?? 'open'
    ).trim() as ModerationReportStatus;
    const targetUserUid = String(patch?.targetUserUid ?? '').trim();
    const reportReason = String(
      patch?.reportReason ?? ''
    ).trim() as ModerationReportReason;
    const reportTargetType = String(
      patch?.reportTargetType ?? ''
    ).trim() as ModerationReportTargetType;
    const resolution = String(patch?.resolution ?? '').trim().slice(0, 900);

    if (!['reviewing', 'resolved', 'rejected'].includes(status)) {
      return null;
    }

    if (!['open', 'reviewing', 'resolved', 'rejected'].includes(previousStatus)) {
      return null;
    }

    if (!targetUserUid) {
      return null;
    }

    return {
      status,
      previousStatus,
      targetUserUid,
      reportReason: reportReason || null,
      reportTargetType: reportTargetType || null,
      resolution: resolution || null,
    };
  }

  private reportError(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): void {
    try {
      const normalizedError = toErrorInstance(
        error,
        `[AdminModerationReportService.${operation}] falhou.`
      );

      (normalizedError as any).feature = 'admin_moderation_reports';
      (normalizedError as any).operation = operation;
      (normalizedError as any).context = context;
      (normalizedError as any).original = error;
      this.globalError.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
