import { Injectable, computed, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, of } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectChatNavigationOrchestrator } from './direct-chat-navigation.orchestrator';

export type DirectChatSelectionType = 'chat';

export interface DirectChatSelectionEvent {
  id: string;
  type: DirectChatSelectionType;
  peerUid?: string | null;
  peerName?: string | null;
  peerPhotoURL?: string | null;
}

@Injectable()
export class DirectChatSelectionContextFacade {
  private readonly selectedChatIdSignal = signal<string | null>(null);
  private readonly selectedTypeSignal =
    signal<DirectChatSelectionType | null>(null);
  private readonly activePeerUidSignal = signal<string | null>(null);
  private readonly activePeerNameSignal = signal<string | null>(null);
  private readonly activePeerPhotoURLSignal = signal<string | null>(null);

  readonly selectedChatId$ = toObservable(this.selectedChatIdSignal).pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedType$ = toObservable(this.selectedTypeSignal).pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly activePeerUid$ = toObservable(this.activePeerUidSignal).pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedChatId = computed(() => this.selectedChatIdSignal());
  readonly selectedType = computed(() => this.selectedTypeSignal());
  readonly activePeerUid = computed(() => this.activePeerUidSignal());
  readonly activePeerName = computed(() => this.activePeerNameSignal());
  readonly activePeerPhotoURL = computed(() => this.activePeerPhotoURLSignal());

  constructor(
    private readonly directChatFacade: DirectChatFacade,
    private readonly navigationOrchestrator: DirectChatNavigationOrchestrator
  ) {}

  selectedDirectPeerUid$(
    currentUid$: Observable<string | null>
  ): Observable<string | null> {
    return combineLatest([
      this.directChatFacade.selectedChat$,
      currentUid$,
      this.activePeerUid$,
    ]).pipe(
      map(([chat, currentUid, activePeerUid]) => {
        const safeActivePeerUid = (activePeerUid ?? '').trim();
        if (safeActivePeerUid) {
          return safeActivePeerUid;
        }

        const safeCurrentUid = (currentUid ?? '').trim();
        if (!safeCurrentUid) {
          return null;
        }

        const participants = Array.isArray(chat?.participants)
          ? chat.participants
          : [];

        return (
          participants
            .map((uid) => String(uid ?? '').trim())
            .find((uid) => !!uid && uid !== safeCurrentUid) ?? null
        );
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  select(
    chatId: string | null | undefined,
    type: DirectChatSelectionType | null | undefined
  ): void {
    const safeChatId = String(chatId ?? '').trim() || null;
    const safeType = type ?? null;

    this.selectedChatIdSignal.set(safeChatId);
    this.selectedTypeSignal.set(safeType);

    if (safeChatId && safeType === 'chat') {
      this.directChatFacade.selectChat(safeChatId);
      return;
    }

    this.directChatFacade.clearSelection();
  }

  clear(): void {
    this.selectedChatIdSignal.set(null);
    this.selectedTypeSignal.set(null);
    this.clearPeer();
    this.directChatFacade.clearSelection();
  }

  applyPeer(meta: {
    peerUid?: string | null;
    peerName?: string | null;
    peerPhotoURL?: string | null;
  } | null | undefined): void {
    this.activePeerUidSignal.set(
      String(meta?.peerUid ?? '').trim() || null
    );
    this.activePeerNameSignal.set(
      String(meta?.peerName ?? '').trim() || null
    );
    this.activePeerPhotoURLSignal.set(
      String(meta?.peerPhotoURL ?? '').trim() || null
    );
  }

  clearPeer(): void {
    this.activePeerUidSignal.set(null);
    this.activePeerNameSignal.set(null);
    this.activePeerPhotoURLSignal.set(null);
  }

  syncPeerContext$(
    currentUid$: Observable<string | null>
  ): Observable<void> {
    return combineLatest([
      this.selectedType$,
      this.selectedDirectPeerUid$(currentUid$),
    ]).pipe(
      switchMap(([selectedType, peerUid]) => {
        const safePeerUid = String(peerUid ?? '').trim();

        if (selectedType !== 'chat' || !safePeerUid) {
          return of(void 0);
        }

        if (
          this.activePeerUidSignal() === safePeerUid &&
          !!this.activePeerNameSignal()
        ) {
          return of(void 0);
        }

        return this.resolvePeer$(safePeerUid);
      })
    );
  }

  resolvePeer$(peerUid: string): Observable<void> {
    const safePeerUid = String(peerUid ?? '').trim();

    if (!safePeerUid) {
      this.clearPeer();
      return of(void 0);
    }

    this.activePeerUidSignal.set(safePeerUid);

    return this.navigationOrchestrator.resolvePeer$(safePeerUid).pipe(
      take(1),
      tap((peer) => {
        this.activePeerNameSignal.set(
          peer?.name ||
            this.activePeerNameSignal() ||
            'Conversa direta'
        );
        this.activePeerPhotoURLSignal.set(
          peer?.photoURL ||
            this.activePeerPhotoURLSignal() ||
            null
        );
      }),
      map(() => void 0)
    );
  }

  selectEvent(event: DirectChatSelectionEvent): boolean {
    const safeId = String(event?.id ?? '').trim();
    const safeType = event?.type ?? null;

    if (!safeId || safeType !== 'chat') {
      return false;
    }

    this.select(safeId, safeType);
    this.applyPeer({
      peerUid: event.peerUid,
      peerName: event.peerName,
      peerPhotoURL: event.peerPhotoURL,
    });

    return true;
  }
}
