// src/app/core/services/batepapo/rooms/room-messages.service.ts
import { Injectable } from '@angular/core';
import {
  Firestore, collection, addDoc, onSnapshot, orderBy, query,
  doc, setDoc
} from '@angular/fire/firestore';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class RoomMessagesService {
  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) { }

  getRoomMessages(roomId: string): Observable<any[]> {
    const messagesRef = collection(this.db, `rooms/${roomId}/messages`);
    const messagesQuery = query(messagesRef, orderBy('timestamp', 'asc'));

    return new Observable(observer => {
      const unsubscribe = onSnapshot(
        messagesQuery,
        snapshot => observer.next(snapshot.docs.map(d => d.data())),
        error => {
          this.globalErrorHandler.handleError(error);
          this.errorNotifier.showError('Erro ao carregar mensagens.');
          observer.error(error);
        }
      );
      return () => unsubscribe();
    });
  }

  async sendMessageToRoom(roomId: string, message: any): Promise<void> {
    try {
      const messagesRef = collection(this.db, `rooms/${roomId}/messages`);
      await addDoc(messagesRef, message);
    } catch (error: any) {
      this.globalErrorHandler.handleError(error);
      this.errorNotifier.showError('Erro ao enviar mensagem.');
      throw error;
    }
  }

  updateMessageStatus(roomId: string, messageId: string,status: 'sent' | 'delivered' | 'read'
  ): Observable<void> {
    const ref = doc(this.db, `rooms/${roomId}/messages/${messageId}`);

    return defer(() =>
      this.ctx.run(() => setDoc(ref, { status }, { merge: true }))
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        this.globalErrorHandler.handleError(error);
        this.errorNotifier.showError('Erro ao atualizar status da mensagem na sala.');
        return throwError(() => error);
      })
    );
  }
}
