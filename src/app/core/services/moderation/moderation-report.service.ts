// src/app/core/services/moderation/moderation-report.service.ts
// -----------------------------------------------------------------------------
// MODERATION REPORT SERVICE
// -----------------------------------------------------------------------------
// Serviço central para criar denúncias de moderação.
//
// Decisões:
// - usa AuthSessionService.readyUid$ para aguardar Auth pronto;
// - denúncias comuns preservam o fluxo existente em moderation_reports;
// - denúncias de foto passam por Callable validada;
// - denúncias de vídeo, comentário, resposta e avaliação passam por Callable validada;
// - denúncia de perfil por possível menoridade passa por Callable específica;
// - Functions é resolvido somente quando uma Callable é necessária;
// - não expõe leitura/listagem para usuário comum;
// - não mostra toast diretamente para manter feedback sob controle da UI;
// - reporta falhas ao GlobalErrorHandlerService.
// -----------------------------------------------------------------------------

import {
  EnvironmentInjector,
  Injectable,
  inject,
  runInInjectionContext,
} from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  IModerationReportCreateInput,
  IModerationReportDocument,
  ModerationReportReason,
  ModerationReportTargetType,
} from 'src/app/core/interfaces/moderation/moderation-report.interface';
import { toErrorInstance } from 'src/app/core/utils/firebase-error-utils';

type VideoReportTargetType = 'video' | 'video_comment' | 'video_rating';

interface ReportPhotoContentRequest {
  ownerUid: string;
  photoId: string;
  reason: ModerationReportReason;
  details?: string | null;
  route?: string | null;
}

interface ReportPhotoContentResponse {
  reportId: string;
}

interface ReportVideoContentRequest {
  targetType: VideoReportTargetType;
  ownerUid: string;
  videoId: string;
  targetId?: string | null;
  reason: ModerationReportReason;
  details?: string | null;
  route?: string | null;
}

interface ReportVideoContentResponse {
  reportId: string;
}

interface ReportProfileMinorSafetyRequest {
  targetUid: string;
  details?: string | null;
  route?: string | null;
}

interface ReportProfileMinorSafetyResponse {
  reportId: string;
}

interface ReportCommunityFeedPostRequest {
  communityId: string;
  postId: string;
  reason: ModerationReportReason;
  details?: string | null;
  route?: string | null;
}

interface ReportCommunityFeedPostResponse {
  reportId: string;
}

interface ReportCommunityFeedCommentRequest {
  communityId: string;
  postId: string;
  commentId: string;
  reason: ModerationReportReason;
  details?: string | null;
  route?: string | null;
}

interface ReportCommunityFeedCommentResponse {
  reportId: string;
}

interface ReportCommunityFeedCommentReplyRequest
extends ReportCommunityFeedCommentRequest {
  replyId: string;
}

interface ReportCommunityFeedCommentReplyResponse {
  reportId: string;
}

@Injectable({ providedIn: 'root' })
export class ModerationReportService {
  private readonly firestore = inject(Firestore);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly authSession = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  createReport$(input: IModerationReportCreateInput): Observable<string> {
    const normalized = this.normalizeInput(input);

    if (!normalized) {
      return throwError(() => new Error('Denúncia inválida.'));
    }

    if (normalized.targetType === 'photo') {
      return this.createPhotoReport$(normalized);
    }

    const videoTargetType = this.normalizeVideoTargetType(
      normalized.targetType
    );

    if (videoTargetType) {
      return this.createVideoReport$(normalized, videoTargetType);
    }

    if (this.isMinorProfileReport(normalized)) {
      return this.createProfileMinorSafetyReport$(normalized);
    }

    if (normalized.targetType === 'community_feed_post') {
      return this.createCommunityFeedPostReport$(normalized);
    }

    if (normalized.targetType === 'community_feed_comment') {
      return this.createCommunityFeedCommentReport$(normalized);
    }

    if (normalized.targetType === 'community_feed_comment_reply') {
      return this.createCommunityFeedCommentReplyReport$(normalized);
    }

    return this.createLegacyReport$(normalized);
  }

  private createPhotoReport$(
    input: IModerationReportCreateInput
  ): Observable<string> {
    const ownerUid = String(input.targetOwnerUid ?? '').trim();
    const photoId = String(input.targetId ?? '').trim();

    if (!ownerUid || !photoId) {
      return throwError(() => new Error('Referência da foto inválida.'));
    }

    const callable = this.createReportPhotoContentCallable();

    return from(
      callable({
        ownerUid,
        photoId,
        reason: input.reason,
        details: input.details,
        route: input.route,
      })
    ).pipe(
      map((response) => response.data.reportId),
      catchError((error) => {
        this.reportWriteError(error, 'createPhotoReport', {
          targetType: input.targetType,
          targetId: photoId,
          hasOwnerUid: !!ownerUid,
          reason: input.reason,
        });
        return throwError(() => error);
      })
    );
  }

  private createVideoReport$(
    input: IModerationReportCreateInput,
    targetType: VideoReportTargetType
  ): Observable<string> {
    const ownerUid = String(input.targetOwnerUid ?? '').trim();
    const videoId = String(
      input.parentTargetId ??
      (targetType === 'video' ? input.targetId : '')
    ).trim();

    if (!ownerUid || !videoId) {
      return throwError(() => new Error('Referência do vídeo inválida.'));
    }

    const reportVideoContentCallable = this.createReportVideoContentCallable();

    return from(
      reportVideoContentCallable({
        targetType,
        ownerUid,
        videoId,
        targetId: targetType === 'video' ? null : input.targetId,
        reason: input.reason,
        details: input.details,
        route: input.route,
      })
    ).pipe(
      map((response) => response.data.reportId),
      catchError((error) => {
        this.reportWriteError(error, 'createVideoReport', {
          targetType,
          targetId: input.targetId,
          videoId,
          hasOwnerUid: !!ownerUid,
          reason: input.reason,
        });
        return throwError(() => error);
      })
    );
  }

  private createProfileMinorSafetyReport$(
    input: IModerationReportCreateInput
  ): Observable<string> {
    const targetUid = String(
      input.targetOwnerUid || input.targetId || ''
    ).trim();

    if (!targetUid) {
      return throwError(() => new Error('Perfil denunciado inválido.'));
    }

    const callable = this.createReportProfileMinorSafetyCallable();

    return from(callable({
      targetUid,
      details: input.details,
      route: input.route,
    })).pipe(
      map((response) => response.data.reportId),
      catchError((error) => {
        this.reportWriteError(error, 'createProfileMinorSafetyReport', {
          targetUid,
          targetType: input.targetType,
          reason: input.reason,
        });
        return throwError(() => error);
      })
    );
  }

  private createCommunityFeedPostReport$(
    input: IModerationReportCreateInput
  ): Observable<string> {
    const communityId = String(input.parentTargetId ?? '').trim();
    const postId = String(input.targetId ?? '').trim();
    if (!communityId || !postId) {
      return throwError(() => new Error('Referência da publicação inválida.'));
    }

    const callable = this.createReportCommunityFeedPostCallable();
    return from(callable({
      communityId,
      postId,
      reason: input.reason,
      details: input.details,
      route: input.route,
    })).pipe(
      map((response) => response.data.reportId),
      catchError((error) => {
        this.reportWriteError(error, 'createCommunityFeedPostReport', {
          communityId,
          postId,
          reason: input.reason,
        });
        return throwError(() => error);
      })
    );
  }

  private createCommunityFeedCommentReport$(
    input: IModerationReportCreateInput
  ): Observable<string> {
    const communityId = String(input.containerTargetId ?? '').trim();
    const postId = String(input.parentTargetId ?? '').trim();
    const commentId = String(input.targetId ?? '').trim();
    if (!communityId || !postId || !commentId) {
      return throwError(() => new Error('Referência do comentário inválida.'));
    }

    const callable = this.createReportCommunityFeedCommentCallable();
    return from(callable({
      communityId,
      postId,
      commentId,
      reason: input.reason,
      details: input.details,
      route: input.route,
    })).pipe(
      map((response) => response.data.reportId),
      catchError((error) => {
        this.reportWriteError(error, 'createCommunityFeedCommentReport', {
          communityId,
          postId,
          commentId,
          reason: input.reason,
        });
        return throwError(() => error);
      })
    );
  }

  private createCommunityFeedCommentReplyReport$(
    input: IModerationReportCreateInput
  ): Observable<string> {
    const communityId = String(input.containerTargetId ?? '').trim();
    const postId = String(input.grandparentTargetId ?? '').trim();
    const commentId = String(input.parentTargetId ?? '').trim();
    const replyId = String(input.targetId ?? '').trim();
    if (!communityId || !postId || !commentId || !replyId) {
      return throwError(() => new Error('Referência da resposta inválida.'));
    }

    const callable = this.createReportCommunityFeedCommentReplyCallable();
    return from(callable({
      communityId,
      postId,
      commentId,
      replyId,
      reason: input.reason,
      details: input.details,
      route: input.route,
    })).pipe(
      map((response) => response.data.reportId),
      catchError((error) => {
        this.reportWriteError(error, 'createCommunityFeedCommentReplyReport', {
          communityId,
          postId,
          commentId,
          replyId,
          reason: input.reason,
        });
        return throwError(() => error);
      })
    );
  }

  private createReportPhotoContentCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<ReportPhotoContentRequest, ReportPhotoContentResponse>(
        inject(Functions),
        'reportPhotoContent'
      )
    );
  }

  private createReportVideoContentCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<ReportVideoContentRequest, ReportVideoContentResponse>(
        inject(Functions),
        'reportVideoContent'
      )
    );
  }

  private createReportProfileMinorSafetyCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        ReportProfileMinorSafetyRequest,
        ReportProfileMinorSafetyResponse
      >(
        inject(Functions),
        'reportProfileMinorSafety'
      )
    );
  }

  private createReportCommunityFeedPostCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        ReportCommunityFeedPostRequest,
        ReportCommunityFeedPostResponse
      >(
        inject(Functions),
        'reportCommunityFeedPost'
      )
    );
  }

  private createReportCommunityFeedCommentCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        ReportCommunityFeedCommentRequest,
        ReportCommunityFeedCommentResponse
      >(
        inject(Functions),
        'reportCommunityFeedComment'
      )
    );
  }

  private createReportCommunityFeedCommentReplyCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        ReportCommunityFeedCommentReplyRequest,
        ReportCommunityFeedCommentReplyResponse
      >(
        inject(Functions),
        'reportCommunityFeedCommentReply'
      )
    );
  }

  private createLegacyReport$(
    input: IModerationReportCreateInput
  ): Observable<string> {
    return this.authSession.readyUid$.pipe(
      take(1),
      switchMap((uid) => {
        const reporterUid = String(uid ?? '').trim();

        if (!reporterUid) {
          return throwError(
            () => new Error('Entre novamente para enviar a denúncia.')
          );
        }

        const now = serverTimestamp();
        const payload: IModerationReportDocument = {
          reporterUid,
          targetType: input.targetType,
          targetId: input.targetId,
          parentTargetId: input.parentTargetId || null,
          grandparentTargetId: input.grandparentTargetId || null,
          containerTargetId: input.containerTargetId || null,
          targetOwnerUid: input.targetOwnerUid || null,
          targetAuthorUid: input.targetAuthorUid || null,
          reason: input.reason,
          details: input.details || null,
          route: input.route || null,
          status: 'open',
          moderationAction: null,
          ageReverificationCaseId: null,
          ageReverificationStatus: null,
          ageReverificationSubmittedAt: null,
          source: 'web',
          createdAt: now,
          updatedAt: now,
        };

        return this.firestoreContext.deferPromise$(() => {
          const reportsRef = collection(this.firestore, 'moderation_reports');

          return addDoc(
            reportsRef,
            payload as unknown as Record<string, unknown>
          );
        }).pipe(
          map((docRef) => docRef.id),
          catchError((error) => {
            this.reportWriteError(error, 'createReport', {
              reporterUid,
              targetType: input.targetType,
              targetId: input.targetId,
              reason: input.reason,
            });

            return throwError(() => error);
          })
        );
      })
    );
  }

  private normalizeInput(
    input: IModerationReportCreateInput
  ): IModerationReportCreateInput | null {
    const targetType = String(
      input?.targetType ?? ''
    ).trim() as ModerationReportTargetType;
    const targetId = String(input?.targetId ?? '').trim();
    const parentTargetId = String(input?.parentTargetId ?? '').trim();
    const grandparentTargetId = String(input?.grandparentTargetId ?? '').trim();
    const containerTargetId = String(input?.containerTargetId ?? '').trim();
    const targetOwnerUid = String(input?.targetOwnerUid ?? '').trim();
    const targetAuthorUid = String(input?.targetAuthorUid ?? '').trim();
    const reason = String(
      input?.reason ?? ''
    ).trim() as ModerationReportReason;
    const details = String(input?.details ?? '').trim().slice(0, 1200);
    const route = String(input?.route ?? '').trim().slice(0, 300);

    if (
      !this.isAllowedTargetType(targetType) ||
      !targetId ||
      !this.isAllowedReason(reason)
    ) {
      return null;
    }

    return {
      targetType,
      targetId: targetId.slice(0, 180),
      parentTargetId: parentTargetId ? parentTargetId.slice(0, 180) : null,
      grandparentTargetId:
        grandparentTargetId ? grandparentTargetId.slice(0, 180) : null,
      containerTargetId:
        containerTargetId ? containerTargetId.slice(0, 180) : null,
      targetOwnerUid: targetOwnerUid ? targetOwnerUid.slice(0, 180) : null,
      targetAuthorUid: targetAuthorUid ? targetAuthorUid.slice(0, 180) : null,
      reason,
      details: details || null,
      route: route || null,
    };
  }

  private normalizeVideoTargetType(
    value: ModerationReportTargetType
  ): VideoReportTargetType | null {
    return value === 'video' ||
      value === 'video_comment' ||
      value === 'video_rating'
      ? value
      : null;
  }

  private isMinorProfileReport(
    input: IModerationReportCreateInput
  ): boolean {
    return input.targetType === 'profile' && input.reason === 'minor_safety';
  }

  private isAllowedTargetType(
    value: string
  ): value is ModerationReportTargetType {
    return [
      'profile',
      'photo',
      'video',
      'video_comment',
      'video_rating',
      'message',
      'room',
      'status',
      'venue',
      'community_feed_post',
      'community_feed_comment',
      'community_feed_comment_reply',
      'other',
    ].includes(value);
  }

  private isAllowedReason(value: string): value is ModerationReportReason {
    return [
      'spam',
      'fake_profile',
      'harassment',
      'hate_or_abuse',
      'sexual_boundary',
      'illegal_content',
      'privacy',
      'minor_safety',
      'other',
    ].includes(value);
  }

  private reportWriteError(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): void {
    try {
      const normalizedError = toErrorInstance(
        error,
        `[ModerationReportService.${operation}] escrita falhou.`
      );

      const reportable = normalizedError as Error & {
        feature?: unknown;
        operation?: unknown;
        context?: unknown;
        original?: unknown;
      };
      reportable.feature = 'moderation_reports';
      reportable.operation = operation;
      reportable.context = context;
      reportable.original = error;

      this.globalError.handleError(reportable);
    } catch {
      // noop
    }
  }
}
