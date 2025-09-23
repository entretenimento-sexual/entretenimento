// src/app/core/services/autentication/account-moderation/admin-log.service.ts
import { Injectable, inject } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { IAdminLog } from '../../interfaces/logs/iadming-log';
import { FirestoreService } from '../data-handling/firestore.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';


@Injectable({
  providedIn: 'root'
})
export class AdminLogService {
  private firestoreService = inject(FirestoreService);
  private errorHandler = inject(GlobalErrorHandlerService);
  private errorNotification = inject(ErrorNotificationService);

  /**
   * Registra uma ação administrativa no sistema de logs.
   */
  logAdminAction(
    adminUid: string,
    action: string,
    targetUserUid: string,
    details?: any
  ): Observable<IAdminLog> {
    const logEntry: IAdminLog = {
      adminUid,
      action,
      targetUserUid,
      details: details || null,
      timestamp: Timestamp.fromDate(new Date())
    };

    return this.firestoreService.addDocument('admin_logs', logEntry).pipe(
      map(() => logEntry),
      catchError(err => {
        this.errorHandler.handleError(err); // log global
        this.errorNotification.showError('Falha ao registrar ação administrativa.');
        return throwError(() => err);
      })
    );
  }
}
