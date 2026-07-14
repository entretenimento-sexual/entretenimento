// src/app/core/services/moderation/moderation-report.service.ts
// -----------------------------------------------------------------------------
// MODERATION REPORT SERVICE
// -----------------------------------------------------------------------------
// Serviço central para criar denúncias de moderação.
//
// Decisões:
// - usa AuthSessionService.readyUid$ para aguardar Auth pronto;
// - denúncias comuns preservam o fluxo existente em moderation_reports;
// - denúncias de vídeo, comentário e avaliação passam por Callable validada;
// - não expõe leitura/listagem para usuário comum;
// - não mostra toast diretamente para manter feedback sob controle da UI;
// - reporta falhas ao GlobalErrorHandlerService.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
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

@Injectable({ providedIn: 'root' })
export class ModerationReportService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly authSession = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly reportVideoContentCallable = httpsCallable<
    ReportVideoContentRequest,
    ReportVideoContentResponse
  >(this.functions, 'reportVideoContent');

  createReport$(input: IModerationReportCreateInput): Observable<string> {
    const normalized = this.normalizeInput(input);

    if (!normalized) {
      return throwError(() => new Error('Denúncia inválida.'));
    }

    const videoTargetType = this.normalizeVideoTargetType(
      normalized.targetType
    );

    if (videoTargetType) {
      return this.createVideoReport$(normalized, videoTargetType);
    }

    return this.createLegacyReport$(normalized);
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

    return from(
      this.reportVideoContentCallable({
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
          targetOwnerUid: input.targetOwnerUid || null,
          targetAuthorUid: input.targetAuthorUid || null,
          reason: input.reason,
          details: input.details || null,
          route: input.route || null,
          status: 'open',
          moderationAction: null,
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

      (normalizedError as any).feature = 'moderation_reports';
      (normalizedError as any).operation = operation;
      (normalizedError as any).context = context;
      (normalizedError as any).original = error;

      this.globalError.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
