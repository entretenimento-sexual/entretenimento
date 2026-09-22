// src/app/core/services/autentication/account-moderation/user-moderation.service.ts
// =============================================================================
// USER MODERATION SERVICE (staff-only)
//
// Objetivo:
// - Centralizar ações administrativas: lock/unlock/suspend/unsuspend
// - FirestoreService legado foi descontinuado -> usa FirestoreWriteService
// - Observable-first: sem subscribe dentro do service
// - Logs/auditoria e notificações são best-effort (não quebram a ação principal)
// - Erros de aplicação passam pela fronteira canônica ApplicationErrorService
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
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

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
    private readonly applicationError: ApplicationErrorService
  ) { }

  // ---------------------------------------------------------------------------
  // Conta bloqueada (lock)
  // ---------------------------------------------------------------------------

  // Mantém nomenclatura original
  lockAccount(uid: string): Observable<void> {
    const now = Date.now();
    const actorUid = this.resolveActorUid();

    if (!actorUid) {
      this.reportApplicationError(
        this.domainError(
          'Ação indisponível: admin não autenticado.',
          'auth/not-authenticated'
        ),
        'resolveActorUid',
        'Ação indisponível: admin não autenticado.',
        { uid }
      );
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
        this.reportApplicationError(
          err,
          'lockAccount',
          'Não foi possível bloquear a conta.',
          { uid }
        );
        return of(void 0);
      })
    );
  }

  // Mantém nomenclatura original
  unlockAccount(uid: string): Observable<void> {
    const now = Date.now();
    const actorUid = this.resolveActorUid();

    if (!actorUid) {
      this.reportApplicationError(
        this.domainError(
          'Ação indisponível: admin não autenticado.',
          'auth/not-authenticated'
        ),
        'resolveActorUid',
        'Ação indisponível: admin não autenticado.',
        { uid }
      );
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
        this.reportApplicationError(
          err,
          'unlockAccount',
          'Não foi possível desbloquear a conta.',
          { uid }
        );
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
      this.reportApplicationError(
        this.domainError(
          'Ação indisponível: admin não autenticado.',
          'auth/not-authenticated'
        ),
        'resolveActorUid',
        'Ação indisponível: admin não autenticado.',
        { uid }
      );
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
            this.reportApplicationError(
              err,
              'sendAccountActionNotification',
              'Não foi possível enviar a notificação da suspensão.',
              { uid, action: 'suspensa' },
              true
            );
            return of(void 0);
          })
        )
      ),
      map(() => void 0),
      take(1),
      catchError((err) => {
        this.reportApplicationError(
          err,
          'suspendUser',
          'Não foi possível suspender o usuário.',
          { uid }
        );
        return of(void 0);
      })
    );
  }

  // Reativar usuário
  unsuspendUser(uid: string, adminUid: string): Observable<void> {
    const now = Date.now();
    const actorUid = this.resolveActorUid(adminUid);

    if (!actorUid) {
      this.reportApplicationError(
        this.domainError(
          'Ação indisponível: admin não autenticado.',
          'auth/not-authenticated'
        ),
        'resolveActorUid',
        'Ação indisponível: admin não autenticado.',
        { uid }
      );
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
            this.reportApplicationError(
              err,
              'sendAccountActionNotification',
              'Não foi possível enviar a notificação da reativação.',
              { uid, action: 'reativada' },
              true
            );
            return of(void 0);
          })
        )
      ),
      map(() => void 0),
      take(1),
      catchError((err) => {
        this.reportApplicationError(
          err,
          'unsuspendUser',
          'Não foi possível reativar o usuário.',
          { uid }
        );
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
      catchError(() => {
        // AdminLogService já centraliza o diagnóstico; aqui apenas preservamos
        // a semântica best-effort para não bloquear a moderação.
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

  private reportApplicationError(
    error: unknown,
    operation: string,
    fallbackMessage: string,
    metadata: Record<string, unknown> = {},
    silent = false
  ): void {
    this.applicationError.report(error, {
      feature: 'account-moderation',
      operation,
      fallbackMessage,
      presentation: silent
        ? { surface: 'none', severity: 'error' }
        : undefined,
      metadata: {
        scope: 'UserModerationService',
        ...metadata,
      },
    });
  }

  private domainError(message: string, code: string): Error & { code?: string } {
    const error = new Error(message) as Error & { code?: string };
    error.code = code;
    return error;
  }
}
