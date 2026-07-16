// src/app/core/services/data-handling/firestore/repositories/chat-messages.repository.ts
// Repositório de mensagens do chat 1:1.
//
// Objetivos desta versão:
// - manter Observable-first
// - garantir que APIs AngularFire sejam chamadas DENTRO de injection context
// - padronizar helpers de refs/queries
// - manter tratamento de erro silencioso no handler global
//
// Ajustes desta versão:
// - remove warning de collectionData fora de injection context
// - remove warning de query/collection/doc fora de injection context
// - mantém compat com paginação e status de mensagem
// - permite persistir reação por usuário em mensagens diretas
// - consolida avanço de receipts em transação para evitar disputas entre snapshots

import { Injectable } from '@angular/core';
import { Observable, defer, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  startAfter,
  updateDoc,
} from '@angular/fire/firestore';

import { Timestamp } from 'firebase/firestore';
import { Message } from '@core/interfaces/interfaces-chat/message.interface';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';

@Injectable({ providedIn: 'root' })
export class ChatMessagesRepository {
  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  private reportSilent(action: string, err: unknown): void {
    const e = err instanceof Error ? err : new Error(`[ChatMessagesRepository] ${action}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = { action };
    this.globalError.handleError(e);
  }

  private normChatId(chatId: string): string {
    return (chatId ?? '').trim();
  }

  private normMessageId(messageId: string): string {
    return (messageId ?? '').trim();
  }

  private messagesCol(chatId: string) {
    const cid = this.normChatId(chatId);
    return this.ctx.run(() => collection(this.db, `chats/${cid}/messages`));
  }

  private messageRef(chatId: string, messageId: string) {
    const cid = this.normChatId(chatId);
    const mid = this.normMessageId(messageId);

    return this.ctx.run(() =>
      doc(this.db, `chats/${cid}/messages/${mid}`)
    );
  }

  private buildAscQuery(chatId: string, pageSize: number) {
    return this.ctx.run(() =>
      query(
        this.messagesCol(chatId),
        orderBy('timestamp', 'asc'),
        limit(pageSize)
      )
    );
  }

  private buildDescQuery(
    chatId: string,
    pageSize: number,
    lastMessageTimestamp?: Timestamp
  ) {
    return this.ctx.run(() =>
      lastMessageTimestamp
        ? query(
            this.messagesCol(chatId),
            orderBy('timestamp', 'desc'),
            startAfter(lastMessageTimestamp),
            limit(pageSize)
          )
        : query(
            this.messagesCol(chatId),
            orderBy('timestamp', 'desc'),
            limit(pageSize)
          )
    );
  }

  addMessage$(chatId: string, msg: Message): Observable<string> {
    const cid = this.normChatId(chatId);
    if (!cid) return of('');

    return defer(() =>
      from(this.ctx.run(() => addDoc(this.messagesCol(cid), msg as any)))
    ).pipe(
      map((ref) => ref.id),
      catchError((err) => {
        this.reportSilent('addMessage$', err);
        return of('');
      })
    );
  }

  deleteMessage$(chatId: string, messageId: string): Observable<void> {
    const cid = this.normChatId(chatId);
    const mid = this.normMessageId(messageId);
    if (!cid || !mid) return of(void 0);

    return defer(() =>
      from(this.ctx.run(() => deleteDoc(this.messageRef(cid, mid))))
    ).pipe(
      map(() => void 0),
      catchError((err) => {
        this.reportSilent('deleteMessage$', err);
        return of(void 0);
      })
    );
  }

  updateMessageStatus$(
    chatId: string,
    messageId: string,
    status: 'sent' | 'delivered' | 'read'
  ): Observable<void> {
    const cid = this.normChatId(chatId);
    const mid = this.normMessageId(messageId);
    if (!cid || !mid) return of(void 0);

    return defer(() =>
      from(
        this.ctx.run(() =>
          setDoc(this.messageRef(cid, mid), { status } as any, { merge: true })
        )
      )
    ).pipe(
      map(() => void 0),
      catchError((err) => {
        this.reportSilent('updateMessageStatus$', err);
        return of(void 0);
      })
    );
  }

  /**
   * Avança receipts de mensagens recebidas usando o estado atual do Firestore.
   *
   * A transação evita que snapshots concorrentes tentem repetir uma transição
   * já concluída. Mensagens legadas sem status explícito são ignoradas porque as
   * Rules exigem que o estado anterior seja exatamente sent ou delivered.
   */
  advanceMessageReceipts$(
    chatId: string,
    currentUserUid: string,
    messageIds: readonly string[]
  ): Observable<number> {
    const cid = this.normChatId(chatId);
    const safeUid = String(currentUserUid ?? '').trim();
    const safeMessageIds = Array.from(
      new Set(
        (messageIds ?? [])
          .map((messageId) => this.normMessageId(messageId))
          .filter(Boolean)
      )
    ).slice(0, 50);

    if (!cid || !safeUid || !safeMessageIds.length) {
      return of(0);
    }

    return defer(() =>
      from(
        this.ctx.run(() =>
          runTransaction(this.db, async (transaction) => {
            const messageRefs = safeMessageIds.map((messageId) =>
              this.messageRef(cid, messageId)
            );
            const snapshots = await Promise.all(
              messageRefs.map((messageRef) => transaction.get(messageRef))
            );

            let updatedCount = 0;

            snapshots.forEach((snapshot, index) => {
              if (!snapshot.exists()) {
                return;
              }

              const data = snapshot.data() as Partial<Message>;
              const senderUid =
                String(data.senderUid ?? '').trim() ||
                String(data.senderId ?? '').trim();
              const currentStatus = data.status;

              if (!senderUid || senderUid === safeUid) {
                return;
              }

              const nextStatus =
                currentStatus === 'sent'
                  ? 'delivered'
                  : currentStatus === 'delivered'
                    ? 'read'
                    : null;

              if (!nextStatus) {
                return;
              }

              transaction.update(messageRefs[index], { status: nextStatus });
              updatedCount += 1;
            });

            return updatedCount;
          })
        )
      )
    ).pipe(
      map((updatedCount) => Math.max(0, Number(updatedCount ?? 0))),
      catchError((err) => {
        this.reportSilent('advanceMessageReceipts$', err);
        return of(0);
      })
    );
  }

  setMessageReaction$(
    chatId: string,
    messageId: string,
    uid: string,
    emoji: string | null
  ): Observable<void> {
    const cid = this.normChatId(chatId);
    const mid = this.normMessageId(messageId);
    const safeUid = String(uid ?? '').trim();
    const safeEmoji = String(emoji ?? '').trim() || null;

    if (!cid || !mid || !safeUid) return of(void 0);

    const fieldPath = `reactionsByUser.${safeUid}`;
    const patch = safeEmoji
      ? { [fieldPath]: safeEmoji }
      : { [fieldPath]: deleteField() };

    return defer(() =>
      from(this.ctx.run(() => updateDoc(this.messageRef(cid, mid), patch as any)))
    ).pipe(
      map(() => void 0),
      catchError((err) => {
        this.reportSilent('setMessageReaction$', err);
        return of(void 0);
      })
    );
  }

  getMessagesPageOnce$(
    chatId: string,
    lastMessageTimestamp?: Timestamp,
    pageSize = 20
  ): Observable<Message[]> {
    const cid = this.normChatId(chatId);
    if (!cid) return of([]);

    return defer(() => {
      const q = this.buildDescQuery(cid, pageSize, lastMessageTimestamp);
      return from(this.ctx.run(() => getDocs(q)));
    }).pipe(
      map((snap) =>
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) } as Message))
          .reverse()
      ),
      catchError((err) => {
        this.reportSilent('getMessagesPageOnce$', err);
        return of([]);
      })
    );
  }

  watchMessages$(chatId: string, pageSize = 200): Observable<Message[]> {
    const cid = this.normChatId(chatId);
    if (!cid) return of([]);

    return defer(() => {
      const q = this.buildAscQuery(cid, pageSize);
      return this.ctx.run(() =>
        collectionData(q as any, { idField: 'id' })
      ) as Observable<Message[]>;
    }).pipe(
      map((arr) => (arr ?? []) as Message[]),
      catchError((err) => {
        this.reportSilent('watchMessages$', err);
        return of([]);
      })
    );
  }
}
