// src/app/core/services/autentication/account-moderation/user-moderation.service.ts
// =============================================================================
// USER MODERATION SERVICE (staff-only)
//
// Objetivo:
// - Centralizar ações administrativas: lock/unlock/suspend/unsuspend
// - FirestoreService legado foi descontinuado -> usa FirestoreWriteService
// - Observable-first: sem subscribe dentro do service
// - Logs/auditoria e notificações são best-effort (não quebram a ação principal)
// - Erros sempre passam pelo GlobalErrorHandlerService + feedback via ErrorNotificationService
//
// Observação importante:
// - providedIn:'root' => NÃO precisa registrar em app.module.ts providers.
// - Segurança real depende das rules: self NÃO pode alterar campos de moderação.
// =============================================================================

import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { AdminLogService } from './admin-log.service';
import { environment } from 'src/environments/environment';

type ModerationAction =
  | 'lockAccount'
  | 'unlockAccount'
  | 'suspendUser'
  | 'unsuspendUser';

@Injectable({ providedIn: 'root' })
export class UserModerationService {
  private readonly debug = !!environment.enableDebugTools;

  constructor(
    private readonly write: FirestoreWriteService,
    private readonly auth: Auth,
    private readonly adminLogService: AdminLogService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) { }

  // ---------------------------------------------------------------------------
  // Conta bloqueada (lock)
  // ---------------------------------------------------------------------------

  // Mantém nomenclatura original
  lockAccount(uid: string): Observable<void> {
    const now = Date.now();
    const actorUid = this.resolveActorUid();

    if (!actorUid) {
      this.errorNotifier.showError('Ação indisponível: admin não autenticado.');
      return of(void 0);
    }

    const patch = {
      accountLocked: true,
      lockedAtMs: now,
      lockedBy: actorUid,
      updatedAtMs: now,
    };

    return this.write.updateDocument('users', uid, patch, {
      context: 'UserModerationService.lockAccount',
    }).pipe(
      switchMap(() =>
        this.bestEffortAfterAction$(actorUid, 'lockAccount', uid, { atMs: now })
      ),
      map(() => void 0),
      take(1),
      catchError((err) => {
        this.report(err, { phase: 'lockAccount', uid });
        this.errorNotifier.showError('Não foi possível bloquear a conta.');
        return of(void 0);
      })
    );
  }

  // Mantém nomenclatura original
  unlockAccount(uid: string): Observable<void> {
    const now = Date.now();
    const actorUid = this.resolveActorUid();

    if (!actorUid) {
      this.errorNotifier.showError('Ação indisponível: admin não autenticado.');
      return of(void 0);
    }

    const patch = {
      accountLocked: false,
      unlockedAtMs: now,
      unlockedBy: actorUid,
      updatedAtMs: now,
    };

    return this.write.updateDocument('users', uid, patch, {
      context: 'UserModerationService.unlockAccount',
    }).pipe(
      switchMap(() =>
        this.bestEffortAfterAction$(actorUid, 'unlockAccount', uid, { atMs: now })
      ),
      map(() => void 0),
      take(1),
      catchError((err) => {
        this.report(err, { phase: 'unlockAccount', uid });
        this.errorNotifier.showError('Não foi possível desbloquear a conta.');
        return of(void 0);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Suspensão (suspend)
  // ---------------------------------------------------------------------------

  /**
   * Mantém a assinatura original (uid, reason, adminUid),
   * mas o adminUid passa a ser derivado do Auth por segurança.
   * - Se você ainda estiver passando adminUid nos call-sites, ele é ignorado.
   */
  suspendUser(uid: string, reason: string, adminUid: string): Observable<void> {
    const now = Date.now();
    const actorUid = this.resolveActorUid(adminUid);

    if (!actorUid) {
      this.errorNotifier.showError('Ação indisponível: admin não autenticado.');
      return of(void 0);
    }

    const cleanReason = (reason ?? '').trim();

    const patch = {
      suspended: true,
      suspensionReason: cleanReason || null,

      // padrão do seu app (epoch ms)
      suspendedAtMs: now,

      // auditoria mínima
      suspendedBy: actorUid,
      updatedAtMs: now,
    };

    return this.write.updateDocument('users', uid, patch, {
      context: 'UserModerationService.suspendUser',
    }).pipe(
      switchMap(() =>
        this.bestEffortAfterAction$(actorUid, 'suspendUser', uid, { reason: cleanReason, atMs: now })
      ),
      switchMap(() =>
        this.sendAccountActionNotification(uid, 'suspensa', cleanReason).pipe(
          catchError((err) => {
            // notificação é best-effort
            this.report(err, { phase: 'sendAccountActionNotification', uid, action: 'suspensa' }, true);
            return of(void 0);
          })
        )
      ),
      map(() => void 0),
      take(1),
      catchError((err) => {
        this.report(err, { phase: 'suspendUser', uid });
        this.errorNotifier.showError('Não foi possível suspender o usuário.');
        return of(void 0);
      })
    );
  }

  // Reativar usuário
  unsuspendUser(uid: string, adminUid: string): Observable<void> {
    const now = Date.now();
    const actorUid = this.resolveActorUid(adminUid);

    if (!actorUid) {
      this.errorNotifier.showError('Ação indisponível: admin não autenticado.');
      return of(void 0);
    }

    const patch = {
      suspended: false,
      suspensionReason: null,
      suspendedAtMs: null,

      unsuspendedAtMs: now,
      unsuspendedBy: actorUid,
      updatedAtMs: now,
    };

    return this.write.updateDocument('users', uid, patch, {
      context: 'UserModerationService.unsuspendUser',
    }).pipe(
      switchMap(() =>
        this.bestEffortAfterAction$(actorUid, 'unsuspendUser', uid, { atMs: now })
      ),
      switchMap(() =>
        this.sendAccountActionNotification(uid, 'reativada').pipe(
          catchError((err) => {
            this.report(err, { phase: 'sendAccountActionNotification', uid, action: 'reativada' }, true);
            return of(void 0);
          })
        )
      ),
      map(() => void 0),
      take(1),
      catchError((err) => {
        this.report(err, { phase: 'unsuspendUser', uid });
        this.errorNotifier.showError('Não foi possível reativar o usuário.');
        return of(void 0);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Notificação (placeholder)
  // ---------------------------------------------------------------------------

  /**
   * Placeholder (mantido).
   * Em plataforma grande: isso vira um pipeline real (in-app notifications / email / push).
   */
  sendAccountActionNotification(uid: string, action: string, reason?: string): Observable<void> {
    const notificationMessage = `Sua conta foi ${action}.${reason ? ' Motivo: ' + reason : ''}`;

    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log('[UserModerationService][Notificação]', { uid, message: notificationMessage });
    }

    return of(void 0);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Pós-ação: auditoria best-effort (não quebra a operação principal).
   * - Ideal: AdminLogService escrever em /admin_logs com serverTimestamp() via rules.
   */
  private bestEffortAfterAction$(
    actorUid: string,
    action: ModerationAction,
    targetUid: string,
    details?: any
  ): Observable<void> {
    return this.adminLogService.logAdminAction(actorUid, action, targetUid, details)
             //.logAdminAction(actorUid, action, targetUid, details, { silent: true })
    .pipe(
      take(1),
      catchError((err) => {
        // auditoria não pode impedir a moderação (best-effort)
        this.report(err, { phase: 'adminLogService.logAdminAction', action, targetUid }, true);
        return of(void 0);
      }),
      map(() => void 0)
    );
  }

  /**
   * Resolve o UID do ator (admin).
   * - Preferência: Auth.currentUser.uid (canônico)
   * - Compat: aceita adminUid passado, mas só usa se Auth não existir.
   */
  private resolveActorUid(passedAdminUid?: string): string | null {
    const current = this.auth.currentUser?.uid ?? null;

    if (this.debug && passedAdminUid && current && passedAdminUid !== current) {
      // eslint-disable-next-line no-console
      console.warn('[UserModerationService] adminUid param != auth uid. Ignorando param.', {
        passedAdminUid,
        current,
      });
    }

    return current ?? passedAdminUid ?? null;
  }

  /**
   * Report central (alinhado ao seu padrão de services)
   * - silent: evita poluir UX quando for erro esperado/best-effort
   */
  private report(err: any, context: any, silent = false): void {
    try {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.log('[UserModerationService]', context, err);
      }
      const e = new Error('[UserModerationService] error');
      (e as any).silent = silent;
      (e as any).original = err;
      (e as any).context = context;
      this.globalErrorHandler.handleError(e);
    } catch { }
  }
}
