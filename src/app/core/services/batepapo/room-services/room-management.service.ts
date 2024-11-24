// src/app/core/services/batepapo/rooms/room-management.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, collection } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { Chat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Injectable({
  providedIn: 'root',
})
export class RoomManagementService {
  private db = getFirestore();

  constructor(private errorNotifier: ErrorNotificationService) { }

  /**
   * Cria uma nova sala.
   * @param roomDetails Detalhes da sala.
   * @returns Promessa com os dados da sala criada.
   */
  createRoom(roomDetails: any): Observable<Chat> {
    return new Observable((observer) => {
      addDoc(collection(this.db, 'rooms'), roomDetails)
        .then((docRef) => {
          observer.next({ roomId: docRef.id, ...roomDetails });
          observer.complete();
        })
        .catch((error) => {
          this.errorNotifier.showError('Erro ao criar sala.');
          observer.error(error);
        });
    });
  }

  /**
   * Atualiza uma sala com novos detalhes.
   * @param roomId ID da sala.
   * @param roomDetails Novos detalhes da sala.
   */
  async updateRoom(roomId: string, roomDetails: any): Promise<void> {
    try {
      const roomRef = doc(this.db, 'rooms', roomId);
      await updateDoc(roomRef, roomDetails);
    } catch (error) {
      this.errorNotifier.showError('Erro ao atualizar sala.');
      throw error;
    }
  }

  /**
   * Exclui uma sala existente.
   * @param roomId ID da sala a ser excluída.
   */
  async deleteRoom(roomId: string): Promise<void> {
    try {
      const roomRef = doc(this.db, 'rooms', roomId);
      await deleteDoc(roomRef);
    } catch (error) {
      this.errorNotifier.showError('Erro ao deletar sala.');
      throw error;
    }
  }
}
