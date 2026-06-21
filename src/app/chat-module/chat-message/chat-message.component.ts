// src/app/chat-module/chat-message/chat-message.component.ts
// ============================================================================
// CHAT MESSAGE COMPONENT
//
// Responsabilidade deste componente:
// - renderizar uma mensagem individual;
// - identificar se a mensagem é enviada ou recebida;
// - exibir nickname do remetente;
// - exibir estado de mensagem apagada;
// - permitir reação rápida sincronizada no balão da mensagem.
//
// Ajustes desta fase:
// - compatível com chat direto 1:1 e room;
// - aceita input `type`;
// - mantém AuthSessionService como fonte da sessão;
// - mantém tratamento de erro centralizado;
// - reação rápida no chat direto passa a ser persistida em reactionsByUser;
// - exclusão de mensagem direta foi movida para DeleteDirectMessageDirective,
//   que chama a callable deleteDirectMessage.
//
// SUPRESSÃO EXPLÍCITA NESTA FASE:
// - removido o método legado deleteThisMessage();
// - removido o uso de ChatService.deleteMessage() neste componente;
// - removido o helper coerceToVoid$(), que só existia para o caminho legado.
//
// Motivo:
// - delete físico client-side é bloqueado por rules;
// - a exclusão correta agora é soft delete via Cloud Function;
// - o componente deve renderizar estado e ações, não executar deleteDoc indireto.
// ============================================================================
import { Component, DestroyRef, inject, input, OnInit } from '@angular/core';
import { combineLatest, from, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { Firestore } from '@angular/fire/firestore';
import { doc, updateDoc } from 'firebase/firestore';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

type ChatMessageType = 'chat' | 'room';

type QuickReaction = {
  emoji: string;
  label: string;
};

@Component({
  selector: 'app-chat-message',
  templateUrl: './chat-message.component.html',
  styleUrls: ['./chat-message.component.css'],
  standalone: false,
})
export class ChatMessageComponent implements OnInit {
  readonly message = input.required<Message>();
  readonly chatId = input<string>();
  readonly type = input<ChatMessageType>('chat');
  readonly previousMessage = input<Message | null>(null);
  readonly nextMessage = input<Message | null>(null);

  private readonly destroyRef = inject(DestroyRef);

  senderName = 'Usuário desconhecido';
  currentUserUid: string | null = null;
  selectedReaction: string | null = null;
  isSavingReaction = false;

  readonly quickReactions: QuickReaction[] = [
    { emoji: '❤️', label: 'Reagir com coração' },
    { emoji: '😂', label: 'Reagir com risada' },
    { emoji: '🔥', label: 'Reagir com fogo' },
    { emoji: '👀', label: 'Reagir com olhos' },
  ];

  private readonly message$ = toObservable(this.message).pipe(
    distinctUntilChanged((a, b) =>
      (a?.id ?? null) === (b?.id ?? null) &&
      (a?.senderId ?? null) === (b?.senderId ?? null) &&
      (a?.nickname ?? null) === (b?.nickname ?? null) &&
      (a?.status ?? null) === (b?.status ?? null) &&
      (a?.content ?? null) === (b?.content ?? null) &&
      (a?.deleted ?? null) === (b?.deleted ?? null) &&
      JSON.stringify(a?.reactionsByUser ?? {}) === JSON.stringify(b?.reactionsByUser ?? {})
    )
  );

  constructor(
    private readonly db: Firestore,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly authSession: AuthSessionService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService,
  ) {}

  ngOnInit(): void {
    this.observeCurrentUserUid();
    this.observeSenderName();
    this.observeReactionFromMessage();
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
        distinctUntilChanged((a, b) => a.senderId === b.senderId && a.nickname === b.nickname),
        switchMap(({ senderId, nickname }) => {
          if (nickname) {
            return of(nickname);
          }

          if (!senderId) {
            return of('Usuário desconhecido');
          }

          const isSelfMessage = senderId === this.currentUserUid;
          const user$ = isSelfMessage
            ? this.firestoreUserQuery.getUser$(senderId)
            : this.firestoreUserQuery.getPublicUserById$(senderId);

          return user$.pipe(
            take(1),
            map((user: IUserDados | null) => user?.nickname?.trim() || 'Usuário desconhecido'),
            catchError((error) => {
              this.reportError(
                'Erro ao buscar nome do usuário.',
                error,
                { op: 'observeSenderName', senderId, isSelfMessage },
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

  private observeReactionFromMessage(): void {
    combineLatest([this.message$, this.authSession.uid$])
      .pipe(
        map(([message, uid]) => {
          if (message?.deleted === true) {
            return null;
          }

          const safeUid = String(uid ?? '').trim();
          return safeUid ? String(message?.reactionsByUser?.[safeUid] ?? '').trim() || null : null;
        }),
        tap((reaction) => {
          this.selectedReaction = reaction;
        }),
        catchError((error) => {
          this.reportError(
            'Não foi possível carregar reação da mensagem.',
            error,
            { op: 'observeReactionFromMessage' },
            false
          );
          this.selectedReaction = null;
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  selectQuickReaction(emoji: string): void {
    const safeEmoji = String(emoji ?? '').trim();

    if (!safeEmoji || this.isSavingReaction || this.message().deleted === true) {
      return;
    }

    if (!this.isDirectChat()) {
      this.selectLocalReaction(safeEmoji);
      return;
    }

    this.persistDirectChatReaction(safeEmoji);
  }

  private persistDirectChatReaction(emoji: string): void {
    const uid = String(this.currentUserUid ?? '').trim();
    const chatId = String(this.chatId() ?? '').trim();
    const messageId = String(this.message()?.id ?? '').trim();

    if (!uid || !chatId || !messageId) {
      this.selectLocalReaction(emoji);
      return;
    }

    const previousReaction = this.selectedReaction;
    const nextReaction = previousReaction === emoji ? null : emoji;
    const nextReactionsByUser = { ...(this.message().reactionsByUser ?? {}) };

    if (nextReaction) {
      nextReactionsByUser[uid] = nextReaction;
    } else {
      delete nextReactionsByUser[uid];
    }

    this.selectedReaction = nextReaction;
    this.isSavingReaction = true;

    const messageRef = doc(this.db, `chats/${chatId}/messages/${messageId}`);

    from(updateDoc(messageRef, { reactionsByUser: nextReactionsByUser }))
      .pipe(
        tap(() => {
          this.dbg('persistDirectChatReaction -> ok', { chatId, messageId, selected: !!nextReaction });
        }),
        catchError((error) => {
          this.selectedReaction = previousReaction;
          this.reportError(
            'Não foi possível salvar a reação.',
            error,
            { op: 'persistDirectChatReaction', chatId, messageId }
          );
          return of(void 0);
        }),
        finalize(() => {
          this.isSavingReaction = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private selectLocalReaction(emoji: string): void {
    const nextReaction = this.selectedReaction === emoji ? null : emoji;
    this.selectedReaction = nextReaction;
    this.persistLocalReaction(nextReaction);
  }

  getReactionAriaLabel(reaction: QuickReaction): string {
    return this.selectedReaction === reaction.emoji ? `Remover reação ${reaction.emoji}` : reaction.label;
  }

  getSelectedReactionTitle(): string {
    return this.selectedReaction ? 'Sua reação nesta mensagem' : 'Reação nesta mensagem';
  }

  getVisibleReactions(): string[] {
    if (this.message().deleted === true) {
      return [];
    }

    const ordered = this.quickReactions.map((reaction) => reaction.emoji);
    const values = Object.values(this.message().reactionsByUser ?? {})
      .map((reaction) => String(reaction ?? '').trim())
      .filter(Boolean);

    if (this.selectedReaction) {
      values.unshift(this.selectedReaction);
    }

    return Array.from(new Set(values)).sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b));
  }

  private persistLocalReaction(reaction: string | null): void {
    const storageKey = this.getReactionStorageKey();
    if (!storageKey) return;

    try {
      if (!reaction) {
        sessionStorage.removeItem(storageKey);
        return;
      }
      sessionStorage.setItem(storageKey, reaction);
    } catch {
      // storage indisponível não deve quebrar a thread.
    }
  }

  private getReactionStorageKey(): string | null {
    const messageId = String(this.message()?.id ?? '').trim();
    const chatId = String(this.chatId() ?? '').trim();
    const type = this.type();
    return messageId ? `chat-reaction:${type}:${chatId || 'thread'}:${messageId}` : null;
  }

  isDirectChat(): boolean { return this.type() === 'chat'; }
  isRoomMessage(): boolean { return this.type() === 'room'; }
  isMessageSent(): boolean { return (this.message().senderId ?? null) === this.currentUserUid; }

  isSameSenderAsPrevious(): boolean {
    const currentSenderId = (this.message().senderId ?? '').trim();
    const previousSenderId = (this.previousMessage()?.senderId ?? '').trim();
    return !!currentSenderId && currentSenderId === previousSenderId;
  }

  isSameSenderAsNext(): boolean {
    const currentSenderId = (this.message().senderId ?? '').trim();
    const nextSenderId = (this.nextMessage()?.senderId ?? '').trim();
    return !!currentSenderId && currentSenderId === nextSenderId;
  }

  isFirstInGroup(): boolean { return !this.isSameSenderAsPrevious(); }
  isLastInGroup(): boolean { return !this.isSameSenderAsNext(); }
  isSingleMessageGroup(): boolean { return this.isFirstInGroup() && this.isLastInGroup(); }

  canDeleteMessage(): boolean {
    return this.isDirectChat()
      && this.isMessageSent()
      && this.message().deleted !== true
      && !!this.message().id;
  }

  shouldShowSenderName(): boolean { return this.isRoomMessage() && this.isFirstInGroup(); }
  shouldShowMessageHeader(): boolean { return this.shouldShowSenderName() || this.canDeleteMessage(); }
  shouldShowTail(): boolean { return this.isLastInGroup(); }

  getStatusText(): string {
    if (this.isRoomMessage() || !this.isMessageSent()) return '';

    switch (this.message().status) {
      case 'sent': return 'Enviada';
      case 'delivered': return 'Entregue';
      case 'read': return 'Lida';
      default: return '';
    }
  }

  shouldShowDeliveryStatus(): boolean {
    return this.isDirectChat() && this.isMessageSent() && !!this.getStatusText();
  }

  getStatusSymbol(): string {
    if (!this.shouldShowDeliveryStatus()) return '';
    return this.message().status === 'sent' ? '✓' : '✓✓';
  }

  getStatusClass(): string {
    if (!this.shouldShowDeliveryStatus()) return '';
    return `thread-message__status--${this.message().status ?? 'sent'}`;
  }

  getAriaLabel(): string {
    const sender = this.senderName || 'Usuário';
    const content = this.message().deleted === true ? 'Mensagem apagada' : this.message().content ?? '';
    const status = this.getStatusText();
    const reactions = this.getVisibleReactions();
    const reaction = reactions.length ? `. Reações: ${reactions.join(' ')}.` : '';
    return `${sender}: ${content}${status ? `. Status: ${status}.` : '.'}${reaction}`;
  }

  getDisplayedSenderName(): string {
    return this.isMessageSent() ? 'Você' : this.senderName || 'Usuário';
  }

  getTimeTitle(): string {
    try {
      return this.message().timestamp?.toDate?.()?.toLocaleString?.('pt-BR') ?? '';
    } catch {
      return '';
    }
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('chat', `ChatMessage: ${message}`, extra);
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>,
    notifyUser = true
  ): void {
    if (notifyUser) {
      try { this.errorNotifier.showError(userMessage); } catch { }
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);
      (err as any).original = error;
      (err as any).context = { scope: 'ChatMessageComponent', ...(context ?? {}) };
      (err as any).skipUserNotification = true;
      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}
