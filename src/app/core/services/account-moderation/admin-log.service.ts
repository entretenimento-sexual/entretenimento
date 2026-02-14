// src/app/core/services/autentication/account-moderation/admin-log.service.ts
// =============================================================================
// ADMIN LOG SERVICE (auditoria / ações administrativas)
//
// Objetivo:
// - Registrar ações de staff (ban/suspend/lock/unlock/etc) em /admin_logs
// - FirestoreService legado está sendo descontinuado -> usa FirestoreWriteService
// - Observable-first (sem subscribe interno)
// - timestamps: preferir serverTimestamp() (auditoria confiável)
// - erros: sempre reportados ao GlobalErrorHandlerService
//
// Nota de arquitetura “plataforma grande”:
// - Segurança real vem das RULES + custom claims (admin/moderator).
// - O campo adminUid passado por parâmetro NÃO é confiável por si só.
//   Usamos o UID canônico do Auth (quando disponível) e só mantemos o parâmetro por compat.
// =============================================================================

import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, take } from 'rxjs/operators';

import { serverTimestamp } from 'firebase/firestore';

import { IAdminLog } from '../../interfaces/logs/iadming-log';
import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { environment } from 'src/environments/environment';

type DomainError = Error & { code?: string };

@Injectable({ providedIn: 'root' })
export class AdminLogService {
  private readonly debug = !!environment.enableDebugTools;

  constructor(
    private readonly auth: Auth,
    private readonly write: FirestoreWriteService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) { }

  /**
   * Registra uma ação administrativa no sistema de logs.
   *
   * @param adminUid         (compat) uid informado pelo caller (não confiável isoladamente)
   * @param action           ação (ex.: suspendUser, unsuspendUser, lockAccount…)
   * @param targetUserUid    uid alvo
   * @param details          payload opcional (motivo, metadata)
   * @param opts.silent      evita toast (útil quando log é best-effort)
   */
  logAdminAction(
    adminUid: string,
    action: string,
    targetUserUid: string,
    details?: any,
    opts?: { silent?: boolean }
  ): Observable<IAdminLog> {
    const silent = opts?.silent ?? true;

    const actorUid = this.resolveActorUid(adminUid);
    if (!actorUid) {
      return throwError(() => this.domainError('Admin não autenticado.', 'auth/not-authenticated'));
    }

    const a = (action ?? '').trim();
    const t = (targetUserUid ?? '').trim();

    if (!a) return throwError(() => this.domainError('Ação inválida.', 'adminlog/invalid-action'));
    if (!t) return throwError(() => this.domainError('Target UID inválido.', 'adminlog/invalid-target'));

    // ✅ timestamp confiável (serverTimestamp) -> rules podem exigir request.time
    const logEntry: IAdminLog = {
      adminUid: actorUid,
      action: a,
      targetUserUid: t,
      details: details ?? null,
      timestamp: serverTimestamp() as any,
    };

    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log('[AdminLogService] logAdminAction', { action: a, targetUserUid: t });
    }

    return this.write.addDocument('admin_logs', logEntry as any, {
      context: 'AdminLogService.logAdminAction',
      silent: true, // write layer não deve notificar UI diretamente
    }).pipe(
      map(() => logEntry),
      take(1),
      catchError((err) => {
        // Centraliza erro (sempre)
        this.report(err, { phase: 'logAdminAction', action: a, targetUserUid: t }, silent);

        // UI: somente quando fizer sentido (ex.: painel admin)
        if (!silent) {
          this.errorNotifier.showError('Falha ao registrar ação administrativa.');
        }

        return throwError(() => err);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private resolveActorUid(passedAdminUid?: string): string | null {
    const current = this.auth.currentUser?.uid ?? null;

    // Se houver mismatch, usa o canônico do Auth e só loga warning em debug.
    if (this.debug && passedAdminUid && current && passedAdminUid !== current) {
      // eslint-disable-next-line no-console
      console.warn('[AdminLogService] adminUid param != auth uid. Usando auth uid.', {
        passedAdminUid,
        current,
      });
    }

    return current ?? passedAdminUid ?? null;
  }

  private domainError(message: string, code: string): DomainError {
    const e: DomainError = new Error(message);
    e.code = code;
    return e;
  }

  private report(err: any, context: any, silent: boolean): void {
    try {
      const e = new Error('[AdminLogService] error');
      (e as any).silent = silent;
      (e as any).original = err;
      (e as any).context = context;
      this.globalErrorHandler.handleError(e);
    } catch { }
  }
}
