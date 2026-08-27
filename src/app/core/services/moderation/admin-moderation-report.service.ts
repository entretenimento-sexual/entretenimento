// src/app/core/services/moderation/admin-moderation-report.service.ts
// -----------------------------------------------------------------------------
// ADMIN MODERATION REPORT SERVICE
// -----------------------------------------------------------------------------
// Serviço operacional para moderação/admin revisar denúncias.
//
// Decisões:
// - leitura/listagem depende das Firestore Rules com claim admin;
// - atualizações genéricas preservam o fluxo existente;
// - decisões sobre foto, vídeo e conteúdo comunitário passam por Callables;
// - possível menoridade em perfil usa Callables específicas e auditáveis;
// - Functions é resolvido somente quando uma decisão especializada é executada;
// - decisões são registradas também em /admin_logs;
// - operações AngularFire rodam via FirestoreContextService;
// - erros são reportados ao GlobalErrorHandlerService.
// -----------------------------------------------------------------------------

import {
  EnvironmentInjector,
  Injectable,
  inject,
  runInInjectionContext,
} from '@angular/core';
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
  ModerationAgeReverificationStatus,
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

interface ReviewPhotoContentReportRequest {
  reportId: string;
  decision: ModerationReportAction;
  resolution: string;
}

interface ReviewPhotoContentReportResponse {
  reportId: string;
  decision: ModerationReportAction;
  targetType: 'photo';
  cleanupPending: boolean;
  evidencePreservationPending?: boolean;
  evidenceReleasePending?: boolean;
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
  evidencePreservationPending?: boolean;
  evidenceReleasePending?: boolean;
}

interface ReviewCommunityFeedPostReportRequest {
  reportId: string;
  decision: ModerationReportAction;
  resolution: string;
}

interface ReviewCommunityFeedPostReportResponse {
  reportId: string;
  decision: ModerationReportAction;
  targetType: 'community_feed_post';
}

interface ReviewCommunityFeedCommentReportRequest {
  reportId: string;
  decision: ModerationReportAction;
  resolution: string;
}

interface ReviewCommunityFeedCommentReportResponse {
  reportId: string;
  decision: ModerationReportAction;
  targetType: 'community_feed_comment';
}

interface ReviewCommunityFeedCommentReplyReportRequest {
  reportId: string;
  decision: ModerationReportAction;
  resolution: string;
}

interface ReviewCommunityFeedCommentReplyReportResponse {
  reportId: string;
  decision: ModerationReportAction;
  targetType: 'community_feed_comment_reply';
}

interface RequestProfileAgeReverificationRequest {
  reportId: string;
  resolution: string;
}

interface RequestProfileAgeReverificationResponse {
  caseId: string;
  status: 'REQUIRED';
}

interface ReviewProfileAgeReverificationRequest {
  reportId: string;
  decision: 'VERIFY' | 'REJECT';
  resolution: string;
}

interface ReviewProfileAgeReverificationResponse {
  reportId: string;
  status: 'VERIFIED' | 'REJECTED';
}

interface ReviewProfileMinorSafetyReportRequest {
  reportId: string;
  resolution: string;
}

interface ReviewProfileMinorSafetyReportResponse {
  reportId: string;
  status: 'rejected';
}

export interface AdminModerationReportVm extends IModerationReportVm {
  reviewedBy?: string | null;
  reviewedAt?: unknown;
  resolution?: string | null;
  ageReverificationCaseId?: string | null;
  ageReverificationStatus?: ModerationAgeReverificationStatus | null;
  ageReverificationSubmittedAt?: unknown;
}

@Injectable({ providedIn: 'root' })
export class AdminModerationReportService {
  private readonly firestore = inject(Firestore);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly authSession = inject(AuthSessionService);
  private readonly globalError = inject(GlobalErrorHandlerService);

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

    if (
      normalized.reportTargetType === 'profile' &&
      normalized.reportReason === 'minor_safety'
    ) {
      if (normalized.status === 'rejected') {
        return this.rejectProfileMinorSafetyReport$(
          safeReportId,
          normalized.resolution ??
            'Denúncia rejeitada por ausência de indícios suficientes.'
        );
      }

      if (normalized.status === 'resolved') {
        return throwError(
          () => new Error(
            'Use a decisão específica de revalidação para encerrar esta denúncia.'
          )
        );
      }
    }

    if (
      normalized.reportTargetType === 'photo' &&
      (normalized.status === 'resolved' || normalized.status === 'rejected')
    ) {
      const decision: ModerationReportAction = normalized.status === 'resolved'
        ? 'REMOVE'
        : 'KEEP';
      const resolution = normalized.resolution ??
        (decision === 'REMOVE'
          ? 'Foto removida após confirmação da denúncia.'
          : 'Foto mantida após revisão da denúncia.');

      return this.reviewPhotoContentReport$(
        safeReportId,
        decision,
        resolution
      );
    }

    if (
      this.isVideoContentTarget(normalized.reportTargetType) &&
      (normalized.status === 'resolved' || normalized.status === 'rejected')
    ) {
      const decision: ModerationReportAction = normalized.status === 'resolved'
        ? 'REMOVE'
        : 'KEEP';
      const resolution = normalized.resolution ??
        (decision === 'REMOVE'
          ? 'Conteúdo removido após confirmação da denúncia.'
          : 'Conteúdo mantido após revisão da denúncia.');

      return this.reviewVideoContentReport$(
        safeReportId,
        decision,
        resolution
      );
    }

    if (
      normalized.reportTargetType === 'community_feed_post'
      && (normalized.status === 'resolved' || normalized.status === 'rejected')
    ) {
      const decision: ModerationReportAction = normalized.status === 'resolved'
        ? 'REMOVE'
        : 'KEEP';
      const resolution = normalized.resolution ??
        (decision === 'REMOVE'
          ? 'Publicação removida após confirmação da denúncia.'
          : 'Publicação mantida após revisão da denúncia.');

      return this.reviewCommunityFeedPostReport$(
        safeReportId,
        decision,
        resolution
      );
    }

    if (
      normalized.reportTargetType === 'community_feed_comment'
      && (normalized.status === 'resolved' || normalized.status === 'rejected')
    ) {
      const decision: ModerationReportAction = normalized.status === 'resolved'
        ? 'REMOVE'
        : 'KEEP';
      const resolution = normalized.resolution ??
        (decision === 'REMOVE'
          ? 'Comentário removido após confirmação da denúncia.'
          : 'Comentário mantido após revisão da denúncia.');
      return this.reviewCommunityFeedCommentReport$(
        safeReportId,
        decision,
        resolution
      );
    }

    if (
      normalized.reportTargetType === 'community_feed_comment_reply'
      && (normalized.status === 'resolved' || normalized.status === 'rejected')
    ) {
      const decision: ModerationReportAction = normalized.status === 'resolved'
        ? 'REMOVE'
        : 'KEEP';
      const resolution = normalized.resolution ??
        (decision === 'REMOVE'
          ? 'Resposta removida após confirmação da denúncia.'
          : 'Resposta mantida após revisão da denúncia.');
      return this.reviewCommunityFeedCommentReplyReport$(
        safeReportId,
        decision,
        resolution
      );
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

  reviewPhotoContentReport$(
    reportId: string,
    decision: ModerationReportAction,
    resolution: string
  ): Observable<void> {
    const safeReportId = String(reportId ?? '').trim();
    const safeResolution = this.normalizeResolution(resolution);

    if (
      !safeReportId ||
      !['KEEP', 'REMOVE'].includes(decision) ||
      safeResolution.length < 8
    ) {
      return throwError(
        () => new Error('Decisão de conteúdo de foto inválida.')
      );
    }

    return from(
      this.createReviewPhotoContentReportCallable()({
        reportId: safeReportId,
        decision,
        resolution: safeResolution,
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(error, 'reviewPhotoContentReport', {
          hasReportId: !!safeReportId,
          decision,
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
    const safeResolution = this.normalizeResolution(resolution);

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
      this.createReviewVideoContentReportCallable()({
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

  reviewCommunityFeedPostReport$(
    reportId: string,
    decision: ModerationReportAction,
    resolution: string
  ): Observable<void> {
    const safeReportId = String(reportId ?? '').trim();
    const safeResolution = this.normalizeResolution(resolution);

    if (
      !safeReportId
      || !['KEEP', 'REMOVE'].includes(decision)
      || safeResolution.length < 8
    ) {
      return throwError(
        () => new Error('Decisão de publicação comunitária inválida.')
      );
    }

    return from(
      this.createReviewCommunityFeedPostReportCallable()({
        reportId: safeReportId,
        decision,
        resolution: safeResolution,
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(error, 'reviewCommunityFeedPostReport', {
          hasReportId: !!safeReportId,
          decision,
        });
        return throwError(() => error);
      })
    );
  }

  reviewCommunityFeedCommentReport$(
    reportId: string,
    decision: ModerationReportAction,
    resolution: string
  ): Observable<void> {
    const safeReportId = String(reportId ?? '').trim();
    const safeResolution = this.normalizeResolution(resolution);
    if (
      !safeReportId
      || !['KEEP', 'REMOVE'].includes(decision)
      || safeResolution.length < 8
    ) {
      return throwError(
        () => new Error('Decisão de comentário comunitário inválida.')
      );
    }
    return from(
      this.createReviewCommunityFeedCommentReportCallable()({
        reportId: safeReportId,
        decision,
        resolution: safeResolution,
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(error, 'reviewCommunityFeedCommentReport', {
          hasReportId: !!safeReportId,
          decision,
        });
        return throwError(() => error);
      })
    );
  }

  reviewCommunityFeedCommentReplyReport$(
    reportId: string,
    decision: ModerationReportAction,
    resolution: string
  ): Observable<void> {
    const safeReportId = String(reportId ?? '').trim();
    const safeResolution = this.normalizeResolution(resolution);
    if (
      !safeReportId
      || !['KEEP', 'REMOVE'].includes(decision)
      || safeResolution.length < 8
    ) {
      return throwError(
        () => new Error('Decisão de resposta comunitária inválida.')
      );
    }
    return from(
      this.createReviewCommunityFeedCommentReplyReportCallable()({
        reportId: safeReportId,
        decision,
        resolution: safeResolution,
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(error, 'reviewCommunityFeedCommentReplyReport', {
          hasReportId: !!safeReportId,
          decision,
        });
        return throwError(() => error);
      })
    );
  }

  requestProfileAgeReverification$(
    reportId: string,
    resolution: string
  ): Observable<void> {
    const safeReportId = String(reportId ?? '').trim();
    const safeResolution = this.normalizeResolution(resolution);

    if (!safeReportId || safeResolution.length < 8) {
      return throwError(
        () => new Error('Solicitação de revalidação inválida.')
      );
    }

    return from(
      this.createRequestProfileAgeReverificationCallable()({
        reportId: safeReportId,
        resolution: safeResolution,
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(error, 'requestProfileAgeReverification', {
          hasReportId: !!safeReportId,
        });
        return throwError(() => error);
      })
    );
  }

  reviewProfileAgeReverification$(
    reportId: string,
    decision: 'VERIFY' | 'REJECT',
    resolution: string
  ): Observable<void> {
    const safeReportId = String(reportId ?? '').trim();
    const safeResolution = this.normalizeResolution(resolution);

    if (
      !safeReportId ||
      !['VERIFY', 'REJECT'].includes(decision) ||
      safeResolution.length < 8
    ) {
      return throwError(
        () => new Error('Decisão de revalidação inválida.')
      );
    }

    return from(
      this.createReviewProfileAgeReverificationCallable()({
        reportId: safeReportId,
        decision,
        resolution: safeResolution,
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(error, 'reviewProfileAgeReverification', {
          hasReportId: !!safeReportId,
          decision,
        });
        return throwError(() => error);
      })
    );
  }

  rejectProfileMinorSafetyReport$(
    reportId: string,
    resolution: string
  ): Observable<void> {
    const safeReportId = String(reportId ?? '').trim();
    const safeResolution = this.normalizeResolution(resolution);

    if (!safeReportId || safeResolution.length < 8) {
      return throwError(
        () => new Error('Rejeição da denúncia inválida.')
      );
    }

    return from(
      this.createReviewProfileMinorSafetyReportCallable()({
        reportId: safeReportId,
        resolution: safeResolution,
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(error, 'rejectProfileMinorSafetyReport', {
          hasReportId: !!safeReportId,
        });
        return throwError(() => error);
      })
    );
  }

  private createReviewPhotoContentReportCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        ReviewPhotoContentReportRequest,
        ReviewPhotoContentReportResponse
      >(
        inject(Functions),
        'reviewPhotoContentReport'
      )
    );
  }

  private createReviewVideoContentReportCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        ReviewVideoContentReportRequest,
        ReviewVideoContentReportResponse
      >(
        inject(Functions),
        'reviewVideoContentReport'
      )
    );
  }

  private createReviewCommunityFeedPostReportCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        ReviewCommunityFeedPostReportRequest,
        ReviewCommunityFeedPostReportResponse
      >(
        inject(Functions),
        'reviewCommunityFeedPostReport'
      )
    );
  }

  private createReviewCommunityFeedCommentReportCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        ReviewCommunityFeedCommentReportRequest,
        ReviewCommunityFeedCommentReportResponse
      >(
        inject(Functions),
        'reviewCommunityFeedCommentReport'
      )
    );
  }

  private createReviewCommunityFeedCommentReplyReportCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        ReviewCommunityFeedCommentReplyReportRequest,
        ReviewCommunityFeedCommentReplyReportResponse
      >(
        inject(Functions),
        'reviewCommunityFeedCommentReplyReport'
      )
    );
  }

  private createRequestProfileAgeReverificationCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        RequestProfileAgeReverificationRequest,
        RequestProfileAgeReverificationResponse
      >(
        inject(Functions),
        'requestProfileAgeReverification'
      )
    );
  }

  private createReviewProfileAgeReverificationCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        ReviewProfileAgeReverificationRequest,
        ReviewProfileAgeReverificationResponse
      >(
        inject(Functions),
        'reviewProfileAgeReverification'
      )
    );
  }

  private createReviewProfileMinorSafetyReportCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        ReviewProfileMinorSafetyReportRequest,
        ReviewProfileMinorSafetyReportResponse
      >(
        inject(Functions),
        'reviewProfileMinorSafetyReport'
      )
    );
  }

  private normalizeReport(
    report: AdminModerationReportVm
  ): AdminModerationReportVm {
    const ageStatus = String(report.ageReverificationStatus ?? '')
      .trim()
      .toUpperCase();

    return {
      ...report,
      id: String(report.id ?? '').trim(),
      reporterUid: String(report.reporterUid ?? '').trim(),
      targetType: report.targetType,
      targetId: String(report.targetId ?? '').trim(),
      parentTargetId: String(report.parentTargetId ?? '').trim() || null,
      grandparentTargetId:
        String(report.grandparentTargetId ?? '').trim() || null,
      containerTargetId:
        String(report.containerTargetId ?? '').trim() || null,
      targetOwnerUid: String(report.targetOwnerUid ?? '').trim() || null,
      targetAuthorUid: String(report.targetAuthorUid ?? '').trim() || null,
      reason: report.reason,
      details: String(report.details ?? '').trim() || null,
      route: String(report.route ?? '').trim() || null,
      status: report.status,
      moderationAction: report.moderationAction ?? null,
      ageReverificationCaseId:
        String(report.ageReverificationCaseId ?? '').trim() || null,
      ageReverificationStatus: [
        'REQUIRED',
        'SUBMITTED',
        'UNDER_REVIEW',
        'VERIFIED',
        'REJECTED',
        'EXPIRED',
      ].includes(ageStatus)
        ? ageStatus as ModerationAgeReverificationStatus
        : null,
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
    const resolution = this.normalizeResolution(patch?.resolution);

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

  private normalizeResolution(value: unknown): string {
    return String(value ?? '').trim().slice(0, 900);
  }

  private isVideoContentTarget(
    value: ModerationReportTargetType | null
  ): value is 'video' | 'video_comment' | 'video_rating' {
    return value === 'video' ||
      value === 'video_comment' ||
      value === 'video_rating';
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

      const reportable = normalizedError as Error & {
        feature?: unknown;
        operation?: unknown;
        context?: unknown;
        original?: unknown;
      };
      reportable.feature = 'admin_moderation_reports';
      reportable.operation = operation;
      reportable.context = context;
      reportable.original = error;
      this.globalError.handleError(reportable);
    } catch {
      // noop
    }
  }
}
