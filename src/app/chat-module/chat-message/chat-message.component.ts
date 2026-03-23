// src/app/chat-module/chat-message/chat-message.component.ts
// ============================================================================
// CHAT MESSAGE COMPONENT
//
// Responsabilidade deste componente:
// - renderizar uma mensagem individual
// - identificar se a mensagem é enviada ou recebida
// - exibir nickname do remetente
// - permitir exclusão quando aplicável
//
// Ajustes desta fase:
// - compatível com chat direto 1:1 e room
// - aceita input `type`
// - mantém AuthSessionService como fonte da sessão
// - mantém tratamento de erro centralizado
//
// SUPRESSÃO EXPLÍCITA NESTA FASE:
// - exclusão de mensagem fica restrita ao eixo `chat`
// - `room` NÃO reutiliza delete legado de chat
//
// Motivo:
// - agora o foco arquitetural é 1:1
// - room fica em segundo plano, sem ser esquecido
// - isso evita misturar regras de moderação/ownership de room
//   com regras simples de delete da própria mensagem em chat direto
// ============================================================================

import { Component, DestroyRef, inject, input, OnInit } from '@angular/core';
import { Observable, from, isObservable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

type ChatMessageType = 'chat' | 'room';

@Component({
  selector: 'app-chat-message',
  templateUrl: './chat-message.component.html',
  styleUrls: ['./chat-message.component.css'],
  standalone: false
})
export class ChatMessageComponent implements OnInit {
  readonly message = input.required<Message>();
  readonly chatId = input<string>();
  readonly type = input<ChatMessageType>('chat');

  senderName = 'Usuário desconhecido';
  currentUserUid: string | null = null;

  private readonly debug = !environment.production;
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly authSession: AuthSessionService,
    private readonly chatService: ChatService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  private readonly message$ = toObservable(this.message).pipe(
    distinctUntilChanged((a, b) =>
      (a?.id ?? null) === (b?.id ?? null) &&
      (a?.senderId ?? null) === (b?.senderId ?? null) &&
      (a?.nickname ?? null) === (b?.nickname ?? null) &&
      (a?.status ?? null) === (b?.status ?? null) &&
      (a?.content ?? null) === (b?.content ?? null)
    )
  );

  ngOnInit(): void {
    this.observeCurrentUserUid();
    this.observeSenderName();
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------

  private observeCurrentUserUid(): void {
    this.authSession.uid$
      .pipe(
        tap((uid) => {
          this.currentUserUid = (uid ?? '').trim() || null;
        }),
        catchError((error) => {
          this.reportError(
            'Falha ao obter usuário autenticado.',
            error,
            { op: 'observeCurrentUserUid' },
            false
          );
          this.currentUserUid = null;
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ---------------------------------------------------------------------------
  // Sender
  // ---------------------------------------------------------------------------

  private observeSenderName(): void {
    this.message$
      .pipe(
        map((message) => ({
          senderId: (message?.senderId ?? '').trim(),
          nickname: (message?.nickname ?? '').trim(),
        })),
        distinctUntilChanged((a, b) => {
          return a.senderId === b.senderId && a.nickname === b.nickname;
        }),
        switchMap(({ senderId, nickname }) => {
          if (nickname) {
            return of(nickname);
          }

          if (!senderId) {
            return of('Usuário desconhecido');
          }

          return this.firestoreUserQuery.getUser(senderId).pipe(
            take(1),
            map((user: IUserDados | null) => user?.nickname?.trim() || 'Usuário desconhecido'),
            catchError((error) => {
              this.reportError(
                'Erro ao buscar nome do usuário.',
                error,
                { op: 'observeSenderName', senderId },
                false
              );
              return of('Usuário desconhecido');
            })
          );
        }),
        tap((nickname) => {
          this.senderName = nickname || 'Usuário desconhecido';
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  isDirectChat(): boolean {
    return this.type() === 'chat';
  }

  isRoomMessage(): boolean {
    return this.type() === 'room';
  }

  isMessageSent(): boolean {
    return (this.message().senderId ?? null) === this.currentUserUid;
  }

  canDeleteMessage(): boolean {
    /**
     * Regra atual:
     * - delete só no chat direto 1:1
     * - apenas da própria mensagem
     *
     * Room fica propositalmente fora por enquanto.
     */
    return this.isDirectChat() && this.isMessageSent() && !!this.message().id;
  }

  getStatusText(): string {
    if (this.isRoomMessage()) {
      return '';
    }

    switch (this.message().status) {
      case 'sent':
        return 'Enviada';
      case 'delivered':
        return 'Entregue';
      case 'read':
        return 'Lida';
      default:
        return '';
    }
  }

  getAriaLabel(): string {
    const sender = this.senderName || 'Usuário';
    const content = this.message().content ?? '';
    const status = this.getStatusText();

    return `${sender}: ${content}${status ? `. Status: ${status}.` : '.'}`;
  }

  getDeleteAriaLabel(): string {
    return 'Excluir esta mensagem';
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  deleteThisMessage(): void {
    const message = this.message();
    const chatId = (this.chatId() ?? '').trim();
    const type = this.type();

    if (type !== 'chat') {
      this.dbg('deleteThisMessage -> bloqueado para room', {
        type,
        chatId,
        messageId: message?.id ?? null,
      });
      return;
    }

    if (!chatId || !message?.id) {
      this.dbg('deleteThisMessage -> skip', {
        type,
        chatId,
        messageId: message?.id ?? null,
      });
      return;
    }

    this.coerceToVoid$(this.chatService.deleteMessage(chatId, message.id))
      .pipe(
        tap(() => {
          this.dbg('deleteThisMessage -> ok', {
            chatId,
            messageId: message.id,
            type,
          });
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao excluir mensagem.',
            error,
            { op: 'deleteThisMessage', chatId, messageId: message.id, type }
          );
          return of(void 0);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private coerceToVoid$(result: unknown): Observable<void> {
    if (isObservable(result)) {
      return (result as Observable<unknown>).pipe(map(() => void 0));
    }

    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return from(result as PromiseLike<unknown>).pipe(map(() => void 0));
    }

    return of(void 0);
  }

  // ---------------------------------------------------------------------------
  // Debug / Error
  // ---------------------------------------------------------------------------

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[ChatMessage] ${message}`, extra ?? '');
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
        scope: 'ChatMessageComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}
