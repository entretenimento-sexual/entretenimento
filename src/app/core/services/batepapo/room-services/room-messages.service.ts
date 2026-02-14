// src/app/core/services/batepapo/rooms/room-messages.service.ts
// - Padroniza retorno com idField
// - Stream passivo não deve “derrubar UX” nem spammar toast
// - Helpers reutilizáveis (markDeliveredAsRead$) para remover duplicação no componente

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
import { catchError, map, take } from 'rxjs/operators';

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
  ) { }

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

  /**
   * getRoomMessages(roomId)
   * Realtime stream ASC por timestamp.
   * ✅ Retorna idField para permitir update status (read/delivered).
   * ✅ Em erro: report silent + retorna [] (não derruba UI).
   */
  getRoomMessages(roomId: string, pageSize = 200): Observable<Message[]> {
    const rid = (roomId ?? '').toString().trim();
    if (!rid) return of([]);

    const messagesRef = collection(this.db, `rooms/${rid}/messages`);
    const q = query(messagesRef, orderBy('timestamp', 'asc'), limit(pageSize));

    return collectionData(q as any, { idField: 'id' }).pipe(
      map(arr => (arr ?? []) as Message[]),
      map(list => list.filter(m => !!m)), // sanity
      catchError(err => {
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
    const rid = (roomId ?? '').toString().trim();
    if (!rid) return of('');

    const messagesRef = collection(this.db, `rooms/${rid}/messages`);

    return defer(() => this.ctx.run(() => addDoc(messagesRef, message as any))).pipe(
      map(ref => ref.id),
      catchError(err => {
        this.reportSilent('sendMessageToRoom$', err);
        this.errorNotifier.showError('Erro ao enviar mensagem.');
        return of('');
      })
    );
  }

  /**
   * sendMessageToRoom (compat legado)
   * - Mantido para não quebrar chamadas antigas.
   * - Implementa via Observable.
   */
  async sendMessageToRoom(roomId: string, message: any): Promise<void> {
    await this.sendMessageToRoom$(roomId, message as Message).pipe(take(1)).toPromise();
  }

  /**
   * updateMessageStatus
   * ✅ Mantém nome
   * - Por padrão: silent (read receipts não devem gerar toast)
   * - notifyUser=true só se for ação explícita do usuário.
   */
  updateMessageStatus(
    roomId: string,
    messageId: string,
    status: 'sent' | 'delivered' | 'read',
    notifyUser = false
  ): Observable<void> {
    const rid = (roomId ?? '').toString().trim();
    const mid = (messageId ?? '').toString().trim();
    if (!rid || !mid) return of(void 0);

    const ref = doc(this.db, `rooms/${rid}/messages/${mid}`);

    return defer(() =>
      this.ctx.run(() => setDoc(ref, { status } as any, { merge: true }))
    ).pipe(
      map(() => void 0),
      catchError(err => {
        this.reportSilent('updateMessageStatus', err);
        if (notifyUser) this.errorNotifier.showError('Erro ao atualizar status da mensagem na sala.');
        return of(void 0);
      })
    );
  }

  /**
   * markDeliveredAsRead$
   * Helper para remover duplicação no componente.
   * - Filtra apenas mensagens recebidas (senderId !== myUid) e delivered.
   * - Aplica update status read best-effort.
   * - Retorna quantidade marcada (útil para debug/contador).
   */
  markDeliveredAsRead$(roomId: string, myUid: string, messages: Message[]): Observable<number> {
    const rid = (roomId ?? '').toString().trim();
    const me = (myUid ?? '').toString().trim();
    const list = messages ?? [];

    if (!rid || !me || !list.length) return of(0);

    const toMark = list
      .filter(m => m?.status === 'delivered' && m.senderId !== me && !!(m as any).id)
      .map(m => (m as any).id as string);

    if (!toMark.length) return of(0);

    // Sem “spam”: uma chamada por id, mas sem toast e best-effort.
    // Se quiser evoluir: trocar para writeBatch em um repository.
    const ops$ = toMark.map(id => this.updateMessageStatus(rid, id, 'read', false));

    return from(Promise.all(ops$.map(o => o.pipe(take(1)).toPromise()))).pipe(
      map(() => toMark.length),
      catchError(err => {
        this.reportSilent('markDeliveredAsRead$', err);
        return of(0);
      })
    );
  }
}
