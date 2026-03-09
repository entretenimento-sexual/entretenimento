// src/app/chat-module/chat-messages-list/chat-messages-list.component.ts
// Componente responsável por exibir a lista de mensagens de um chat ou sala.
// Ajustes aplicados:
// - Fonte de verdade do UID: AuthSessionService
// - Fluxo reativo por Signal Inputs (chatId/type)
// - Remove duplicação artificial de mensagens
// - Read receipts feitos em best-effort
// - Tratamento de erro centralizado

import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  ViewChild,
  input,
  DestroyRef,
  inject,
} from '@angular/core';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { Observable, combineLatest, forkJoin, from, of, isObservable } from 'rxjs';
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

import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';

@Component({
  selector: 'app-chat-messages-list',
  templateUrl: './chat-messages-list.component.html',
  styleUrls: ['./chat-messages-list.component.css'],
  standalone: false
})
export class ChatMessagesListComponent {
  @ViewChild('messagesContainer')
  private messagesContainer!: ElementRef<HTMLDivElement>;

  readonly chatId = input<string>();
  readonly type = input<'chat' | 'room'>();

  messages: Message[] = [];

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly chatService: ChatService,
    private readonly roomMessage: RoomMessagesService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly cdRef: ChangeDetectorRef
  ) {
    this.bindMessagesStream();
  }

  private readonly currentUid$ = this.authSession.uid$.pipe(
    map((uid) => (uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly source$ = combineLatest([
    toObservable(this.chatId),
    toObservable(this.type),
  ]).pipe(
    map(([chatId, type]) => ({
      chatId: (chatId ?? '').trim(),
      type: type ?? null,
    })),
    filter((v): v is { chatId: string; type: 'chat' | 'room' } => !!v.chatId && !!v.type),
    distinctUntilChanged((a, b) => a.chatId === b.chatId && a.type === b.type),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private bindMessagesStream(): void {
    this.source$
      .pipe(
        switchMap(({ chatId, type }) => {
          const stream$ =
            type === 'chat'
              ? this.chatService.monitorChat(chatId)
              : this.roomMessage.getRoomMessages(chatId);

          return stream$.pipe(
            switchMap((messages: Message[]) => {
              const normalizedMessages = Array.isArray(messages) ? messages : [];

              if (type !== 'chat') {
                return of(normalizedMessages);
              }

              return this.currentUid$.pipe(
                take(1),
                tap((currentUid) => {
                  this.markDeliveredMessagesAsRead(chatId, currentUid, normalizedMessages);
                }),
                map(() => normalizedMessages)
              );
            }),
            tap((messages) => {
              // Em streams realtime, substituir a coleção inteira é mais seguro
              // do que fazer append/deduplicação local.
              this.messages = messages;
              this.cdRef.detectChanges();
              setTimeout(() => this.scrollToBottom(), 0);
            }),
            catchError((error) => {
              this.reportError(
                'Erro ao carregar mensagens.',
                error,
                { op: 'bindMessagesStream', chatId, type }
              );
              this.messages = [];
              this.cdRef.detectChanges();
              return of([] as Message[]);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private markDeliveredMessagesAsRead(
    chatId: string,
    currentUid: string | null,
    messages: Message[]
  ): void {
    const uid = (currentUid ?? '').trim();
    if (!uid || !messages?.length) {
      return;
    }

    const idsToMark = messages
      .filter((msg) => msg.status === 'delivered' && msg.senderId !== uid && !!msg.id)
      .map((msg) => msg.id as string);

    if (!idsToMark.length) {
      return;
    }

    const ops = idsToMark.map((messageId) =>
      this.coerceToVoid$(this.chatService.updateMessageStatus(chatId, messageId, 'read')).pipe(
        catchError((error) => {
          this.reportError(
            'Falha ao atualizar status da mensagem.',
            error,
            { op: 'markDeliveredMessagesAsRead', chatId, messageId },
            false
          );
          return of(void 0);
        })
      )
    );

    forkJoin(ops)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  /** Rola automaticamente para a última mensagem no contêiner. */
  private scrollToBottom(): void {
    if (!this.messagesContainer) {
      return;
    }

    const container = this.messagesContainer.nativeElement;
    const { scrollTop, scrollHeight, clientHeight } = container;

    const nearBottom = (scrollHeight - scrollTop - clientHeight) < 200;

    if (nearBottom) {
      container.scrollTop = scrollHeight;
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
        scope: 'ChatMessagesListComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
} // Linha228
