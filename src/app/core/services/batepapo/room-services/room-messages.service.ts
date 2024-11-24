// src/app/core/services/batepapo/rooms/room-messages.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, collection, addDoc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Injectable({
  providedIn: 'root',
})
export class RoomMessagesService {
  private db = getFirestore();

  constructor(private errorNotifier: ErrorNotificationService) { }

  /**
   * Obtém mensagens de uma sala.
   * @param roomId ID da sala.
   * @returns Observable com as mensagens.
   */
  getRoomMessages(roomId: string): Observable<any[]> {
    const messagesRef = collection(this.db, `rooms/${roomId}/messages`);
    const messagesQuery = query(messagesRef, orderBy('timestamp', 'asc'));
    return new Observable((observer) => {
      const unsubscribe = onSnapshot(
        messagesQuery,
        (snapshot) => {
          const messages = snapshot.docs.map((doc) => doc.data());
          observer.next(messages);
        },
        (error) => {
          this.errorNotifier.showError('Erro ao carregar mensagens.');
          observer.error(error);
        }
      );
      return () => unsubscribe();
    });
  }

  /**
   * Envia uma mensagem para a sala.
   * @param roomId ID da sala.
   * @param message Objeto da mensagem.
   */
  async sendMessageToRoom(roomId: string, message: any): Promise<void> {
    try {
      const messagesRef = collection(this.db, `rooms/${roomId}/messages`);
      await addDoc(messagesRef, message);
    } catch (error) {
      this.errorNotifier.showError('Erro ao enviar mensagem.');
      throw error;
    }
  }
}
