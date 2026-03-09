// src/app/chat-module/chat-message/chat-message.component.ts
// Componente responsável por exibir uma única mensagem de chat.
// Ajustes aplicados:
// - Fonte de verdade da sessão: AuthSessionService
// - Observação reativa da message input
// - Tratamento de erro centralizado
// - Compatível com deleteMessage retornando Observable, Promise ou void

import { Component, OnInit, input, DestroyRef, inject } from '@angular/core';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { Observable, from, of, isObservable } from 'rxjs';
import { catchError, distinctUntilChanged, map, switchMap, take, tap } from 'rxjs/operators';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Component({
  selector: 'app-chat-message',
  templateUrl: './chat-message.component.html',
  styleUrls: ['./chat-message.component.css'],
  standalone: false
})
export class ChatMessageComponent implements OnInit {
  readonly message = input.required<Message>();
  readonly chatId = input<string>();

  senderName = 'Usuário desconhecido';
  currentUserUid: string | null = null;

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
      (a?.nickname ?? null) === (b?.nickname ?? null)
    )
  );

  ngOnInit(): void {
    this.observeCurrentUserUid();
    this.observeSenderName();
  }

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

  private observeSenderName(): void {
    this.message$
      .pipe(
        map((message) => ({
          senderId: (message?.senderId ?? '').trim(),
          nickname: (message?.nickname ?? '').trim(),
        })),
        distinctUntilChanged(
          (a, b) => a.senderId === b.senderId && a.nickname === b.nickname
        ),
        switchMap(({ senderId, nickname }) => {
          // Se a mensagem já vier com nickname, priorizamos isso
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

  isMessageSent(): boolean {
    return this.message().senderId === this.currentUserUid;
  }

  deleteThisMessage(): void {
    const message = this.message();
    const chatId = (this.chatId() ?? '').trim();

    if (!chatId || !message.id) {
      return;
    }

    this.coerceToVoid$(this.chatService.deleteMessage(chatId, message.id))
      .pipe(
        catchError((error) => {
          this.reportError(
            'Erro ao excluir mensagem.',
            error,
            { op: 'deleteThisMessage', chatId, messageId: message.id }
          );
          return of(void 0);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  getStatusText(): string {
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

  private coerceToVoid$(result: unknown): Observable<void> {
    if (isObservable(result)) {
      return (result as Observable<unknown>).pipe(map(() => void 0));
    }

    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return from(result as PromiseLike<unknown>).pipe(map(() => void 0));
    }

    return of(void 0);
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
} // Linha 201
