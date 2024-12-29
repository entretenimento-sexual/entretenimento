// src/app/core/services/batepapo/rooms/room-messages.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, collection, addDoc, onSnapshot, orderBy, query, doc, setDoc } from 'firebase/firestore';
import { catchError, from, map, Observable } from 'rxjs';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FirestoreService } from '../../data-handling/firestore.service';

@Injectable({
  providedIn: 'root',
})
export class RoomMessagesService {
  private db = getFirestore();

  constructor(private errorNotifier: ErrorNotificationService,
              private firestoreService: FirestoreService,
            ) { }

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

  /**
 * Atualiza o status de uma mensagem em uma sala.
 * @param roomId ID da sala.
 * @param messageId ID da mensagem.
 * @param status Novo status ('sent', 'delivered', 'read').
 * @returns Uma Promise indicando o sucesso ou falha da operação.
 */
  updateMessageStatus(roomId: string, messageId: string, status: 'sent' | 'delivered' | 'read'): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance();
    const messageDocRef = doc(db, `rooms/${roomId}/messages/${messageId}`);

    return from(setDoc(messageDocRef, { status }, { merge: true })).pipe(
      map(() => {
        console.log(`Status da mensagem ${messageId} atualizado para: ${status}`);
      }),
      catchError(error => {
        this.errorNotifier.showError('Erro ao atualizar status da mensagem na sala.');
        throw error;
      })
    );
  }

}
