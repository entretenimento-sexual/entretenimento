// src/app/chat-module/chat-module-layout/chat-module-layout.component.ts
// Layout principal do módulo de chat.
//
// Responsabilidades desta versão:
// - manter o shell do módulo de mensagens
// - receber a seleção de conversa/sala
// - enviar mensagens para chat direto ou sala
// - usar AuthSessionService como fonte canônica da sessão
// - usar CurrentUserStoreService como fonte canônica do perfil do app
// - manter compat com room interaction, mas sem deixar rooms mandarem na arquitetura
//
// Supressões intencionais:
// 1) removido o uso de currentChatId e selectedReceiverId
// 2) removida a lógica incorreta que tratava route userId como chatId
// 3) removidos console.log espalhados; mantido debug centralizado
// 4) removido uso de null para seleção ativa, usando undefined por compat com os Inputs atuais
//
// Observação:
// - userId da rota continua existindo apenas como contexto
// - selectedChatId representa apenas o identificador real da conversa/sala selecionada
// - selectedType representa apenas o tipo selecionado no momento
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Timestamp } from '@firebase/firestore';

import { Observable, combineLatest, of } from 'rxjs';
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

import { environment } from 'src/environments/environment';

type ChatSelectionType = 'room' | 'chat';
type ChatSelectionEvent = { id: string; type: ChatSelectionType };

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
   * Compat com inputs antigos do módulo: string | undefined
   */
  selectedChatId: string | undefined;

  /**
   * Tipo real da seleção atual.
   * Compat com template atual: 'room' | 'chat' | undefined
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

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly accessControl: AccessControlService,
    private readonly chatService: ChatService,
    private readonly roomMessages: RoomMessagesService,
    private readonly route: ActivatedRoute,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  ngOnInit(): void {
    this.observeRouteUserId();
    this.observeAuthenticatedUser();
  }

  /**
   * Mantém apenas o contexto de rota.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - foi removido o comportamento antigo que fazia:
   *   selectedChatId = userId da rota
   *
   * Motivo:
   * - userId da rota não é, por definição, o id da conversa;
   * - isso gerava seleção inconsistente e comportamento incorreto.
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

    this.dbg('onChatSelected()', {
      selectedChatId: this.selectedChatId,
      selectedType: this.selectedType,
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

  /**
   * Roteia erro para o handler global e, quando necessário,
   * entrega feedback amigável ao usuário.
   */
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
}
