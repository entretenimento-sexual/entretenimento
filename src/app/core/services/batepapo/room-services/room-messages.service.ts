// src/app/core/services/batepapo/room-services/room-messages.service.ts
// Serviço de mensagens de room.
//
// Objetivos desta versão:
// - manter room em compatibilidade sem poluir UX
// - garantir que collection/query/collectionData/doc/setDoc/addDoc
//   rodem dentro de injection context
// - preservar helpers reutilizáveis para read receipts
//
// Ajustes desta versão:
// - remove warning de collectionData fora de injection context
// - remove warning de refs/query fora de injection context
// - mantém Observable-first

import { Injectable } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  doc,
  limit,
  orderBy,
  query,
  setDoc,
} from '@angular/fire/firestore';

import { Observable, defer, from, of } from 'rxjs';
import { catchError, map, take, tap } from 'rxjs/operators';

import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { Message } from '@core/interfaces/interfaces-chat/message.interface';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class RoomMessagesService {
  private readonly debug = !environment.production;

  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) {}

  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[RoomMessagesService] ${msg}`, extra ?? '');
  }

  private reportSilent(action: string, err: unknown): void {
    const e = err instanceof Error ? err : new Error(`[RoomMessagesService] ${action}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = { action };
    this.globalErrorHandler.handleError(e);
  }

  private normRoomId(roomId: string): string {
    return (roomId ?? '').toString().trim();
  }

  private normMessageId(messageId: string): string {
    return (messageId ?? '').toString().trim();
  }

  private messagesCol(roomId: string) {
    const rid = this.normRoomId(roomId);
    return this.ctx.run(() => collection(this.db, `rooms/${rid}/messages`));
  }

  private messageRef(roomId: string, messageId: string) {
    const rid = this.normRoomId(roomId);
    const mid = this.normMessageId(messageId);

    return this.ctx.run(() =>
      doc(this.db, `rooms/${rid}/messages/${mid}`)
    );
  }

  private buildMessagesQuery(roomId: string, pageSize: number) {
    return this.ctx.run(() =>
      query(
        this.messagesCol(roomId),
        orderBy('timestamp', 'asc'),
        limit(pageSize)
      )
    );
  }

  /**
   * getRoomMessages(roomId)
   * Realtime stream ASC por timestamp.
   * ✅ Retorna idField para permitir update status (read/delivered).
   * ✅ Em erro: report silent + retorna [] (não derruba UI).
   */
  getRoomMessages(roomId: string, pageSize = 200): Observable<Message[]> {
    const rid = this.normRoomId(roomId);
    if (!rid) return of([]);

    return defer(() => {
      const q = this.buildMessagesQuery(rid, pageSize);
      return this.ctx.run(() =>
        collectionData(q as any, { idField: 'id' })
      ) as Observable<Message[]>;
    }).pipe(
      map((arr) => (arr ?? []) as Message[]),
      map((list) => list.filter((m) => !!m)),
      tap((list) => this.dbg('getRoomMessages()', { roomId: rid, count: list.length })),
      catchError((err) => {
        this.reportSilent('getRoomMessages', err);
        return of([] as Message[]);
      })
    );
  }

  /**
   * sendMessageToRoom$ (preferido)
   * - Observable para compor com streams (mobile/web).
   * - Erro: report + toast (aqui é ação do usuário, então pode notificar).
   */
  sendMessageToRoom$(roomId: string, message: Message): Observable<string> {
    const rid = this.normRoomId(roomId);
    if (!rid) return of('');

    return defer(() =>
      from(this.ctx.run(() => addDoc(this.messagesCol(rid), message as any)))
    ).pipe(
      map((ref) => ref.id),
      catchError((err) => {
        this.reportSilent('sendMessageToRoom$', err);
        this.errorNotifier.showError('Erro ao enviar mensagem.');
        return of('');
      })
    );
  }

  /**
   * sendMessageToRoom (compat legado)
   */
  async sendMessageToRoom(roomId: string, message: any): Promise<void> {
    await this.sendMessageToRoom$(roomId, message as Message).pipe(take(1)).toPromise();
  }

  /**
   * updateMessageStatus
   * ✅ Mantém nome
   * - Por padrão: silent (read receipts não devem gerar toast)
   */
  updateMessageStatus(
    roomId: string,
    messageId: string,
    status: 'sent' | 'delivered' | 'read',
    notifyUser = false
  ): Observable<void> {
    const rid = this.normRoomId(roomId);
    const mid = this.normMessageId(messageId);
    if (!rid || !mid) return of(void 0);

    return defer(() =>
      from(
        this.ctx.run(() =>
          setDoc(this.messageRef(rid, mid), { status } as any, { merge: true })
        )
      )
    ).pipe(
      map(() => void 0),
      catchError((err) => {
        this.reportSilent('updateMessageStatus', err);
        if (notifyUser) {
          this.errorNotifier.showError('Erro ao atualizar status da mensagem na sala.');
        }
        return of(void 0);
      })
    );
  }

  /**
   * markDeliveredAsRead$
   * Helper para remover duplicação no componente.
   */
  markDeliveredAsRead$(roomId: string, myUid: string, messages: Message[]): Observable<number> {
    const rid = this.normRoomId(roomId);
    const me = (myUid ?? '').toString().trim();
    const list = messages ?? [];

    if (!rid || !me || !list.length) return of(0);

    const toMark = list
      .filter((m) => m?.status === 'delivered' && m.senderId !== me && !!(m as any).id)
      .map((m) => (m as any).id as string);

    if (!toMark.length) return of(0);

    const ops$ = toMark.map((id) => this.updateMessageStatus(rid, id, 'read', false));

    return from(Promise.all(ops$.map((o) => o.pipe(take(1)).toPromise()))).pipe(
      map(() => toMark.length),
      catchError((err) => {
        this.reportSilent('markDeliveredAsRead$', err);
        return of(0);
      })
    );
  }
}