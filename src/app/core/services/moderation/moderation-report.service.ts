// src/app/core/services/moderation/moderation-report.service.ts
// -----------------------------------------------------------------------------
// MODERATION REPORT SERVICE
// -----------------------------------------------------------------------------
// Serviço central para criar denúncias de moderação.
//
// Decisões:
// - usa AuthSessionService.readyUid$ para aguardar Auth pronto;
// - cria documento em moderation_reports;
// - não expõe leitura/listagem para usuário comum;
// - não mostra toast diretamente para manter feedback sob controle da UI;
// - reporta falhas de escrita ao GlobalErrorHandlerService.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Firestore, addDoc, collection, serverTimestamp } from '@angular/fire/firestore';
import { Observable, throwError } from 'rxjs';
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

@Injectable({ providedIn: 'root' })
export class ModerationReportService {
  private readonly firestore = inject(Firestore);
  private readonly authSession = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  createReport$(input: IModerationReportCreateInput): Observable<string> {
    const normalized = this.normalizeInput(input);

    if (!normalized) {
      return throwError(() => new Error('Denúncia inválida.'));
    }

    return this.authSession.readyUid$.pipe(
      take(1),
      switchMap((uid) => {
        const reporterUid = String(uid ?? '').trim();

        if (!reporterUid) {
          return throwError(() => new Error('Entre novamente para enviar a denúncia.'));
        }

        const now = serverTimestamp();
        const payload: IModerationReportDocument = {
          reporterUid,
          targetType: normalized.targetType,
          targetId: normalized.targetId,
          targetOwnerUid: normalized.targetOwnerUid || null,
          reason: normalized.reason,
          details: normalized.details || null,
          route: normalized.route || null,
          status: 'open',
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
              targetType: normalized.targetType,
              targetId: normalized.targetId,
              reason: normalized.reason,
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
    const targetType = String(input?.targetType ?? '').trim() as ModerationReportTargetType;
    const targetId = String(input?.targetId ?? '').trim();
    const targetOwnerUid = String(input?.targetOwnerUid ?? '').trim();
    const reason = String(input?.reason ?? '').trim() as ModerationReportReason;
    const details = String(input?.details ?? '').trim().slice(0, 1200);
    const route = String(input?.route ?? '').trim().slice(0, 300);

    if (!this.isAllowedTargetType(targetType) || !targetId || !this.isAllowedReason(reason)) {
      return null;
    }

    return {
      targetType,
      targetId: targetId.slice(0, 180),
      targetOwnerUid: targetOwnerUid ? targetOwnerUid.slice(0, 180) : null,
      reason,
      details: details || null,
      route: route || null,
    };
  }

  private isAllowedTargetType(value: string): value is ModerationReportTargetType {
    return [
      'profile',
      'photo',
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
