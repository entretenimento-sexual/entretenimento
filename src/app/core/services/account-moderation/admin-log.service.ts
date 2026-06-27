// src/app/core/services/autentication/account-moderation/admin-log.service.ts
// =============================================================================
// ADMIN LOG SERVICE (auditoria / ações administrativas)
// =============================================================================
import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Observable, throwError } from 'rxjs';
import { catchError, map, take } from 'rxjs/operators';

import { limit, orderBy, serverTimestamp } from 'firebase/firestore';

import { IAdminLog } from '../../interfaces/logs/iadming-log';
import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';
import { FirestoreReadService } from '@core/services/data-handling/firestore/core/firestore-read.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { environment } from 'src/environments/environment';

type DomainError = Error & { code?: string };

export interface IAdminLogRecord extends IAdminLog {
  id?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminLogService {
  private readonly debug = !!environment.enableDebugTools;

  constructor(
    private readonly auth: Auth,
    private readonly write: FirestoreWriteService,
    private readonly read: FirestoreReadService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) { }

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
      silent: true,
    }).pipe(
      map(() => logEntry),
      take(1),
      catchError((err) => {
        this.report(err, { phase: 'logAdminAction', action: a, targetUserUid: t }, silent);

        if (!silent) {
          this.errorNotifier.showError('Falha ao registrar ação administrativa.');
        }

        return throwError(() => err);
      })
    );
  }

  listAdminActions$(maxResults = 120): Observable<IAdminLogRecord[]> {
    return this.read.getDocumentsLive<IAdminLogRecord>(
      'admin_logs',
      [orderBy('timestamp', 'desc'), limit(Math.max(1, Math.min(maxResults, 300)))],
      {
        idField: 'id',
        requireAuth: true,
      }
    ).pipe(
      catchError((err) => {
        this.report(err, { phase: 'listAdminActions', maxResults }, true);
        return throwError(() => err);
      })
    );
  }

  private resolveActorUid(passedAdminUid?: string): string | null {
    const current = this.auth.currentUser?.uid ?? null;

    if (this.debug && passedAdminUid && current && passedAdminUid !== current) {
      // eslint-disable-next-line no-console
      console.warn('[AdminLogService] adminUid param != auth uid. Usando auth uid.', {
        passedAdminUid,
        current,
      });
    }
    return current;
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
