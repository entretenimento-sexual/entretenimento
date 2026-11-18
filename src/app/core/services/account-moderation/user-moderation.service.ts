// Bloqueio técnico da conta. Suspensões são aplicadas pelo lifecycle no backend.
import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { serverTimestamp } from 'firebase/firestore';
import { Observable, defer, of, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { AdminLogService } from './admin-log.service';

@Injectable({ providedIn: 'root' })
export class UserModerationService {
  constructor(
    private readonly write: FirestoreWriteService,
    private readonly auth: Auth,
    private readonly adminLogService: AdminLogService,
    private readonly applicationError: ApplicationErrorService
  ) {}

  lockAccount(uid: string): Observable<void> {
    return this.setAccountLock$(uid, true);
  }

  unlockAccount(uid: string): Observable<void> {
    return this.setAccountLock$(uid, false);
  }

  private setAccountLock$(uid: string, locked: boolean): Observable<void> {
    const operation = locked ? 'lockAccount' : 'unlockAccount';
    const fallbackMessage = locked
      ? 'Não foi possível bloquear a conta.'
      : 'Não foi possível desbloquear a conta.';

    return defer(() => {
      const actorUid = this.auth.currentUser?.uid;
      if (!actorUid) {
        return throwError(() => Object.assign(
          new Error('Sua sessão terminou. Entre novamente para continuar.'),
          { code: 'auth/not-authenticated' }
        ));
      }

      return this.write.updateDocument('users', uid, {
        accountLocked: locked,
        moderatedBy: actorUid,
        moderatedAt: serverTimestamp(),
      }, { context: 'UserModerationService.' + operation, silent: true }).pipe(
        switchMap(() => this.adminLogService.logAdminAction(actorUid, operation, uid).pipe(
          // Uma falha na auditoria não desfaz o bloqueio já confirmado.
          catchError(() => of(void 0))
        )),
        map(() => void 0),
        take(1)
      );
    }).pipe(
      catchError((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'account-moderation',
          operation,
          fallbackMessage,
          codeMessages: {
            'auth/not-authenticated': 'Sua sessão terminou. Entre novamente para continuar.',
            'permission-denied': 'Sua conta não tem autorização para alterar este bloqueio.',
          },
          metadata: { scope: 'UserModerationService', uid },
        });
        return throwError(() => error);
      })
    );
  }
}
