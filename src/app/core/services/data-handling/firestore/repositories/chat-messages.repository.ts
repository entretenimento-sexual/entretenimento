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

import { Injectable } from '@angular/core';
import { Observable, defer, from, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import {
  Firestore,
  FieldPath,
  collection,
  collectionData,
  deleteField,
  doc,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  updateDoc,
} from '@angular/fire/firestore';

import { Timestamp } from 'firebase/firestore';
import { Message } from '@core/interfaces/interfaces-chat/message.interface';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';

/** Evita consultas excessivas mesmo quando um chamador passa limite inválido. */
export function boundedChatMessagePageSize(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(60, Math.max(1, Math.trunc(value)));
}

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

  private buildLatestQuery(chatId: string, pageSize: number) {
    return this.ctx.run(() =>
      query(
        this.messagesCol(chatId),
        orderBy('timestamp', 'desc'),
        orderBy(documentId(), 'desc'),
        limit(pageSize)
      )
    );
  }

  private buildDescQuery(
    chatId: string,
    pageSize: number,
    lastMessageTimestamp?: Timestamp,
    lastMessageId?: string
  ) {
    return this.ctx.run(() =>
      lastMessageTimestamp
        ? query(
            this.messagesCol(chatId),
            orderBy('timestamp', 'desc'),
            orderBy(documentId(), 'desc'),
            ...(lastMessageId
              ? [startAfter(lastMessageTimestamp, lastMessageId)]
              : [startAfter(lastMessageTimestamp)]),
            limit(pageSize)
          )
        : query(
            this.messagesCol(chatId),
            orderBy('timestamp', 'desc'),
            orderBy(documentId(), 'desc'),
            limit(pageSize)
          )
    );
  }

  /**
   * Tombstones legados: gravação e exclusão de mensagem direta são exclusivas
   * de sendDirectMessage/deleteDirectMessage no backend. Não tente addDoc
   * ou deleteDoc: as Rules bloqueiam ambas as operações.
   *
   * Preservamos as assinaturas por compatibilidade, mas retornamos erro
   * explícito, sem sucesso aparente e sem qualquer request ao Firestore.
   */
  private rejectLegacyMessageMutation$<T>(operation: string): Observable<T> {
    return defer(() => {
      const error = new Error(
        'Operação de mensagem direta descontinuada. Use a Cloud Function.'
      ) as Error & { code: string; operation: string };
      error.code = 'failed-precondition';
      error.operation = operation;
      return throwError(() => error);
    });
  }

  addMessage$(_chatId: string, _msg: Message): Observable<string> {
    return this.rejectLegacyMessageMutation$('addMessage$');
  }

  deleteMessage$(_chatId: string, _messageId: string): Observable<void> {
    return this.rejectLegacyMessageMutation$('deleteMessage$');
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
          updateDoc(this.messageRef(cid, mid), { status })
        )
      )
    ).pipe(
      map(() => void 0)
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

    return defer(() =>
      from(this.ctx.run(() =>
        updateDoc(
          this.messageRef(cid, mid),
          new FieldPath('reactionsByUser', safeUid),
          safeEmoji ?? deleteField()
        )
      ))
    ).pipe(
      map(() => void 0)
    );
  }

  getMessagesPageOnce$(
    chatId: string,
    lastMessageTimestamp?: Timestamp,
    pageSize = 20,
    lastMessageId?: string
  ): Observable<Message[]> {
    const cid = this.normChatId(chatId);
    if (!cid) return of([]);

    return defer(() => {
      const q = this.buildDescQuery(cid, boundedChatMessagePageSize(pageSize, 20), lastMessageTimestamp, lastMessageId);
      return from(this.ctx.run(() => getDocs(q)));
    }).pipe(
      map((snap) =>
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) } as Message))
          .reverse()
      ),
      catchError((err) => {
        this.reportSilent('getMessagesPageOnce$', err);
        return throwError(() => err);
      })
    );
  }

  watchMessages$(chatId: string, pageSize = 60): Observable<Message[]> {
    const cid = this.normChatId(chatId);
    if (!cid) return of([]);

    return defer(() => {
      // A janela realtime precisa acompanhar as mensagens MAIS RECENTES, inclusive
      // depois de um intervalo offline; não a primeira página histórica.
      const q = this.buildLatestQuery(cid, boundedChatMessagePageSize(pageSize, 60));
      return this.ctx.run(() =>
        collectionData(q as any, { idField: 'id' })
      ) as Observable<Message[]>;
    }).pipe(
      // A consulta limita pelos últimos timestamps; a UI continua em ordem
      // cronológica crescente, sem alterar o contrato de monitorChat.
      map((arr) => [...(arr ?? [])].reverse() as Message[]),
      catchError((err) => {
        this.reportSilent('watchMessages
    );
  }
}
, err);
        // Não disfarçar perda de permissão ou erro de transporte como chat vazio.
        // O chamador controla a limpeza da thread e eventual feedback ao usuário.
        return throwError(() => err);
      })
    );
  }
}
