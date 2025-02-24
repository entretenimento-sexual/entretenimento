//src\app\core\services\autentication\account-moderation\admin-log.service.ts
import { Injectable } from '@angular/core';
import { FirestoreService } from '../data-handling/firestore.service';
import { Timestamp } from 'firebase/firestore';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AdminLogService {

  constructor(private firestoreService: FirestoreService) { }

  /**
   * Registra uma ação administrativa no sistema de logs.
   */
  logAdminAction(adminUid: string, action: string, targetUserUid: string, details?: any): Observable<void> {
    const logEntry = {
      adminUid,
      action,
      targetUserUid,
      details: details || null,
      timestamp: Timestamp.fromDate(new Date())
    };
    return this.firestoreService.addDocument('admin_logs', logEntry);
  }
}
