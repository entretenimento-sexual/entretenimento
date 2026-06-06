// src/app/chat-module/chat-module-layout/chat-module-layout.component.ts
// ============================================================================
// CHAT MODULE LAYOUT COMPONENT
//
// Responsabilidades desta versão:
// - manter o shell principal do módulo de chat;
// - receber seleção de conversa direta ou sala;
// - aceitar deep-link por query params: openChatId / withUser;
// - enviar mensagens para chat direto pela DirectThreadFacade;
// - manter envio de salas no fluxo legado RoomMessagesService;
// - usar AuthSessionService como fonte canônica da sessão;
// - usar CurrentUserStoreService como fonte canônica do perfil do app;
// - manter seleção canônica sincronizada com DirectChatFacade;
// - bloquear preventivamente envio direto sem conexão aceita;
// - manter feedback de envio acessível e claro;
// - usar PrivacyDebugLoggerService para logs de debug.
//
// Segurança:
// - o frontend NÃO é autoridade para permissão;
// - Cloud Functions continuam sendo a barreira real;
// - o bloqueio local é apenas UX preventiva;
// - envio direto continua passando pelo backend;
// - sala permanece compatível, sem contaminar o eixo de chat direto.
//
// Supressões explícitas mantidas:
// 1) não usa route userId como chatId;
// 2) não reaplica deep-link indefinidamente;
// 3) não mantém sidebar interna duplicando perfil/salas fora da lista;
// 4) não usa ngSrc no avatar do header para evitar warning de proporção;
// 5) não migra rooms nesta etapa.
// ============================================================================
import {
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';
import { Timestamp } from '@firebase/firestore';

import {
  Observable,
  combineLatest,
  of,
  throwError,
} from 'rxjs';

import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import {
  takeUntilDestroyed,
  toObservable,
} from '@angular/core/rxjs-interop';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';

import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';
import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from 'src/app/messaging/direct-chat/application/direct-thread.facade';

type ChatSelectionType = 'room' | 'chat';

type ChatSelectionEvent = {
  id: string;
  type: ChatSelectionType;
  peerUid?: string | null;
  peerName?: string | null;
  peerPhotoURL?: string | null;
};

interface ChatDeepLinkPayload {
  openChatId?: string;
  withUser?: string;
}

@Component({
  selector: 'app-chat-module-layout',
  templateUrl: './chat-module-layout.component.html',
  styleUrls: ['./chat-module-layout.component.css'],
  standalone: false,
})
export class ChatModuleLayoutComponent implements OnInit {
  // ---------------------------------------------------------------------------
  // Injects
  // ---------------------------------------------------------------------------
  private readonly destroyRef = inject(DestroyRef);

  private readonly authSession = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly accessControl = inject(AccessControlService);

  private readonly directChatService = inject(DirectChatService);
  private readonly directChatFacade = inject(DirectChatFacade);
  private readonly directThreadFacade = inject(DirectThreadFacade);

  private readonly roomMessages = inject(RoomMessagesService);
  private readonly firestoreUserQuery = inject(FirestoreUserQueryService);
  private readonly friendshipService = inject(FriendshipService);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  // ---------------------------------------------------------------------------
  // Internal reactive state
  // ---------------------------------------------------------------------------

  /**
   * Evita reaplicação infinita do mesmo deep-link.
   * É resetado quando a URL fica limpa.
   */
  private appliedDeepLinkKey: string | null = null;

  private readonly selectedChatIdSignal = signal<string | null>(null);
  private readonly selectedTypeSignal = signal<ChatSelectionType | null>(null);
  private readonly activeChatPeerUidSignal = signal<string | null>(null);

  readonly isSendingMessage = signal(false);

  /**
   * Motivo de bloqueio visual/preventivo no compose.
   * O backend continua sendo autoridade real.
   */
  readonly directMessageBlockedReason = signal<string | null>(null);

  /**
   * Snapshot reativo para o template bloquear o botão sem depender apenas do async pipe.
   */
  readonly canSendCurrentMessage = signal(false);

  private readonly sendStatusMessageSignal = signal(
    'Selecione uma conversa para enviar mensagem.'
  );

  private readonly selectedChatId$ = toObservable(this.selectedChatIdSignal).pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly selectedType$ = toObservable(this.selectedTypeSignal).pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly activeChatPeerUid$ = toObservable(this.activeChatPeerUidSignal).pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ---------------------------------------------------------------------------
  // Public state consumed by template
  // ---------------------------------------------------------------------------

  messageContent = '';

  readonly maxMessageLength = 1000;

get normalizedMessageContent(): string {
  return String(this.messageContent ?? '');
}

get trimmedMessageContent(): string {
  return this.normalizedMessageContent.trim();
}

get messageLength(): number {
  return this.normalizedMessageContent.length;
}

get messageLengthLabel(): string {
  return `${this.messageLength}/${this.maxMessageLength}`;
}

get isMessageTooLong(): boolean {
  return this.messageLength > this.maxMessageLength;
}

get canSubmitMessage(): boolean {
  return (
    !!this.trimmedMessageContent &&
    !this.isMessageTooLong &&
    !!this.selectedChatId &&
    !!this.selectedType &&
    !this.isSendingMessage() &&
    this.canSendCurrentMessage()
  );
}

get isNearMessageLimit(): boolean {
  return this.messageLength >= Math.floor(this.maxMessageLength * 0.85);
}

get shouldShowComposerHelp(): boolean {
  return (
    this.isMessageTooLong ||
    this.isNearMessageLimit ||
    !!this.directMessageBlockedReason()
  );
}
  /**
   * Mantidas como propriedades públicas para não quebrar o template atual.
   * Internamente, a fonte reativa é selectedChatIdSignal/selectedTypeSignal.
   */
  selectedChatId: string | undefined;
  selectedType: ChatSelectionType | undefined;

  /**
   * userId da rota é apenas contexto.
   * Não deve ser tratado como chatId.
   */
  userId: string | undefined;

  /**
   * Snapshot útil do UID autenticado atual.
   */
  currentUserUid: string | null = null;

  /**
   * Contexto do contato ativo para o header.
   */
  activeChatPeerUid: string | null = null;
  activeChatPeerName: string | null = null;
  activeChatPeerPhotoURL: string | null = null;

  // ---------------------------------------------------------------------------
  // Core streams
  // ---------------------------------------------------------------------------

  readonly currentUid$: Observable<string | null> = this.authSession.uid$.pipe(
    map((uid) => (uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Perfil atual do app.
   * - undefined no store vira null para simplificar template e consumo local.
   */
  readonly usuario$: Observable<IUserDados | null> =
    this.currentUserStore.user$.pipe(
      map((user) => user ?? null),
      distinctUntilChanged((a, b) => this.sameUser(a, b)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Estado mínimo para composição/envio.
   * Não substitui regra de domínio do backend.
   */
  readonly canCompose$: Observable<boolean> = combineLatest([
    this.currentUid$,
    this.accessControl.canListenRealtime$,
  ]).pipe(
    map(([uid, canListen]) => !!uid && canListen === true),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Resolve o UID do outro participante:
   * - primeiro pelo contexto visual ativo;
   * - depois pela conversa selecionada na DirectChatFacade.
   */
  readonly selectedDirectPeerUid$: Observable<string | null> = combineLatest([
    this.directChatFacade.selectedChat$,
    this.currentUid$,
    this.activeChatPeerUid$,
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

  /**
   * Hint preventivo de conexão aceita.
   *
   * Importante:
   * - isto NÃO é autoridade de segurança;
   * - serve para não deixar o usuário clicar em "Enviar" quando a UI já sabe
   *   que não existe conexão aceita;
   * - a Cloud Function sendDirectMessage continua validando novamente.
   */
  readonly hasAcceptedDirectConnection$: Observable<boolean> = combineLatest([
    this.currentUid$,
    this.selectedDirectPeerUid$,
  ]).pipe(
    switchMap(([currentUid, peerUid]) => {
      const safeCurrentUid = (currentUid ?? '').trim();
      const safePeerUid = (peerUid ?? '').trim();

      if (!safeCurrentUid || !safePeerUid) {
        return of(false);
      }

      return this.friendshipService.watchFriends(safeCurrentUid).pipe(
        map((friends: Friend[]) =>
          (friends ?? []).some(
            (friend) => String(friend?.friendUid ?? '').trim() === safePeerUid
          )
        ),
        catchError((error) => {
          this.reportError(
            'Não foi possível verificar a conexão com este perfil.',
            error,
            {
              op: 'hasAcceptedDirectConnection$',
              currentUid: safeCurrentUid,
              peerUid: safePeerUid,
            },
            false
          );

          return of(false);
        })
      );
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Permissão visual de envio no compose.
   *
   * Para chat direto:
   * - exige sessão;
   * - exige gate de realtime;
   * - exige DirectThreadFacade.canSend$;
   * - exige conexão aceita no hint local.
   *
   * Para room:
   * - mantém regra leve de compatibilidade: sessão + realtime.
   */
  readonly canSendCurrentMessage$: Observable<boolean> = combineLatest([
    this.canCompose$,
    this.directThreadFacade.canSend$,
    this.selectedType$,
    this.hasAcceptedDirectConnection$,
  ]).pipe(
    map(([canCompose, canSendDirect, selectedType, hasAcceptedConnection]) => {
      if (selectedType === 'room') {
        return canCompose;
      }

      if (selectedType === 'chat') {
        return canCompose && canSendDirect && hasAcceptedConnection;
      }

      return false;
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  ngOnInit(): void {
    this.observeRouteUserId();
    this.observeAuthenticatedUser();
    this.observeChatDeepLink();
    this.observeSelectedDirectPeerFallback();
    this.observeComposePermissions();
  }

  // ---------------------------------------------------------------------------
  // Template getters
  // ---------------------------------------------------------------------------

  get activeDirectChatTitle(): string {
    return this.activeChatPeerName?.trim() || 'Conversa direta';
  }

  get activeDirectChatSubtitle(): string {
    return this.activeChatPeerUid
      ? 'Canal privado entre dois perfis'
      : 'Canal principal entre dois perfis';
  }

  get sendStatusMessage(): string {
    if (this.isSendingMessage()) {
      return 'Enviando mensagem...';
    }

    const blockedReason = this.directMessageBlockedReason();
    if (blockedReason) {
      return blockedReason;
    }

    return this.sendStatusMessageSignal();
  }

  // ---------------------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------------------

  private applySelection(
    chatId: string | null | undefined,
    type: ChatSelectionType | null | undefined
  ): void {
    const safeChatId = (chatId ?? '').trim() || null;
    const safeType = type ?? null;

    this.selectedChatId = safeChatId ?? undefined;
    this.selectedType = safeType ?? undefined;

    this.selectedChatIdSignal.set(safeChatId);
    this.selectedTypeSignal.set(safeType);
  }

  private clearActiveChatPeer(): void {
    this.activeChatPeerUid = null;
    this.activeChatPeerName = null;
    this.activeChatPeerPhotoURL = null;
    this.activeChatPeerUidSignal.set(null);
  }

  private applyActiveChatPeer(meta: {
    peerUid?: string | null;
    peerName?: string | null;
    peerPhotoURL?: string | null;
  } | null | undefined): void {
    const peerUid = (meta?.peerUid ?? '').trim() || null;

    this.activeChatPeerUid = peerUid;
    this.activeChatPeerName = (meta?.peerName ?? '').trim() || null;
    this.activeChatPeerPhotoURL = (meta?.peerPhotoURL ?? '').trim() || null;

    this.activeChatPeerUidSignal.set(peerUid);
  }

  private resolveActiveChatPeerFromUid(peerUid: string): void {
    const safePeerUid = (peerUid ?? '').trim();

    if (!safePeerUid) {
      this.clearActiveChatPeer();
      return;
    }

    this.activeChatPeerUid = safePeerUid;
    this.activeChatPeerUidSignal.set(safePeerUid);

    this.firestoreUserQuery.getPublicUserById$(safePeerUid)
      .pipe(
        take(1),
        catchError((error) => {
          this.reportError(
            'Não foi possível carregar o contexto da conversa.',
            error,
            {
              op: 'resolveActiveChatPeerFromUid',
              peerUid: safePeerUid,
            },
            false
          );

          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((user) => {
        this.activeChatPeerName =
          user?.nickname?.trim() ||
          this.activeChatPeerName ||
          'Conversa direta';

        this.activeChatPeerPhotoURL =
          user?.photoURL?.trim() ||
          this.activeChatPeerPhotoURL ||
          null;
      });
  }

  // ---------------------------------------------------------------------------
  // Route/session observers
  // ---------------------------------------------------------------------------

  private observeRouteUserId(): void {
    this.route.paramMap
      .pipe(
        map((params) => (params.get('userId') ?? '').trim() || undefined),
        distinctUntilChanged(),
        tap((routeUserId) => {
          this.userId = routeUserId;
          this.dbg('observeRouteUserId()', { userId: this.userId });
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao processar parâmetros da rota.',
            error,
            { op: 'observeRouteUserId' },
            false
          );

          this.userId = undefined;
          return of(undefined);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private observeAuthenticatedUser(): void {
    this.currentUid$
      .pipe(
        tap((uid) => {
          this.currentUserUid = uid;

          if (!this.currentUserUid) {
            this.messageContent = '';
            this.clearActiveChatPeer();
            this.applySelection(null, null);
            this.directChatFacade.clearSelection();
          }

          this.dbg('observeAuthenticatedUser.uid$', {
            hasUid: !!this.currentUserUid,
          });
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao obter sessão do usuário.',
            error,
            { op: 'observeAuthenticatedUser.uid' },
            false
          );

          this.currentUserUid = null;
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.usuario$
      .pipe(
        tap((user) => {
          this.dbg('observeAuthenticatedUser.usuario$', {
            hasUid: !!user?.uid,
            hasNickname: !!user?.nickname,
            profileCompleted: user?.profileCompleted ?? null,
          });
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao observar usuário atual.',
            error,
            { op: 'observeAuthenticatedUser.user' },
            false
          );

          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ---------------------------------------------------------------------------
  // Deep-link
  // ---------------------------------------------------------------------------

  private observeChatDeepLink(): void {
    const queryDeepLink$ = this.route.queryParamMap.pipe(
      map((query): ChatDeepLinkPayload => ({
        openChatId: (query.get('openChatId') ?? '').trim() || undefined,
        withUser: (query.get('withUser') ?? '').trim() || undefined,
      })),
      distinctUntilChanged(
        (a, b) =>
          a.openChatId === b.openChatId &&
          a.withUser === b.withUser
      ),
      tap((payload) => {
        if (!payload.openChatId && !payload.withUser) {
          this.appliedDeepLinkKey = null;
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    combineLatest([
      this.currentUid$,
      queryDeepLink$,
    ])
      .pipe(
        filter(([uid, payload]) => {
          return !!uid && (!!payload.openChatId || !!payload.withUser);
        }),
        switchMap(([uid, payload]) => {
          const safeUid = (uid ?? '').trim();

          const key = `${safeUid}:${payload.openChatId ?? ''}:${payload.withUser ?? ''}`;

          if (this.appliedDeepLinkKey === key) {
            this.dbg('observeChatDeepLink() -> skip repeated deep-link', {
              key,
            });

            return of(null);
          }

          this.appliedDeepLinkKey = key;

          if (payload.openChatId) {
            return of({
              chatId: payload.openChatId,
              withUser: payload.withUser,
            });
          }

          if (!payload.withUser) {
            return of(null);
          }

          if (payload.withUser === safeUid) {
            return throwError(
              () => new Error('withUser inválido para chat direto.')
            );
          }

          return this.directChatService
            .ensureDirectChatIdWithUser$(payload.withUser)
            .pipe(
              map((chatId) =>
                chatId
                  ? {
                      chatId,
                      withUser: payload.withUser,
                    }
                  : null
              )
            );
        }),
        tap((resolved) => {
          if (!resolved?.chatId) {
            this.consumeDeepLinkQueryParams();
            return;
          }

          this.applySelection(resolved.chatId, 'chat');
          this.directChatFacade.selectChat(resolved.chatId);
          this.directMessageBlockedReason.set(null);

          if (resolved.withUser) {
            this.resolveActiveChatPeerFromUid(resolved.withUser);
          } else {
            this.clearActiveChatPeer();
          }

          this.dbg('observeChatDeepLink() -> selected chat', {
            selectedChatId: this.selectedChatId,
            selectedType: this.selectedType,
            hasPeerUid: !!resolved.withUser,
          });

          this.consumeDeepLinkQueryParams();
        }),
        catchError((error) => {
          this.reportError(
            'Não foi possível abrir a conversa automaticamente.',
            error,
            { op: 'observeChatDeepLink' },
            true
          );

          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private consumeDeepLinkQueryParams(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        openChatId: null,
        withUser: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    }).catch((error) => {
      this.reportError(
        'A conversa foi aberta, mas a limpeza da URL falhou.',
        error,
        { op: 'consumeDeepLinkQueryParams' },
        false
      );
    });
  }

  /**
   * Em deep-link por openChatId, pode não haver withUser.
   * Neste caso, a conversa selecionada na facade permite descobrir o outro UID.
   */
  private observeSelectedDirectPeerFallback(): void {
    combineLatest([
      this.selectedType$,
      this.selectedDirectPeerUid$,
    ])
      .pipe(
        tap(([selectedType, peerUid]) => {
          const safePeerUid = (peerUid ?? '').trim();

          if (selectedType !== 'chat' || !safePeerUid) {
            return;
          }

          if (
            this.activeChatPeerUid === safePeerUid &&
            this.activeChatPeerName
          ) {
            return;
          }

          this.resolveActiveChatPeerFromUid(safePeerUid);
        }),
        catchError((error) => {
          this.reportError(
            'Não foi possível sincronizar o participante da conversa.',
            error,
            { op: 'observeSelectedDirectPeerFallback' },
            false
          );

          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /**
   * Mantém sinais locais sincronizados para template e clique rápido.
   */
  private observeComposePermissions(): void {
    combineLatest([
      this.canSendCurrentMessage$,
      this.canCompose$,
      this.directThreadFacade.canSend$,
      this.selectedType$,
      this.hasAcceptedDirectConnection$,
      this.selectedChatId$,
    ])
      .pipe(
        tap(([
          canSendCurrentMessage,
          canCompose,
          canSendDirect,
          selectedType,
          hasAcceptedConnection,
          selectedChatId,
        ]) => {
          this.canSendCurrentMessage.set(canSendCurrentMessage);

          if (!selectedChatId || !selectedType) {
            this.sendStatusMessageSignal.set(
              'Selecione uma conversa para enviar mensagem.'
            );
            return;
          }

          if (!canCompose) {
            this.sendStatusMessageSignal.set(
              'Seu perfil ainda não pode enviar mensagens neste momento.'
            );
            return;
          }

          if (selectedType === 'room') {
            this.sendStatusMessageSignal.set(
              'Sala ativa para envio de mensagens.'
            );
            return;
          }

          if (!hasAcceptedConnection) {
            this.sendStatusMessageSignal.set(
              'Vocês precisam estar conectados para trocar mensagens.'
            );
            return;
          }

          if (!canSendDirect) {
            this.sendStatusMessageSignal.set(
              'Esta conversa direta não está disponível para envio agora.'
            );
            return;
          }

          this.sendStatusMessageSignal.set(
            'Conversa direta liberada para envio.'
          );
        }),
        catchError((error) => {
          this.reportError(
            'Não foi possível atualizar o estado de envio.',
            error,
            { op: 'observeComposePermissions' },
            false
          );

          this.canSendCurrentMessage.set(false);
          this.sendStatusMessageSignal.set(
            'Não foi possível validar o envio agora.'
          );

          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ---------------------------------------------------------------------------
  // UI events
  // ---------------------------------------------------------------------------

  onChatSelected(event: ChatSelectionEvent): void {
    const safeId = (event?.id ?? '').trim();
    const safeType = event?.type ?? undefined;

    if (!safeId || !safeType) {
      this.dbg('onChatSelected() ignorado', {
        hasEvent: !!event,
      });

      return;
    }

    this.applySelection(safeId, safeType);
    this.directMessageBlockedReason.set(null);

    if (safeType === 'chat') {
      this.directChatFacade.selectChat(safeId);

      this.applyActiveChatPeer({
        peerUid: event.peerUid,
        peerName: event.peerName,
        peerPhotoURL: event.peerPhotoURL,
      });

      if (event.peerUid && !event.peerName) {
        this.resolveActiveChatPeerFromUid(event.peerUid);
      }
    } else {
      this.directChatFacade.clearSelection();
      this.clearActiveChatPeer();
    }

    this.dbg('onChatSelected()', {
      selectedChatId: this.selectedChatId,
      selectedType: this.selectedType,
      hasActivePeerUid: !!this.activeChatPeerUid,
    });
  }

  onRoomSelected(roomId: string): void {
    const safeRoomId = (roomId ?? '').trim();
    if (!safeRoomId) {
      return;
    }

    this.applySelection(safeRoomId, 'room');
    this.directMessageBlockedReason.set(null);
    this.directChatFacade.clearSelection();
    this.clearActiveChatPeer();

    this.dbg('onRoomSelected()', {
      selectedChatId: this.selectedChatId,
      selectedType: this.selectedType,
    });
  }

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------

  sendMessage(): void {
    if (this.isSendingMessage()) {
      return;
    }

const content = this.trimmedMessageContent;

if (!content) {
  return;
}

if (this.isMessageTooLong) {
  this.errorNotifier.showWarning(
    `A mensagem deve ter no máximo ${this.maxMessageLength} caracteres.`
  );
  return;
}

    const selectedChatId = (this.selectedChatId ?? '').trim();
    const selectedType = this.selectedType;

    if (!selectedChatId || !selectedType) {
      this.errorNotifier.showWarning(
        'Selecione uma conversa antes de enviar a mensagem.'
      );
      return;
    }

    if (!this.canSendCurrentMessage()) {
      const message = this.sendStatusMessage;
      this.errorNotifier.showWarning(message);
      return;
    }

    this.isSendingMessage.set(true);

    const send$ =
      selectedType === 'chat'
        ? this.sendDirectMessage$(selectedChatId, content)
        : this.sendRoomMessage$(selectedChatId, content);

    send$
      .pipe(
        catchError((error) => {
          this.reportError(
            'Erro ao enviar mensagem.',
            error,
            {
              op: 'sendMessage',
              selectedChatId,
              selectedType,
            },
            true
          );

          return of(null);
        }),
        finalize(() => {
          this.isSendingMessage.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private sendDirectMessage$(
    selectedChatId: string,
    content: string
  ): Observable<string | null> {
    this.directChatFacade.selectChat(selectedChatId);

    return this.directThreadFacade.sendMessage$(content).pipe(
      tap((messageId) => {
        if (!messageId) {
          return;
        }

        this.messageContent = '';
        this.directMessageBlockedReason.set(null);

        this.dbg('sendMessage() -> direct facade ok', {
          selectedChatId,
          messageId,
        });
      }),
      catchError((error) => {
        const blockedMessage = this.resolveDirectMessageBlockMessage(error);

        if (blockedMessage) {
          this.directMessageBlockedReason.set(blockedMessage);
          this.errorNotifier.showWarning(blockedMessage);
        }

        return of(null);
      })
    );
  }

  onComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') {
    return;
  }

  if (event.shiftKey) {
    return;
  }

  event.preventDefault();

  if (!this.canSubmitMessage) {
    return;
  }

  this.sendMessage();
}

  private sendRoomMessage$(
    selectedChatId: string,
    content: string
  ): Observable<unknown> {
    return this.currentUserStore.user$.pipe(
      filter((user) => user !== undefined),
      take(1),
      switchMap((currentUser) => {
        const senderId =
          currentUser?.uid ??
          this.currentUserUid ??
          this.authSession.currentAuthUser?.uid ??
          null;

        const nickname =
          currentUser?.nickname?.trim() ||
          this.authSession.currentAuthUser?.displayName?.trim() ||
          'Usuário';

        if (!senderId) {
          this.errorNotifier.showError('Erro: usuário não autenticado.');
          return of(null);
        }

        const message: Message = {
          content,
          senderId,
          nickname,
          timestamp: Timestamp.now(),
        };

        return this.roomMessages
          .sendMessageToRoom$(selectedChatId, message)
          .pipe(
            tap(() => {
              this.messageContent = '';

              this.dbg('sendMessage() -> room ok', {
                selectedChatId,
                hasSenderId: !!senderId,
              });
            })
          );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Error helpers
  // ---------------------------------------------------------------------------

  private resolveDirectMessageBlockMessage(error: unknown): string | null {
    const code = String((error as { code?: unknown } | null)?.code ?? '')
      .toLowerCase();

    const message = String((error as { message?: unknown } | null)?.message ?? '')
      .toLowerCase();

    if (
      code.includes('failed-precondition') &&
      message.includes('conexão precisa estar aceita')
    ) {
      return 'Vocês precisam estar conectados para trocar mensagens.';
    }

    if (
      code.includes('failed-precondition') &&
      message.includes('verifique seu e-mail')
    ) {
      return 'Verifique seu e-mail antes de enviar mensagens.';
    }

    if (
      code.includes('failed-precondition') &&
      message.includes('complete seu perfil')
    ) {
      return 'Complete seu perfil antes de enviar mensagens.';
    }

    if (code.includes('permission-denied')) {
      return 'Esta conversa não está disponível para envio.';
    }

    return null;
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>,
    notifyUser = true
  ): void {
    if (notifyUser) {
      try {
        this.errorNotifier.showError(userMessage);
      } catch {
        // noop
      }
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);

      (err as any).original = error;
      (err as any).context = {
        scope: 'ChatModuleLayoutComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(err);
    } catch {
      // noop
    }
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('chat', `ChatModuleLayout: ${message}`, extra);
  }

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------

  private sameUser(a: IUserDados | null, b: IUserDados | null): boolean {
    return (
      (a?.uid ?? null) === (b?.uid ?? null) &&
      (a?.nickname ?? null) === (b?.nickname ?? null) &&
      (a?.photoURL ?? null) === (b?.photoURL ?? null) &&
      (a?.role ?? null) === (b?.role ?? null) &&
      (a?.profileCompleted ?? null) === (b?.profileCompleted ?? null)
    );
  }
} // Linha 1173, final do ChatModuleLayoutComponent que está gigantesco e merece um refactor futuro para dividir responsabilidades.