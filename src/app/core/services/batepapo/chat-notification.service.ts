// C:\entretenimento\src\app\core\services\batepapo\chat-notification.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, from, of } from 'rxjs';
import { catchError, map, mergeMap, reduce } from 'rxjs/operators';
import { collection, query, where, onSnapshot, getDocs, setDoc } from '@firebase/firestore';

import { FirestoreService } from '../data-handling/legacy/firestore.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';

type QuerySnapshotLike = { docs: Array<{ id: string }> };

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
    private firestoreService: FirestoreService,
    private globalErrorHandler: GlobalErrorHandlerService,
    private errorNotifier: ErrorNotificationService
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
    if (!userId) return;

    // idempotente: se já está ouvindo o mesmo uid, não duplica
    if (this.currentUid === userId && this.unsubChats) {
      this.dbg('MONITOR SKIP (same uid)', { userId });
      return;
    }

    this.stopUnreadMessagesMonitoring();
    this.currentUid = userId;

    const db: any = this.firestoreService.getFirestoreInstance();
    const chatsRef = collection(db, 'chats');
    const userChatsQuery = query(chatsRef, where('participants', 'array-contains', userId));

    const token = ++this.runToken;
    this.dbg('MONITOR START', { userId, token });

    this.unsubChats = onSnapshot(
      userChatsQuery,
      (snapshot: any) => {
        if (token !== this.runToken) return;
        this.recountUnreadFromSnapshot(snapshot as QuerySnapshotLike, userId, token);
      },
      (err) => {
        if (token !== this.runToken) return;
        this.handleRealtimeError('Erro ao monitorar chats', err);
      }
    );
  }

  private recountUnreadFromSnapshot(snapshot: QuerySnapshotLike, userId: string, token: number): void {
    const db: any = this.firestoreService.getFirestoreInstance();
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

    // ✅ evita o inferno do forkJoin typing + controla concorrência
    this.recountSub = from(chatIds).pipe(
      mergeMap((chatId) => this.countUnreadForChat$(db, chatId, userId), 6),
      reduce((acc: number, n: number) => acc + n, 0),
      catchError((err) => {
        this.handleRealtimeError('Erro ao calcular mensagens não lidas', err);
        return of(0);
      })
    ).subscribe((total) => {
      if (token !== this.runToken) return;
      this.dbg('TOTAL', { token, total });
      this.updateUnreadMessagesForUser(total);
    });
  }

  private countUnreadForChat$(db: any, chatId: string, userId: string): Observable<number> {
    const messagesRef = collection(db, `chats/${chatId}/messages`);
    const unreadMessagesQuery = query(
      messagesRef,
      where('status', '==', 'sent'),
      where('senderId', '!=', userId)
    );

    return from(getDocs(unreadMessagesQuery)).pipe(
      map(snap => snap.size),
      catchError(err => {
        this.handleRealtimeError('Erro ao ler mensagens não lidas', err);
        return of(0);
      })
    );
  }

  /** Reseta mensagens não lidas para um chat específico */
  resetUnreadMessagesForChat(chatId: string): void {
    const db: any = this.firestoreService.getFirestoreInstance();
    const messagesRef = collection(db, `chats/${chatId}/messages`);

    getDocs(query(messagesRef, where('status', '==', 'sent')))
      .then((snapshot) =>
        Promise.all(snapshot.docs.map((d: any) => setDoc(d.ref, { status: 'read' }, { merge: true })))
      )
      .then(() => {
        if (this.currentUid) this.refreshUnreadCountOnce(this.currentUid);
      })
      .catch((err) => this.handleRealtimeError('Erro ao resetar mensagens', err));
  }

  private refreshUnreadCountOnce(userId: string): void {
    const db: any = this.firestoreService.getFirestoreInstance();
    const chatsRef = collection(db, 'chats');
    const userChatsQuery = query(chatsRef, where('participants', 'array-contains', userId));

    const token = ++this.runToken;

    getDocs(userChatsQuery)
      .then((snapshot: any) => this.recountUnreadFromSnapshot(snapshot as QuerySnapshotLike, userId, token))
      .catch((err) => this.handleRealtimeError('Erro ao atualizar contagem de não lidas', err));
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

  private handleRealtimeError(userMessage: string, err: any): void {
    this.globalErrorHandler.handleError(err);
    this.errorNotifier.showError(userMessage);
  }
}
