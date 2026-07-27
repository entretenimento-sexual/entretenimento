// src/app/messaging/direct-chat/application/direct-chat.facade.ts
// ============================================================================
// DIRECT CHAT FACADE
//
// Responsabilidade desta facade:
// - expor a lista reativa de chats diretos 1:1
// - manter a seleção atual do chat direto
// - resolver a abertura de chat por participant uid
// - derivar item selecionado / estado da lista
//
// Isolamento de sessão:
// - toda coleção é carregada em um escopo que transporta o UID proprietário;
// - cada troca de UID começa com lista vazia antes do novo listener;
// - a seleção registra o UID proprietário e não reaparece em outra sessão.
// ============================================================================
import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
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
import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

interface DirectChatSessionScope {
  uid: string | null;
  chats: IChat[];
}

interface DirectChatSelectionRequest {
  ownerUid: string | null;
  chatId: string | null;
}

@Injectable({ providedIn: 'root' })
export class DirectChatFacade {
  private readonly selectedChatRequestSubject =
    new BehaviorSubject<DirectChatSelectionRequest>({
      ownerUid: null,
      chatId: null,
    });

  private readonly sessionUid$: Observable<string | null> =
    this.authSession.uid$.pipe(
      map((uid) => String(uid ?? '').trim() || null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Escopo canônico da lista.
   *
   * `startWith([])` é intencional: na troca A -> B a UI limpa imediatamente a
   * projeção da conta A antes de qualquer snapshot inicial da conta B.
   */
  private readonly sessionChats$: Observable<DirectChatSessionScope> =
    this.sessionUid$.pipe(
      switchMap((uid) => {
        if (!uid) {
          return of({ uid: null, chats: [] } as DirectChatSessionScope);
        }

        return this.directChatService.getMyDirectChats$().pipe(
          map((chats) => ({
            uid,
            chats: Array.isArray(chats) ? chats : [],
          } as DirectChatSessionScope)),
          startWith({ uid, chats: [] } as DirectChatSessionScope),
          catchError((error) => {
            this.reportSilent(error, 'DirectChatFacade.sessionChats$');
            return of({ uid, chats: [] } as DirectChatSessionScope);
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly requestedSelectedChatId$ = combineLatest([
    this.selectedChatRequestSubject.asObservable(),
    this.sessionUid$,
  ]).pipe(
    map(([request, sessionUid]) => {
      if (!request.chatId || !sessionUid) return null;
      return request.ownerUid === sessionUid ? request.chatId : null;
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly chats$: Observable<IChat[]> = this.sessionChats$.pipe(
    map(({ chats }) => chats),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly items$: Observable<DirectChatListItem[]> = this.sessionChats$.pipe(
    switchMap(({ chats, uid }) => {
      if (!uid) {
        return of([] as DirectChatListItem[]);
      }

      const items = (chats ?? [])
        .map((chat) => this.toListItem(chat, uid))
        .filter((item) => !!item.id);

      return this.enrichListItemsWithPublicProfiles$(items);
    }),
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
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  selectChat(chatId: string | null | undefined): void {
    const safeChatId = String(chatId ?? '').trim() || null;
    const ownerUid = safeChatId ? this.getCurrentSessionUid() : null;

    this.selectedChatRequestSubject.next({
      ownerUid,
      chatId: safeChatId && ownerUid ? safeChatId : null,
    });
  }

  /**
   * Recebe UID do outro perfil, resolve/cria a conversa e seleciona o chat real.
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
    this.selectedChatRequestSubject.next({
      ownerUid: null,
      chatId: null,
    });
  }

  /**
   * Resolve somente informações públicas necessárias à apresentação da lista.
   *
   * Segurança:
   * - não consulta o documento privado /users do participante;
   * - não grava snapshot do perfil dentro do documento de chat;
   * - mantém fallback somente de leitura para conversas legadas já existentes.
   */
  private enrichListItemsWithPublicProfiles$(
    items: DirectChatListItem[]
  ): Observable<DirectChatListItem[]> {
    const participantUids = Array.from(
      new Set(
        items
          .map((item) => String(item.otherParticipantUid ?? '').trim())
          .filter((uid) => uid.length > 0)
      )
    );

    if (!participantUids.length) {
      return of(items);
    }

    return this.firestoreUserQuery.getUsersPublicMap$(participantUids).pipe(
      map((publicProfiles) =>
        items.map((item) => {
          const participantUid = String(
            item.otherParticipantUid ?? ''
          ).trim();

          const publicProfile = participantUid
            ? publicProfiles[participantUid]
            : undefined;

          return {
            ...item,
            otherParticipantNickname:
              String(publicProfile?.nickname ?? '').trim() || null,
            otherParticipantPhotoURL:
              String(publicProfile?.avatarUrl ?? '').trim() || null,
          };
        })
      ),
      catchError((error) => {
        this.reportSilent(
          error,
          'DirectChatFacade.enrichListItemsWithPublicProfiles$'
        );

        return of(items);
      })
    );
  }

  private toListItem(
    chat: IChat,
    currentUid: string | null
  ): DirectChatListItem {
    const safeCurrentUid = String(currentUid ?? '').trim() || null;

    const otherParticipantUid =
      (chat?.participants ?? []).find(
        (uid: string) => uid !== safeCurrentUid
      ) ?? null;

    const lastMessagePreview =
      (chat?.lastMessage?.content ?? '').trim() || null;

    return {
      id: (chat?.id ?? '').trim(),
      chat,
      otherParticipantUid,

      /**
       * Dados de apresentação serão preenchidos somente pela projeção
       * pública atualmente acessível em public_profiles.
       */
      otherParticipantNickname: null,
      otherParticipantPhotoURL: null,

      unreadCount: Number((chat as any)?.unreadCount ?? 0),
      lastMessagePreview,
      lastMessageAt:
        chat?.lastMessage?.timestamp?.toDate?.()?.getTime?.() ?? null,
      canOpen: !!chat?.id,
      availability: 'open',
      blockedReason: null,
      compatibilityLabel: null,
      isDesiredProfileMatch: null,
    };
  }

  private getCurrentSessionUid(): string | null {
    return String(this.authSession.currentAuthUser?.uid ?? '').trim() || null;
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
