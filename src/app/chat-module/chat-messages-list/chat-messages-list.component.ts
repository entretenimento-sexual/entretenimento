// src/app/chat-module/chat-messages-list/chat-messages-list.component.ts
// ============================================================================
// CHAT MESSAGES LIST COMPONENT
//
// Responsabilidade atual (fase de transição):
// - renderizar mensagens da thread selecionada
// - consumir DirectThreadFacade para chat 1:1
// - manter compat temporária com RoomMessagesService para rooms
// - manter scroll automático
// - manter tratamento de erro centralizado
//
// SUPRESSÕES EXPLÍCITAS NESTA FASE:
// - foi removida a dependência direta de ChatService no eixo 1:1
// - foi removida a função local markDeliveredMessagesAsRead(...)
// - foi removida a função local coerceToVoid$(...)
//
// Motivo:
// - receipts do 1:1 agora pertencem à DirectThreadFacade
// - a thread 1:1 agora pertence ao eixo direct-chat
// - o componente deixa de carregar responsabilidade de domínio
//
// Observação arquitetural:
// - chat 1:1 -> DirectThreadFacade
// - room      -> RoomMessagesService (compat temporária)
// ============================================================================

import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
  input,
} from '@angular/core';

import { of } from 'rxjs';
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

import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from 'src/app/messaging/direct-chat/application/direct-thread.facade';

import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { environment } from 'src/environments/environment';

type MessageListSource = {
  chatId: string;
  type: 'chat' | 'room';
};

@Component({
  selector: 'app-chat-messages-list',
  templateUrl: './chat-messages-list.component.html',
  styleUrls: ['./chat-messages-list.component.css'],
  standalone: false,
})
export class ChatMessagesListComponent {
  @ViewChild('messagesContainer')
  private messagesContainer?: ElementRef<HTMLDivElement>;

  readonly chatId = input<string>();
  readonly type = input<'chat' | 'room'>();

  messages: Message[] = [];

  private readonly debug = !environment.production;
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly directChatFacade: DirectChatFacade,
    private readonly directThreadFacade: DirectThreadFacade,
    private readonly roomMessage: RoomMessagesService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly cdRef: ChangeDetectorRef
  ) {
    this.bindMessagesStream();
  }

  // ---------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------

  private readonly source$ = [
    toObservable(this.chatId),
    toObservable(this.type),
  ] as const;

  private readonly resolvedSource$ = (toObservable(this.chatId)).pipe(
    switchMap(() =>
      toObservable(this.type).pipe(
        map((type) => ({
          chatId: (this.chatId() ?? '').trim(),
          type: type ?? null,
        }))
      )
    ),
    filter((value): value is MessageListSource => {
      return !!value.chatId && (value.type === 'chat' || value.type === 'room');
    }),
    distinctUntilChanged((a, b) => a.chatId === b.chatId && a.type === b.type),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ---------------------------------------------------------------------------
  // Binding principal
  // ---------------------------------------------------------------------------

  private bindMessagesStream(): void {
    this.resolvedSource$
      .pipe(
        tap(({ chatId, type }) => {
          /**
           * Compat defensiva:
           * - se o pai/componentes legados passarem um chatId de 1:1,
           *   garantimos que a DirectChatFacade fique sincronizada
           */
          if (type === 'chat') {
            this.directChatFacade.selectChat(chatId);
          }
        }),

        switchMap(({ chatId, type }) => {
          return type === 'chat'
            ? this.bindDirectChatThread$(chatId)
            : this.bindRoomThread$(chatId);
        }),

        tap((messages) => {
          this.messages = Array.isArray(messages) ? messages : [];
          this.cdRef.detectChanges();

          queueMicrotask(() => this.scrollToBottom());
        }),

        catchError((error) => {
          this.reportError(
            'Erro ao carregar mensagens.',
            error,
            { op: 'bindMessagesStream' }
          );

          this.messages = [];
          this.cdRef.detectChanges();
          return of([] as Message[]);
        }),

        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ---------------------------------------------------------------------------
  // Chat direto 1:1
  // ---------------------------------------------------------------------------

  /**
   * Thread de chat direto 1:1.
   *
   * Regras:
   * - usa DirectThreadFacade como fonte
   * - receipts do 1:1 são feitos pela facade, não pelo componente
   */
  private bindDirectChatThread$(chatId: string) {
    return this.directThreadFacade.state$.pipe(
      map((state) => {
        /**
         * Proteção contra resíduo de seleção anterior:
         * - só aceitamos mensagens quando o state bate com o chatId atual do input
         */
        if (state.chatId !== chatId) {
          return [] as Message[];
        }

        return Array.isArray(state.messages) ? state.messages : [];
      }),
      switchMap((messages) => {
        if (!messages.length) {
          return of(messages);
        }

        return this.directThreadFacade.markVisibleMessagesAsRead$(messages).pipe(
          take(1),
          map(() => messages),
          catchError((error) => {
            this.reportError(
              'Falha ao atualizar status das mensagens.',
              error,
              { op: 'bindDirectChatThread', chatId },
              false
            );
            return of(messages);
          })
        );
      }),
      tap((messages) => {
        this.dbg('bindDirectChatThread$', {
          chatId,
          count: messages.length,
        });
      }),
      catchError((error) => {
        this.reportError(
          'Erro ao carregar mensagens do chat.',
          error,
          { op: 'bindDirectChatThread', chatId }
        );
        return of([] as Message[]);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Room (compat temporária)
  // ---------------------------------------------------------------------------

  /**
   * SUPRESSÃO EXPLÍCITA:
   * - room continua legado temporário
   * - ainda não migramos rooms para um domínio separado
   */
  private bindRoomThread$(chatId: string) {
    return this.roomMessage.getRoomMessages(chatId).pipe(
      map((messages) => (Array.isArray(messages) ? messages : [])),
      tap((messages) => {
        this.dbg('bindRoomThread$', {
          roomId: chatId,
          count: messages.length,
        });
      }),
      catchError((error) => {
        this.reportError(
          'Erro ao carregar mensagens da sala.',
          error,
          { op: 'bindRoomThread', chatId }
        );
        return of([] as Message[]);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Scroll
  // ---------------------------------------------------------------------------

  /**
   * Rola automaticamente para a última mensagem no contêiner.
   */
  private scrollToBottom(): void {
    if (!this.messagesContainer) {
      return;
    }

    const container = this.messagesContainer.nativeElement;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 200;

    if (nearBottom) {
      container.scrollTop = scrollHeight;
    }
  }

  // ---------------------------------------------------------------------------
  // Debug / Error
  // ---------------------------------------------------------------------------

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[ChatMessagesList] ${message}`, extra ?? '');
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
        scope: 'ChatMessagesListComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}
