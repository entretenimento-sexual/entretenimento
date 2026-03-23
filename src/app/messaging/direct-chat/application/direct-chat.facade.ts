// src/app/messaging/direct-chat/application/direct-chat.facade.ts
// ============================================================================
// DIRECT CHAT FACADE
//
// Responsabilidade desta facade:
// - expor a lista reativa de chats diretos 1:1
// - manter a seleção atual do chat direto
// - resolver a abertura de chat por participant uid
// - derivar item selecionado / estado da lista
// ============================================================================

import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import {
  DirectChatListItem,
  DirectChatListState,
} from '../models/direct-chat.models';

import { DirectChatService } from '../services/direct-chat.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class DirectChatFacade {
  private readonly debug = !environment.production;
  private readonly selectedChatIdSubject = new BehaviorSubject<string | null>(null);

  readonly requestedSelectedChatId$ = this.selectedChatIdSubject.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly chats$: Observable<IChat[]> = this.directChatService.getMyDirectChats$().pipe(
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.chats$');
      return of([] as IChat[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly items$: Observable<DirectChatListItem[]> = combineLatest([
    this.chats$,
    this.authSession.uid$,
  ]).pipe(
    map(([chats, currentUid]) =>
      (chats ?? []).map((chat) => this.toListItem(chat, currentUid))
    ),
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.items$');
      return of([] as DirectChatListItem[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedChatId$: Observable<string | null> = combineLatest([
    this.chats$,
    this.requestedSelectedChatId$,
  ]).pipe(
    map(([chats, requestedId]) => {
      if (!requestedId) return null;

      const exists = (chats ?? []).some(
        (chat) => (chat?.id ?? '').trim() === requestedId
      );

      return exists ? requestedId : null;
    }),
    distinctUntilChanged(),
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.selectedChatId$');
      return of(null);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedChat$: Observable<IChat | null> = combineLatest([
    this.chats$,
    this.selectedChatId$,
  ]).pipe(
    map(([chats, selectedChatId]) => {
      if (!selectedChatId) return null;

      return (
        (chats ?? []).find(
          (chat) => (chat?.id ?? '').trim() === selectedChatId
        ) ?? null
      );
    }),
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.selectedChat$');
      return of(null);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedChatCanOpen$: Observable<boolean> = this.selectedChat$.pipe(
    map((chat) => !!chat),
    distinctUntilChanged(),
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.selectedChatCanOpen$');
      return of(false);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$: Observable<DirectChatListState> = combineLatest([
    this.items$,
    this.selectedChatId$,
  ]).pipe(
    map(([items, selectedChatId]) => ({
      items,
      selectedChatId,
      loading: false,
      loaded: true,
      errorMessage: null,
    })),
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.state$');
      return of({
        items: [],
        selectedChatId: null,
        loading: false,
        loaded: false,
        errorMessage: 'Não foi possível carregar os chats diretos.',
      } as DirectChatListState);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly directChatService: DirectChatService,
    private readonly authSession: AuthSessionService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  selectChat(chatId: string | null | undefined): void {
    const safeChatId = (chatId ?? '').trim() || null;

    this.selectedChatIdSubject.next(safeChatId);

    if (!safeChatId) return;

    try {
      this.directChatService.refreshParticipantDetailsIfNeeded(safeChatId);
    } catch (error) {
      this.reportSilent(
        error,
        'DirectChatFacade.selectChat.refreshParticipantDetailsIfNeeded'
      );
    }
  }

  /**
   * Novo comando:
   * recebe uid do outro perfil,
   * resolve/cria a conversa e seleciona o chat real.
   */
  openChatWithUser$(otherUserUid: string): Observable<string | null> {
    return this.directChatService.ensureDirectChatIdWithUser$(otherUserUid).pipe(
      tap((chatId) => {
        if (chatId) {
          this.selectChat(chatId);
        }
      }),
      catchError((error) => {
        this.reportSilent(error, 'DirectChatFacade.openChatWithUser$');
        return of(null);
      }),
      take(1)
    );
  }

  clearSelection(): void {
    this.selectedChatIdSubject.next(null);
  }

  private toListItem(chat: IChat, currentUid: string | null): DirectChatListItem {
    const safeCurrentUid = (currentUid ?? '').trim() || null;

    const otherParticipantUid =
      (chat?.participants ?? []).find((uid: string) => uid !== safeCurrentUid) ?? null;

    const lastMessagePreview = (chat?.lastMessage?.content ?? '').trim() || null;

    return {
      id: (chat?.id ?? '').trim(),
      chat,
      otherParticipantUid,
      otherParticipantNickname: chat?.otherParticipantDetails?.nickname?.trim() || null,
      otherParticipantPhotoURL: (chat?.otherParticipantDetails as any)?.photoURL ?? null,
      unreadCount: Number((chat as any)?.unreadCount ?? 0),
      lastMessagePreview,
      lastMessageAt: chat?.lastMessage?.timestamp?.toDate?.()?.getTime?.() ?? null,
      canOpen: !!chat?.id,
      availability: 'open',
      blockedReason: null,
      compatibilityLabel: null,
      isDesiredProfileMatch: null,
    };
  }

  private reportSilent(error: unknown, context: string): void {
    try {
      const err =
        error instanceof Error
          ? error
          : new Error('[DirectChatFacade] operation failed');

      (err as any).original = error;
      (err as any).context = context;
      (err as any).skipUserNotification = true;
      (err as any).silent = true;

      this.globalErrorHandler.handleError(err);
    } catch {
      // noop
    }
  }
}
