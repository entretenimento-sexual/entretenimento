// src/app/chat-module/chat-module-layout/chat-module-layout.component.ts
// Layout principal do módulo de chat.
//
// Ajustes aplicados:
// - userId deixa de misturar "uid da rota" com "uid autenticado"
// - Fonte de verdade da sessão: AuthSessionService
// - Fonte de verdade do perfil do app: CurrentUserStoreService
// - Observable-first no envio de mensagens
// - Limpeza automática de subscriptions com takeUntilDestroyed
// - Tratamento de erro centralizado

import { Component, OnInit, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Timestamp } from '@firebase/firestore';

import { Observable, of } from 'rxjs';
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

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Component({
  selector: 'app-chat-module-layout',
  templateUrl: './chat-module-layout.component.html',
  styleUrls: ['./chat-module-layout.component.css'],
  standalone: false
})
export class ChatModuleLayoutComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Perfil atual do app.
   * - undefined no store vira null aqui, para simplificar consumo no componente/template.
   */
  usuario$: Observable<IUserDados | null>;

  messageContent = '';
  currentChatId = '';
  selectedChatId: string | undefined;
  selectedReceiverId: string | undefined;
  selectedType: 'room' | 'chat' | undefined;

  /**
   * userId passa a representar APENAS o uid vindo da rota,
   * preservando compatibilidade com o restante do componente/template.
   */
  userId: string | undefined;

  /**
   * UID autenticado fica separado para evitar sobrescrever userId da rota.
   */
  currentUserUid: string | null = null;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly chatService: ChatService,
    private readonly roomMessages: RoomMessagesService,
    private readonly route: ActivatedRoute,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
  ) {
    this.usuario$ = this.currentUserStore.user$.pipe(
      map((user) => user ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    console.log('Construtor do ChatModuleLayoutComponent chamado:', Date.now());
  }

  ngOnInit(): void {
    console.log('ngOnInit do ChatModuleLayoutComponent iniciado:', Date.now());

    this.observeRouteUserId();
    this.observeAuthenticatedUser();
  }

  private observeRouteUserId(): void {
    this.route.paramMap
      .pipe(
        map((params) => (params.get('userId') ?? '').trim() || undefined),
        distinctUntilChanged(),
        tap((routeUserId) => {
          this.userId = routeUserId;
          console.log('UserID capturado da rota:', this.userId);

          if (this.userId) {
            this.selectedChatId = this.userId;
            this.selectedType = 'chat';
          }
        }),
        catchError((error) => {
          this.reportError('Erro ao processar parâmetros da rota.', error, {
            op: 'observeRouteUserId',
          });
          return of(undefined);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private observeAuthenticatedUser(): void {
    this.authSession.uid$
      .pipe(
        distinctUntilChanged(),
        tap((uid) => {
          this.currentUserUid = (uid ?? '').trim() || null;
        }),
        catchError((error) => {
          this.reportError('Erro ao obter sessão do usuário.', error, {
            op: 'observeAuthenticatedUser.uid',
          }, false);
          this.currentUserUid = null;
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.usuario$
      .pipe(
        tap((user) => {
          if (user) {
            console.log('Dados do usuário autenticado:', user);
          }
        }),
        catchError((error) => {
          this.reportError('Erro ao observar usuário atual.', error, {
            op: 'observeAuthenticatedUser.user',
          }, false);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  onChatSelected(event: { id: string; type: 'room' | 'chat' }): void {
    console.log('Evento recebido:', event);

    if (!event?.id || !event?.type) {
      console.log('Erro: Evento de seleção inválido.', event);
      return;
    }

    this.selectedChatId = event.id;
    this.selectedType = event.type;

    console.log(`Selecionado ${event.type} com ID: ${event.id}`);

    if (event.type === 'chat') {
      console.log('Carregando mensagens do chat:', event.id);
    } else if (event.type === 'room') {
      console.log('Carregando interações da sala:', event.id);
      this.selectedChatId = event.id;
      this.selectedType = 'room';
    }
  }

  onRoomSelected(roomId: string): void {
    console.log('Sala selecionada pelo usuário:', roomId);
    this.selectedChatId = roomId;
    this.selectedType = 'room';
  }

  sendMessage(): void {
    console.log('Tentando enviar mensagem:', this.messageContent);

    const content = this.messageContent.trim();
    if (!content) {
      console.log('A mensagem está vazia.');
      return;
    }

    const selectedChatId = (this.selectedChatId ?? '').trim();
    const selectedType = this.selectedType;

    if (!selectedChatId || !selectedType) {
      this.errorNotifier.showWarning('Selecione um chat ou sala antes de enviar a mensagem.');
      return;
    }

    this.currentUserStore.user$
      .pipe(
        filter((user) => user !== undefined),
        take(1),
        switchMap((currentUser) => {
          const senderId = currentUser?.uid ?? this.currentUserUid ?? this.authSession.currentAuthUser?.uid ?? null;
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
                console.log('Mensagem enviada com sucesso ao chat');
                this.messageContent = '';
              })
            );
          }

          return this.roomMessages.sendMessageToRoom$(selectedChatId, message).pipe(
            tap(() => {
              console.log('Mensagem enviada com sucesso à sala');
              this.messageContent = '';
            })
          );
        }),
        catchError((error) => {
          this.reportError('Erro ao enviar mensagem.', error, {
            op: 'sendMessage',
            selectedChatId,
            selectedType,
          });
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
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
} // Linha 284
