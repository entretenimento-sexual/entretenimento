// Canonical client read path until the backend unread projection is validated.
// Count only authorized, server-confirmed message receipts. Alert visibility
// is independent of unread state. One shared subscription per active consumer set.
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, combineLatest, defer, from, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, shareReplay, startWith, switchMap, take, takeUntil } from 'rxjs/operators';
import { Firestore } from '@angular/fire/firestore';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { ChatRepository } from '../data-handling/firestore/repositories/chat.repository';
import { ApplicationErrorService } from '../error-handler/application-error.service';
import { AccessControlService } from '../autentication/auth/access-control.service';
import { DirectReceiptsService } from 'src/app/messaging/direct-chat/services/direct-receipts.service';
import { recoverDirectChatListener$ } from 'src/app/messaging/direct-chat/services/direct-chat-listener-recovery';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { isDirectMessageUnreadFor, totalDirectUnread, sameDirectUnreadState, type DirectUnreadState } from './chat-unread.policy';

@Injectable({ providedIn: 'root' })
export class ChatNotificationService {
  private readonly pendingInvitesCount = new BehaviorSubject<number>(0);
  private readonly activeChatId = new BehaviorSubject<string | null>(null);
  private legacyMonitor: Subscription | null = null;
  readonly pendingInvitesCount$ = this.pendingInvitesCount.asObservable();
  readonly activeChatId$ = this.activeChatId.asObservable();

  private readonly authorizedUid$ = combineLatest([
    this.accessControl.authUid$, this.accessControl.canRunChatRealtime$,
  ]).pipe(
    map(([uid, allowed]) => allowed ? uid : null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly unreadState$: Observable<DirectUnreadState> = this.authorizedUid$.pipe(
    switchMap(uid => uid
      ? this.observeUnreadForUser$(uid).pipe(startWith({ ownerUid: uid, counts: new Map<string, number>() }))
      : of({ ownerUid: null, counts: new Map<string, number>() })),
    catchError(error => {
      this.handleRealtimeError('Não foi possível acompanhar mensagens não lidas.', error, 'unreadState$');
      return of({ ownerUid: null, counts: new Map<string, number>() });
    }),
    distinctUntilChanged(sameDirectUnreadState),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly unreadMessagesCount$ = this.unreadState$.pipe(
    map(totalDirectUnread), distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly db: Firestore,
    private readonly applicationError: ApplicationErrorService,
    private readonly accessControl: AccessControlService,
    private readonly directReceipts: DirectReceiptsService,
    private readonly chatsRepo: ChatRepository
  ) {}

  setActiveChat(chatId: string | null | undefined, _reason?: string): void {
    const id = String(chatId ?? '').trim() || null;
    if (this.activeChatId.value !== id) this.activeChatId.next(id);
  }

  clearActiveChat(reason?: string): void { this.setActiveChat(null, reason); }

  // Legacy public signatures: never overwrite receipt-derived totals.
  updateUnreadMessagesForUser(_totalUnreadCount: number): void {}
  updateUnreadMessages(_count: number): void {}
  incrementUnreadMessages(): void {}
  decrementUnreadMessages(): void {}
  resetUnreadMessages(): void {}

  monitorUnreadMessages(userId: string): void {
    this.legacyMonitor?.unsubscribe();
    this.legacyMonitor = this.authorizedUid$.pipe(
      filter(uid => uid === userId),
      take(1),
      switchMap(() => this.unreadState$),
      takeUntil(this.authorizedUid$.pipe(filter(uid => uid !== userId)))
    ).subscribe();
  }

  stopUnreadMessagesMonitoring(_reason?: string): void {
    this.legacyMonitor?.unsubscribe();
    this.legacyMonitor = null;
    this.activeChatId.next(null);
  }

  private observeUnreadForUser$(uid: string): Observable<DirectUnreadState> {
    // Keep unchanged chat listeners across preview changes. Remove counts
    // synchronously when the parent list or its authorization is revoked.
    return new Observable<DirectUnreadState>(subscriber => {
      const listeners = new Map<string, { peer: string; sub: Subscription }>();
      const counts = new Map<string, number>();
      const emit = () => subscriber.next({ ownerUid: uid, counts: new Map(counts) });
      const clear = () => {
        listeners.forEach(entry => entry.sub.unsubscribe());
        listeners.clear();
        counts.clear();
      };
      const chatsSub = this.chatsRepo.watchDiscoveryForOwner$(uid).subscribe({
        next: scope => {
          if (scope.status !== 'ready') {
            clear(); emit(); return;
          }
          const peers = new Map<string, string>();
          for (const chat of scope.chats) {
            const pair = chat.participants;
            if (!chat.id || !Array.isArray(pair) || pair.length !== 2 ||
                !pair.includes(uid) || pair[0] === pair[1]) continue;
            const peer = pair.find(value => value !== uid);
            if (typeof peer === 'string' && peer.trim()) peers.set(chat.id, peer);
          }
          let removed = false;
          for (const [id, entry] of listeners) {
            if (peers.get(id) !== entry.peer) {
              entry.sub.unsubscribe(); listeners.delete(id); counts.delete(id); removed = true;
            }
          }
          if (removed) emit();
          for (const [id, peer] of peers) {
            if (listeners.has(id)) continue;
            const sub = new Subscription();
            listeners.set(id, { peer, sub });
            sub.add(this.countUnreadForChat$(id, uid, peer).subscribe(count => {
              if (listeners.get(id)?.sub !== sub) return;
              if (counts.get(id) === count) return;
              counts.set(id, count); emit();
            }));
          }
        },
        error: error => {
          clear(); emit();
          this.handleRealtimeError('Não foi possível acompanhar conversas.', error, 'observeUnreadForUser$');
        },
        complete: () => { clear(); emit(); }
      });
      return () => { chatsSub.unsubscribe(); clear(); };
    });
  }

  private countUnreadForChat$(chatId: string, ownerUid: string, peerUid: string): Observable<number> {
    return recoverDirectChatListener$(
      () => new Observable<number>(sink => onSnapshot(
        query(collection(this.db, 'chats', chatId, 'messages'), where('status', 'in', ['sent', 'delivered'])),
        { includeMetadataChanges: true },
        snapshot => sink.next(snapshot.metadata.fromCache ? 0 : snapshot.docs.filter(
          doc => !doc.metadata.hasPendingWrites && isDirectMessageUnreadFor(doc.data(), ownerUid, peerUid)
        ).length),
        error => sink.error(error)
      )),
      error => {
        this.handleRealtimeError('Não foi possível acompanhar mensagens não lidas.', error, 'countUnreadForChat$');
        return 0;
      }
    ).pipe(
      catchError(error => {
        this.handleRealtimeError('Não foi possível acompanhar mensagens não lidas.', error, 'countUnreadForChat$');
        return of(0);
      }),
      distinctUntilChanged()
    );
  }

  /** Legacy receipt command; the listener, not this command, updates counts. */
  resetUnreadMessagesForChat(chatId: string): void {
    const id = chatId?.trim();
    if (!id || id.includes('/')) return;
    this.authorizedUid$.pipe(
      take(1),
      switchMap(uid => !uid ? of(0) : defer(() => from(getDocs(query(
        collection(this.db, 'chats', id, 'messages'),
        where('status', 'in', ['sent', 'delivered'])
      )))).pipe(
        switchMap(snapshot => this.directReceipts.markDeliveredAsRead$(id, uid,
          snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as Message))),
        takeUntil(this.authorizedUid$.pipe(filter(current => current !== uid)))
      )),
      catchError(error => {
        this.handleRealtimeError('Erro ao atualizar recibos', error, 'resetUnreadMessagesForChat');
        return of(0);
      })
    ).subscribe();
  }

  updatePendingInvites(count: number): void {
    if (this.pendingInvitesCount.getValue() !== count) {
      this.pendingInvitesCount.next(count);
    }
  }

  incrementPendingInvites(): void {
    this.pendingInvitesCount.next(this.pendingInvitesCount.getValue() + 1);
  }
  decrementPendingInvites(): void {
    const currentCount = this.pendingInvitesCount.getValue();
    if (currentCount > 0) this.pendingInvitesCount.next(currentCount - 1);
  }

  resetPendingInvites(): void { this.pendingInvitesCount.next(0); }

  private handleRealtimeError(
    userMessage: string,
    error: unknown,
    operation = 'ChatNotificationService'
  ): void {
    this.applicationError.report(error, {
      feature: 'notifications.chat',
      operation,
      fallbackMessage: userMessage,
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'ChatNotificationService',
      },
    });
  }
}
