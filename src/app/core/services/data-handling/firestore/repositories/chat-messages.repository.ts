// src/app/core/services/data-handling/firestore/repositories/chat-messages.repository.ts
// Não esqueça os comentários
import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { from, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
} from '@angular/fire/firestore';

import { Timestamp } from 'firebase/firestore';
import { Message } from '@core/interfaces/interfaces-chat/message.interface';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class ChatMessagesRepository {
  constructor(
    private readonly db: Firestore,
    private readonly injector: Injector,
    private readonly globalError: GlobalErrorHandlerService
  ) { }

  private reportSilent(action: string, err: unknown): void {
    const e = err instanceof Error ? err : new Error(`[ChatMessagesRepository] ${action}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = { action };
    this.globalError.handleError(e);
  }

  private messagesCol(chatId: string) {
    return runInInjectionContext(this.injector, () =>
      collection(this.db, `chats/${chatId}/messages`)
    );
  }

  private messageRef(chatId: string, messageId: string) {
    return runInInjectionContext(this.injector, () =>
      doc(this.db, `chats/${chatId}/messages/${messageId}`)
    );
  }

  addMessage$(chatId: string, msg: Message): Observable<string> {
    return from(addDoc(this.messagesCol(chatId), msg as any)).pipe(
      map(ref => ref.id),
      catchError(err => {
        this.reportSilent('addMessage$', err);
        return of('' as any);
      })
    );
  }

  deleteMessage$(chatId: string, messageId: string): Observable<void> {
    return from(deleteDoc(this.messageRef(chatId, messageId))).pipe(
      map(() => void 0),
      catchError(err => {
        this.reportSilent('deleteMessage$', err);
        return of(void 0);
      })
    );
  }

  updateMessageStatus$(chatId: string, messageId: string, status: 'sent' | 'delivered' | 'read'): Observable<void> {
    return from(setDoc(this.messageRef(chatId, messageId), { status } as any, { merge: true })).pipe(
      map(() => void 0),
      catchError(err => {
        this.reportSilent('updateMessageStatus$', err);
        return of(void 0);
      })
    );
  }

  getMessagesPageOnce$(chatId: string, lastMessageTimestamp?: Timestamp, pageSize = 20): Observable<Message[]> {
    const base = [orderBy('timestamp', 'desc'), limit(pageSize)] as any[];
    const q = lastMessageTimestamp
      ? query(this.messagesCol(chatId), orderBy('timestamp', 'desc'), startAfter(lastMessageTimestamp), limit(pageSize))
      : query(this.messagesCol(chatId), ...base);

    return from(getDocs(q)).pipe(
      map(snap => snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Message)).reverse()),
      catchError(err => {
        this.reportSilent('getMessagesPageOnce$', err);
        return of([]);
      })
    );
  }

  watchMessages$(chatId: string, pageSize = 200): Observable<Message[]> {
    const q = query(this.messagesCol(chatId), orderBy('timestamp', 'asc'), limit(pageSize));

    return collectionData(q as any, { idField: 'id' }).pipe(
      map(arr => (arr ?? []) as Message[]),
      catchError(err => {
        this.reportSilent('watchMessages$', err);
        return of([]);
      })
    );
  }
}
