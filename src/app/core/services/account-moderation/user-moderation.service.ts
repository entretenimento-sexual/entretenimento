//src\app\core\services\autentication\account-moderation\user-moderation.service.ts
import { Injectable } from '@angular/core';
import { FirestoreService } from '../data-handling/legacy/firestore.service';
import { Timestamp } from 'firebase/firestore';
import { Observable, of, tap } from 'rxjs';
import { AdminLogService } from './admin-log.service';

@Injectable({
  providedIn: 'root'
})
export class UserModerationService {

  constructor(private firestoreService: FirestoreService,
    private adminLogService: AdminLogService) { }

  // Bloqueia uma conta temporariamente
  lockAccount(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { accountLocked: true });
  }

  // Desbloqueia uma conta
  unlockAccount(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { accountLocked: false });
  }

  // Suspender usuário
  suspendUser(uid: string, reason: string, adminUid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, {
      suspended: true,
      suspensionReason: reason,
      suspendedAt: Timestamp.fromDate(new Date())
    }).pipe(
      tap(() => {
        this.adminLogService.logAdminAction(adminUid, 'suspendUser', uid, { reason }).subscribe();
        this.sendAccountActionNotification(uid, 'suspensa', reason).subscribe();
      })
    );
  }

  // Reativar usuário
  unsuspendUser(uid: string, adminUid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, {
      suspended: false,
      suspensionReason: null,
      suspendedAt: null
    }).pipe(
      tap(() => {
        this.adminLogService.logAdminAction(adminUid, 'unsuspendUser', uid).subscribe();
        this.sendAccountActionNotification(uid, 'reativada').subscribe();
      })
    );
  }

  /**
   * Envia uma notificação ao usuário sobre uma ação administrativa (suspensão, reativação, etc.).
   */
  sendAccountActionNotification(uid: string, action: string, reason?: string): Observable<void> {
    const notificationMessage = `Sua conta foi ${action}. ${reason ? 'Motivo: ' + reason : ''}`;
    console.log(`[Notificação] ${notificationMessage}`);
    return of();
  }
}
