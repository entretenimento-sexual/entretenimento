// src/app/core/services/data-handling/firestore/repositories/chat.repository.ts
import { Injectable, inject } from '@angular/core';
import { Observable, defer, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import {
  Firestore,
  collection,
  collectionData,
  getDocs,
  limit,
  orderBy,
  query,
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

  /**
   * Criação, alteração e exclusão estrutural de chats são exclusivas do
   * backend. A consulta por participantsKey também é backend-only porque
   * não pode ser autorizada como uma leitura de coleção de participantes.
   * A UI moderna utiliza DirectChatService.ensureDirectChatIdWithUser$.
   *
   * Assinaturas mantidas apenas para consumidores legados. Nunca retorne
   * valores vazios ou void como se a escrita tivesse sido confirmada.
   */
  private rejectLegacyChatOperation$<T>(operation: string): Observable<T> {
    return defer(() => {
      const error = new Error(
        'Operação de conversa direta descontinuada. Use ensureDirectChat no backend.'
      ) as Error & { code: string; operation: string };
      error.code = 'failed-precondition';
      error.operation = operation;
      return throwError(() => error);
    });
  }

  findChatIdByParticipantsKey$(_participantsKey: string): Observable<string | null> {
    return this.rejectLegacyChatOperation$('findChatIdByParticipantsKey$');
  }

  createChat$(_participants: string[], _participantsKey: string): Observable<string> {
    return this.rejectLegacyChatOperation$('createChat$');
  }

  updateChat$(_chatId: string, _patch: Partial<IChat>): Observable<void> {
    return this.rejectLegacyChatOperation$('updateChat$');
  }

  deleteChat$(_chatId: string): Observable<void> {
    return this.rejectLegacyChatOperation$('deleteChat$');
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