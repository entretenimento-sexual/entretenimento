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
// ==============================================================
import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';

import { Observable, Subscription, of } from 'rxjs';
import { catchError, map, switchMap, take, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from 'src/app/messaging/direct-chat/application/direct-thread.facade';
import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-chat-messages-list',
  templateUrl: './chat-messages-list.component.html',
  styleUrls: ['./chat-messages-list.component.css'],
  standalone: false,
})
export class ChatMessagesListComponent implements OnChanges {
  @ViewChild('messagesContainer')
  private messagesContainer?: ElementRef<HTMLDivElement>;

  @Input() chatId: string | undefined;
  @Input() type: 'chat' | 'room' | undefined;

  messages: Message[] = [];

  private readonly debug = !environment.production;
  private readonly destroyRef = inject(DestroyRef);

  private activeThreadSub?: Subscription;

  constructor(
    private readonly directChatFacade: DirectChatFacade,
    private readonly directThreadFacade: DirectThreadFacade,
    private readonly roomMessage: RoomMessagesService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly cdRef: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['chatId'] || changes['type']) {
      this.rebindThread();
    }
  }

  private rebindThread(): void {
    const safeChatId = (this.chatId ?? '').trim();
    const safeType = this.type ?? null;

    this.activeThreadSub?.unsubscribe();
    this.activeThreadSub = undefined;

    if (!safeChatId || (safeType !== 'chat' && safeType !== 'room')) {
      this.messages = [];
      this.cdRef.detectChanges();
      return;
    }

    const source$ =
      safeType === 'chat'
        ? this.bindDirectChatThread$(safeChatId)
        : this.bindRoomThread$(safeChatId);

    this.activeThreadSub = source$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((messages) => {
        this.messages = Array.isArray(messages) ? messages : [];
        this.cdRef.detectChanges();

        queueMicrotask(() => this.scrollToBottom());
      });
  }

  private bindDirectChatThread$(chatId: string): Observable<Message[]> {
    this.directChatFacade.selectChat(chatId);

    return this.directThreadFacade.state$.pipe(
      map((state) => {
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

  private bindRoomThread$(chatId: string): Observable<Message[]> {
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

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
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
      } catch {}
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
    } catch {}
  }
}