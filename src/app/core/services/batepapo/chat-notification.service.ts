// src/app/core/services/batepapo/chat-notification.service.ts
// Serviço de Bate-Papo usando Firestore
// Não esquecer os comentários

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, from, of } from 'rxjs';
import { catchError, map, mergeMap, reduce } from 'rxjs/operators';

// ✅ Injeta a instância correta via AngularFire
import { Firestore } from '@angular/fire/firestore';

// ✅ Use o pacote público "firebase/firestore" (evite @firebase/*)
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  writeBatch,
  type QuerySnapshot,
  type DocumentData,
} from 'firebase/firestore';

import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class ChatNotificationService {
  private unreadMessagesCount = new BehaviorSubject<number>(0);
  private pendingInvitesCount = new BehaviorSubject<number>(0);

  unreadMessagesCount$ = this.unreadMessagesCount.asObservable();
  pendingInvitesCount$ = this.pendingInvitesCount.asObservable();

  // controle de listener/recompute
  private currentUid: string | null = null;
  private unsubChats: (() => void) | null = null;
  private recountSub: Subscription | null = null;
  private runToken = 0;

  constructor(
    private readonly db: Firestore,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) { }

  private dbg(tag: string, data?: any): void {
    const w: any = typeof window !== 'undefined' ? window : null;
    if (!w?.__DBG_ON__) return;
    if (typeof w?.DBG === 'function') w.DBG(`[CHAT-NOTIF] ${tag}`, data ?? '');
    else console.log(`[CHAT-NOTIF] ${tag}`, data ?? '');
  }

  updateUnreadMessagesForUser(totalUnreadCount: number): void {
    if (this.unreadMessagesCount.getValue() !== totalUnreadCount) {
      this.unreadMessagesCount.next(totalUnreadCount);
    }
  }

  updateUnreadMessages(count: number): void {
    if (this.unreadMessagesCount.getValue() !== count) {
      this.unreadMessagesCount.next(count);
    }
  }

  stopUnreadMessagesMonitoring(reason?: string): void {
    this.dbg('STOP', { reason, currentUid: this.currentUid });

    this.runToken++; // invalida resultados async antigos

    if (this.unsubChats) {
      this.unsubChats();
      this.unsubChats = null;
    }

    if (this.recountSub) {
      this.recountSub.unsubscribe();
      this.recountSub = null;
    }

    this.currentUid = null;
    this.unreadMessagesCount.next(0);
  }

  /** Monitora mensagens não lidas (idempotente + sem listener pendurado) */
  monitorUnreadMessages(userId: string): void {
    const uid = (userId ?? '').trim();
    if (!uid) return;

    // idempotente: se já está ouvindo o mesmo uid, não duplica
    if (this.currentUid === uid && this.unsubChats) {
      this.dbg('MONITOR SKIP (same uid)', { uid });
      return;
    }

    this.stopUnreadMessagesMonitoring();
    this.currentUid = uid;

    let userChatsQuery;
    try {
      const chatsRef = collection(this.db, 'chats');
      userChatsQuery = query(chatsRef, where('participants', 'array-contains', uid));
    } catch (err) {
      this.handleRealtimeError('Erro ao iniciar monitoramento', err, 'monitorUnreadMessages:initQuery');
      return;
    }

    const token = ++this.runToken;
    this.dbg('MONITOR START', { uid, token });

    this.unsubChats = onSnapshot(
      userChatsQuery,
      (snapshot: QuerySnapshot<DocumentData>) => {
        if (token !== this.runToken) return;
        this.recountUnreadFromSnapshot(snapshot, uid, token);
      },
      (err) => {
        if (token !== this.runToken) return;
        this.handleRealtimeError('Erro ao monitorar chats', err, 'monitorUnreadMessages:onSnapshot');
      }
    );
  }

  private recountUnreadFromSnapshot(
    snapshot: QuerySnapshot<DocumentData>,
    userId: string,
    token: number
  ): void {
    const chatIds: string[] = (snapshot?.docs ?? []).map(d => String(d.id));

    this.dbg('SNAPSHOT', { token, chats: chatIds.length });

    if (!chatIds.length) {
      if (token === this.runToken) this.updateUnreadMessagesForUser(0);
      return;
    }

    if (this.recountSub) {
      this.recountSub.unsubscribe();
      this.recountSub = null;
    }

    this.recountSub = from(chatIds).pipe(
      mergeMap((chatId) => this.countUnreadForChat$(chatId, userId), 6),
      reduce((acc: number, n: number) => acc + n, 0),
      catchError((err) => {
        this.handleRealtimeError('Erro ao calcular mensagens não lidas', err, 'recountUnreadFromSnapshot');
        return of(0);
      })
    ).subscribe((total) => {
      if (token !== this.runToken) return;
      this.dbg('TOTAL', { token, total });
      this.updateUnreadMessagesForUser(total);
    });
  }

  private countUnreadForChat$(chatId: string, userId: string): Observable<number> {
    let unreadMessagesQuery;
    try {
      const messagesRef = collection(this.db, `chats/${chatId}/messages`);
      unreadMessagesQuery = query(
        messagesRef,
        where('status', '==', 'sent'),
        where('senderId', '!=', userId)
      );
    } catch (err) {
      this.handleRealtimeError('Erro ao montar query de não lidas', err, 'countUnreadForChat$:buildQuery');
      return of(0);
    }

    return from(getDocs(unreadMessagesQuery)).pipe(
      map(snap => snap.size),
      catchError(err => {
        this.handleRealtimeError('Erro ao ler mensagens não lidas', err, 'countUnreadForChat$:getDocs');
        return of(0);
      })
    );
  }

  /** Reseta mensagens não lidas para um chat específico */
  resetUnreadMessagesForChat(chatId: string): void {
    const id = (chatId ?? '').trim();
    if (!id) return;

    let qSent;
    try {
      const messagesRef = collection(this.db, `chats/${id}/messages`);
      qSent = query(messagesRef, where('status', '==', 'sent'));
    } catch (err) {
      this.handleRealtimeError('Erro ao preparar reset de mensagens', err, 'resetUnreadMessagesForChat:buildQuery');
      return;
    }

    // Mantém assinatura void, mas usa fluxo Rx internamente
    from(getDocs(qSent)).pipe(
      mergeMap((snap) => {
        // batch (melhor que Promise.all / setDoc individual)
        const batch = writeBatch(this.db);

        for (const d of snap.docs) {
          batch.update(d.ref, { status: 'read' });
        }

        return from(batch.commit());
      }),
      catchError((err) => {
        this.handleRealtimeError('Erro ao resetar mensagens', err, 'resetUnreadMessagesForChat:commit');
        return of(void 0);
      })
    ).subscribe(() => {
      if (this.currentUid) this.refreshUnreadCountOnce(this.currentUid);
    });
  }

  private refreshUnreadCountOnce(userId: string): void {
    const uid = (userId ?? '').trim();
    if (!uid) return;

    let userChatsQuery;
    try {
      const chatsRef = collection(this.db, 'chats');
      userChatsQuery = query(chatsRef, where('participants', 'array-contains', uid));
    } catch (err) {
      this.handleRealtimeError('Erro ao atualizar contagem de não lidas', err, 'refreshUnreadCountOnce:buildQuery');
      return;
    }

    const token = ++this.runToken;

    getDocs(userChatsQuery)
      .then((snapshot) => this.recountUnreadFromSnapshot(snapshot as any, uid, token))
      .catch((err) => this.handleRealtimeError('Erro ao atualizar contagem de não lidas', err, 'refreshUnreadCountOnce:getDocs'));
  }

  updatePendingInvites(count: number): void {
    if (this.pendingInvitesCount.getValue() !== count) {
      this.pendingInvitesCount.next(count);
    }
  }

  incrementUnreadMessages(): void {
    this.unreadMessagesCount.next(this.unreadMessagesCount.getValue() + 1);
  }
  decrementUnreadMessages(): void {
    const currentCount = this.unreadMessagesCount.getValue();
    if (currentCount > 0) this.unreadMessagesCount.next(currentCount - 1);
  }

  incrementPendingInvites(): void {
    this.pendingInvitesCount.next(this.pendingInvitesCount.getValue() + 1);
  }
  decrementPendingInvites(): void {
    const currentCount = this.pendingInvitesCount.getValue();
    if (currentCount > 0) this.pendingInvitesCount.next(currentCount - 1);
  }

  resetUnreadMessages(): void { this.unreadMessagesCount.next(0); }
  resetPendingInvites(): void { this.pendingInvitesCount.next(0); }

  // -----------------------------------------------------------------------------
  // Erros (centralizados)
  // -----------------------------------------------------------------------------
  private handleRealtimeError(userMessage: string, err: any, context?: string): void {
    const wrapped = this.wrapError(err, context ?? 'ChatNotificationService');

    // evita duplicidade se o GlobalErrorHandler também notifica
    try { this.globalErrorHandler.handleError(wrapped); } catch { }

    // notificação explícita (sua escolha aqui)
    this.errorNotifier.showError(userMessage);
  }

  private wrapError(err: unknown, context: string): Error {
    const e = err instanceof Error ? err : new Error(String(err ?? 'unknown error'));
    (e as any).silent = true;
    (e as any).skipUserNotification = true;
    (e as any).feature = 'chat-notification';
    (e as any).context = context;
    (e as any).original = err;
    return e;
  }
}
