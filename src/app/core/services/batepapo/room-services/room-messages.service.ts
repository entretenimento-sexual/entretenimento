// src/app/core/services/batepapo/rooms/room-messages.service.ts
import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, addDoc, onSnapshot, orderBy, query, doc, setDoc } from 'firebase/firestore';
import { catchError, from, map, Observable } from 'rxjs';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FirestoreService } from '../../data-handling/firestore.service';

@Injectable({ providedIn: 'root' })
export class RoomMessagesService {
  constructor(
    private db: Firestore, // ⬅️ injeta Firestore
    private errorNotifier: ErrorNotificationService,
    private firestoreService: FirestoreService,
  ) { }

  getRoomMessages(roomId: string): Observable<any[]> {
    const messagesRef = collection(this.db, `rooms/${roomId}/messages`);
    const messagesQuery = query(messagesRef, orderBy('timestamp', 'asc'));
    return new Observable(observer => {
      const unsubscribe = onSnapshot(messagesQuery, snapshot => {
        const messages = snapshot.docs.map(d => d.data());
        observer.next(messages);
      }, error => {
        this.errorNotifier.showError('Erro ao carregar mensagens.');
        observer.error(error);
      });
      return () => unsubscribe();
    });
  }

  async sendMessageToRoom(roomId: string, message: any): Promise<void> {
    try {
      const messagesRef = collection(this.db, `rooms/${roomId}/messages`);
      await addDoc(messagesRef, message);
    } catch (error) {
      this.errorNotifier.showError('Erro ao enviar mensagem.');
      throw error;
    }
  }

  updateMessageStatus(
    roomId: string,
    messageId: string,
    status: 'sent' | 'delivered' | 'read'
  ): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance(); // se preferir, use this.db direto
    const messageDocRef = doc(db, `rooms/${roomId}/messages/${messageId}`);
    return from(setDoc(messageDocRef, { status }, { merge: true })).pipe(
      map(() => { /* ok */ }),
      catchError(error => {
        this.errorNotifier.showError('Erro ao atualizar status da mensagem na sala.');
        throw error;
      })
    );
  }
}
