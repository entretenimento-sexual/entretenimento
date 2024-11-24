// src/app/core/services/batepapo/rooms/room-reports.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Injectable({
  providedIn: 'root',
})
export class RoomReportsService {
  private db = getFirestore();

  constructor(private errorNotifier: ErrorNotificationService) { }

  /**
   * Registra uma denúncia contra uma sala.
   * @param roomId ID da sala.
   * @param reason Razão da denúncia.
   * @param userId ID do usuário que está denunciando.
   */
  async reportRoom(roomId: string, reason: string, userId: string): Promise<void> {
    try {
      const reportsRef = collection(this.db, `rooms/${roomId}/reports`);
      const report = {
        roomId,
        reason,
        reportedBy: userId,
        reportedAt: serverTimestamp(),
      };
      await addDoc(reportsRef, report);
    } catch (error) {
      this.errorNotifier.showError('Erro ao registrar denúncia.');
      throw error;
    }
  }
}
