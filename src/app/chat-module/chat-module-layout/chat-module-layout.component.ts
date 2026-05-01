// src/app/chat-module/chat-module-layout/chat-module-layout.component.ts
// Layout principal do módulo de chat.
//
// Responsabilidades desta versão:
// - manter o shell do módulo de mensagens
// - receber a seleção de conversa/sala
// - aceitar deep-link de abertura de conversa via query params
// - enviar mensagens para chat direto ou sala
// - usar AuthSessionService como fonte canônica da sessão
// - usar CurrentUserStoreService como fonte canônica do perfil do app
// - manter rooms como compat, sem deixar rooms dominarem a UI
//
// Ajustes desta versão:
// - mantém deep-link openChatId / withUser
// - sincroniza seleção do container com a lista lateral
// - adiciona contexto real do contato ativo no header da thread
// - limpa a URL após consumir o deep-link
//
// Supressões explícitas:
// 1) continua removido o uso de route userId como chatId
// 2) não reaplica deep-link indefinidamente
// 3) não mantém sidebar interna duplicando perfil/salas fora da lista
// 4) não usa ngSrc no avatar do header do chat para evitar warning de proporção

import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Timestamp } from '@firebase/firestore';

import { Observable, combineLatest, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';

import { environment } from 'src/environments/environment';

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
  private readonly destroyRef = inject(DestroyRef);
  private readonly debug = !environment.production;

  /**
   * Evita reaplicação infinita do mesmo deep-link.
   * É resetado quando a URL fica limpa.
   */
  private appliedDeepLinkKey: string | null = null;

  /**
   * Perfil atual do app.
   * - undefined no store vira null aqui para simplificar template e consumo local.
   */
  readonly usuario$: Observable<IUserDados | null> = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    distinctUntilChanged((a, b) => this.sameUser(a, b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Estado mínimo para composição/envio.
   */
  readonly canCompose$: Observable<boolean> = combineLatest([
    this.authSession.uid$,
    this.accessControl.canListenRealtime$,
  ]).pipe(
    map(([uid, canListen]) => !!uid && canListen === true),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  messageContent = '';

  /**
   * ID real da conversa/sala selecionada.
   */
  selectedChatId: string | undefined;

  /**
   * Tipo real da seleção atual.
   */
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
   * Contexto do contato ativo para header maduro.
   */
  activeChatPeerUid: string | null = null;
  activeChatPeerName: string | null = null;
  activeChatPeerPhotoURL: string | null = null;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly accessControl: AccessControlService,
    private readonly chatService: ChatService,
    private readonly roomMessages: RoomMessagesService,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  ngOnInit(): void {
    this.observeRouteUserId();
    this.observeAuthenticatedUser();
    this.observeChatDeepLink();
  }

  get activeDirectChatTitle(): string {
    return this.activeChatPeerName?.trim() || 'Conversa direta';
  }

  get activeDirectChatSubtitle(): string {
    return this.activeChatPeerUid
      ? 'Canal privado entre dois perfis'
      : 'Canal principal entre dois perfis';
  }

  private clearActiveChatPeer(): void {
    this.activeChatPeerUid = null;
    this.activeChatPeerName = null;
    this.activeChatPeerPhotoURL = null;
  }

  private applyActiveChatPeer(meta: {
    peerUid?: string | null;
    peerName?: string | null;
    peerPhotoURL?: string | null;
  } | null | undefined): void {
    this.activeChatPeerUid = (meta?.peerUid ?? '').trim() || null;
    this.activeChatPeerName = (meta?.peerName ?? '').trim() || null;
    this.activeChatPeerPhotoURL = (meta?.peerPhotoURL ?? '').trim() || null;
  }

  private resolveActiveChatPeerFromUid(peerUid: string): void {
    const safePeerUid = (peerUid ?? '').trim();
    if (!safePeerUid) {
      this.clearActiveChatPeer();
      return;
    }

    this.activeChatPeerUid = safePeerUid;

    this.firestoreUserQuery.getPublicUserById$(safePeerUid)
      .pipe(
        take(1),
        catchError((error) => {
          this.reportError(
            'Não foi possível carregar o contexto da conversa.',
            error,
            { op: 'resolveActiveChatPeerFromUid', peerUid: safePeerUid },
            false
          );
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((user) => {
        this.activeChatPeerName = user?.nickname?.trim() || this.activeChatPeerName || 'Conversa direta';
        this.activeChatPeerPhotoURL = user?.photoURL?.trim() || this.activeChatPeerPhotoURL || null;
      });
  }

  /**
   * Mantém apenas o contexto de rota.
   */
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

  /**
   * Observa a sessão e o perfil atual.
   */
  private observeAuthenticatedUser(): void {
    this.authSession.uid$
      .pipe(
        distinctUntilChanged(),
        tap((uid) => {
          this.currentUserUid = (uid ?? '').trim() || null;

          if (!this.currentUserUid) {
            this.messageContent = '';
            this.clearActiveChatPeer();
          }

          this.dbg('observeAuthenticatedUser.uid$', {
            uid: this.currentUserUid,
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
            uid: user?.uid ?? null,
            nickname: user?.nickname ?? null,
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

  /**
   * Deep-link real do módulo de chat.
   */
  private observeChatDeepLink(): void {
    const queryDeepLink$ = this.route.queryParamMap.pipe(
      map((query): ChatDeepLinkPayload => ({
        openChatId: (query.get('openChatId') ?? '').trim() || undefined,
        withUser: (query.get('withUser') ?? '').trim() || undefined,
      })),
      distinctUntilChanged((a, b) =>
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
      this.authSession.uid$.pipe(
        map((uid) => (uid ?? '').trim() || null),
        distinctUntilChanged()
      ),
      queryDeepLink$,
    ])
      .pipe(
        filter(([uid, payload]) => {
          return !!uid && (!!payload.openChatId || !!payload.withUser);
        }),
        switchMap(([uid, payload]) => {
          const safeUid = uid!.trim();
          const key = `${safeUid}:${payload.openChatId ?? ''}:${payload.withUser ?? ''}`;

          if (this.appliedDeepLinkKey === key) {
            this.dbg('observeChatDeepLink() -> skip repeated deep-link', { key });
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
            return throwError(() => new Error('withUser inválido para chat direto.'));
          }

          return this.chatService.getOrCreateChatId([safeUid, payload.withUser]).pipe(
            map((chatId) => ({
              chatId,
              withUser: payload.withUser,
            }))
          );
        }),
        tap((resolved) => {
          if (!resolved?.chatId) {
            return;
          }

          this.selectedChatId = resolved.chatId;
          this.selectedType = 'chat';

          if (resolved.withUser) {
            this.resolveActiveChatPeerFromUid(resolved.withUser);
          } else {
            this.clearActiveChatPeer();
          }

          this.chatService.refreshParticipantDetailsIfNeeded(resolved.chatId);

          this.dbg('observeChatDeepLink() -> selected chat', {
            selectedChatId: this.selectedChatId,
            selectedType: this.selectedType,
            withUser: resolved.withUser ?? null,
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

  /**
   * Remove os parâmetros de deep-link depois de aplicar a seleção.
   */
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
   * Seleção vinda da lista principal de chats.
   */
  onChatSelected(event: ChatSelectionEvent): void {
    const safeId = (event?.id ?? '').trim();
    const safeType = event?.type ?? undefined;

    if (!safeId || !safeType) {
      this.dbg('onChatSelected() ignorado', { event });
      return;
    }

    this.selectedChatId = safeId;
    this.selectedType = safeType;

    if (safeType === 'chat') {
      this.applyActiveChatPeer({
        peerUid: event.peerUid,
        peerName: event.peerName,
        peerPhotoURL: event.peerPhotoURL,
      });

      if (event.peerUid && !event.peerName) {
        this.resolveActiveChatPeerFromUid(event.peerUid);
      }
    } else {
      this.clearActiveChatPeer();
    }

    this.dbg('onChatSelected()', {
      selectedChatId: this.selectedChatId,
      selectedType: this.selectedType,
      activeChatPeerUid: this.activeChatPeerUid,
    });
  }

  /**
   * Compat explícito com o painel de salas.
   */
  onRoomSelected(roomId: string): void {
    const safeRoomId = (roomId ?? '').trim();
    if (!safeRoomId) return;

    this.selectedChatId = safeRoomId;
    this.selectedType = 'room';
    this.clearActiveChatPeer();

    this.dbg('onRoomSelected()', {
      selectedChatId: this.selectedChatId,
      selectedType: this.selectedType,
    });
  }

  /**
   * Envio principal de mensagem.
   */
  sendMessage(): void {
    const content = (this.messageContent ?? '').trim();

    if (!content) {
      return;
    }

    const selectedChatId = (this.selectedChatId ?? '').trim();
    const selectedType = this.selectedType;

    if (!selectedChatId || !selectedType) {
      this.errorNotifier.showWarning('Selecione uma conversa antes de enviar a mensagem.');
      return;
    }

    this.canCompose$
      .pipe(
        take(1),
        switchMap((canCompose) => {
          if (!canCompose) {
            this.errorNotifier.showWarning(
              'Seu perfil ainda não pode enviar mensagens neste momento.'
            );
            return of(null);
          }

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

              if (selectedType === 'chat') {
                return this.chatService.sendMessage(selectedChatId, message, senderId).pipe(
                  tap(() => {
                    this.messageContent = '';
                    this.dbg('sendMessage() -> chat ok', {
                      selectedChatId,
                      senderId,
                    });
                  })
                );
              }

              return this.roomMessages.sendMessageToRoom$(selectedChatId, message).pipe(
                tap(() => {
                  this.messageContent = '';
                  this.dbg('sendMessage() -> room ok', {
                    selectedChatId,
                    senderId,
                  });
                })
              );
            })
          );
        }),
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
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private sameUser(a: IUserDados | null, b: IUserDados | null): boolean {
    return (
      (a?.uid ?? null) === (b?.uid ?? null) &&
      (a?.nickname ?? null) === (b?.nickname ?? null) &&
      (a?.photoURL ?? null) === (b?.photoURL ?? null) &&
      (a?.role ?? null) === (b?.role ?? null) &&
      (a?.profileCompleted ?? null) === (b?.profileCompleted ?? null)
    );
  }

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[ChatModuleLayout] ${message}`, extra ?? '');
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
} // Linha 617