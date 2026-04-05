// src/app/core/services/data-handling/firestore/repositories/chat.repository.ts
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
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
  where,
} from '@angular/fire/firestore';

import { Timestamp } from 'firebase/firestore';

import { IChat } from '@core/interfaces/interfaces-chat/chat.interface';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';

@Injectable({ providedIn: 'root' })
export class ChatRepository {
  private readonly db = inject(Firestore);
  private readonly ctx = inject(FirestoreContextService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private reportSilent(action: string, err: unknown): void {
    const e = err instanceof Error ? err : new Error(`[ChatRepository] ${action}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = { action };
    this.globalError.handleError(e);
  }

  private chatsCol() {
    return collection(this.db, 'chats');
  }

  private chatRef(chatId: string) {
    return doc(this.db, 'chats', chatId);
  }

  findChatIdByParticipantsKey$(participantsKey: string): Observable<string | null> {
    const key = (participantsKey ?? '').toString().trim();
    if (!key) return of(null);

    return this.ctx.deferPromise$(() => {
      const q = query(
        this.chatsCol(),
        where('participantsKey', '==', key),
        limit(1)
      );
      return getDocs(q);
    }).pipe(
      map((snap) => (snap.empty ? null : snap.docs[0].id)),
      catchError((err) => {
        this.reportSilent('findChatIdByParticipantsKey$', err);
        return of(null);
      })
    );
  }

  createChat$(participants: string[], participantsKey: string): Observable<string> {
    const chatData: IChat = {
      participants,
      participantsKey,
      timestamp: Timestamp.now(),
    } as any;

    return this.ctx.deferPromise$(() => addDoc(this.chatsCol(), chatData as any)).pipe(
      map((ref) => ref.id),
      catchError((err) => {
        this.reportSilent('createChat$', err);
        return of('');
      })
    );
  }

  updateChat$(chatId: string, patch: Partial<IChat>): Observable<void> {
    return this.ctx.deferPromise$(() =>
      setDoc(this.chatRef(chatId), patch as any, { merge: true })
    ).pipe(
      map(() => void 0),
      catchError((err) => {
        this.reportSilent('updateChat$', err);
        return of(void 0);
      })
    );
  }

  deleteChat$(chatId: string): Observable<void> {
    return this.ctx.deferPromise$(() => deleteDoc(this.chatRef(chatId))).pipe(
      map(() => void 0),
      catchError((err) => {
        this.reportSilent('deleteChat$', err);
        return of(void 0);
      })
    );
  }

  watchChats$(uid: string, pageSize = 10): Observable<IChat[]> {
    const id = (uid ?? '').toString().trim();
    if (!id) return of([]);

    return this.ctx.deferObservable$(() => {
      const q = query(
        this.chatsCol(),
        where('participants', 'array-contains', id),
        orderBy('timestamp', 'desc'),
        limit(pageSize)
      );

      return collectionData(q as any, { idField: 'id' }) as Observable<IChat[]>;
    }).pipe(
      map((arr) => (arr ?? []) as IChat[]),
      catchError((err) => {
        this.reportSilent('watchChats$', err);
        return of([]);
      })
    );
  }

  getChatsPageOnce$(uid: string, lastChatTimestamp?: Timestamp, pageSize = 10): Observable<IChat[]> {
    const id = (uid ?? '').toString().trim();
    if (!id) return of([]);

    return this.ctx.deferPromise$(() => {
      const q = lastChatTimestamp
        ? query(
            this.chatsCol(),
            where('participants', 'array-contains', id),
            orderBy('timestamp', 'desc'),
            startAfter(lastChatTimestamp),
            limit(pageSize)
          )
        : query(
            this.chatsCol(),
            where('participants', 'array-contains', id),
            orderBy('timestamp', 'desc'),
            limit(pageSize)
          );

      return getDocs(q);
    }).pipe(
      map((snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as IChat))),
      catchError((err) => {
        this.reportSilent('getChatsPageOnce$', err);
        return of([]);
      })
    );
  }
}