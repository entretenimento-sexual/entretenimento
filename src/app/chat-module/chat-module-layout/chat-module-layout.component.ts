// src/app/chat-module/chat-module-layout/chat-module-layout.component.ts
// ============================================================================
// CHAT MODULE LAYOUT COMPONENT
//
// Responsabilidades desta versão:
// - manter o shell principal do módulo de chat;
// - receber seleção de conversa direta;
// - aceitar deep-link por query params: openChatId / withUser;
// - delegar comandos de envio direto ao DirectChatSendOrchestrator;
// - usar AuthSessionService como fonte canônica da sessão;
// - delegar seleção/contexto do peer ao DirectChatSelectionContextFacade;
// - bloquear preventivamente envio direto sem conexão aceita;
// - manter feedback de envio acessível e claro;
// - usar PrivacyDebugLoggerService para logs de debug.
//
// Segurança:
// - o frontend NÃO é autoridade para permissão;
// - Cloud Functions continuam sendo a barreira real;
// - o bloqueio local é apenas UX preventiva;
// - envio direto continua passando pelo backend;
// - Salas não participam do shell ativo de mensageria.
//
// Supressões explícitas mantidas:
// 1) não usa route userId como chatId;
// 2) não reaplica deep-link indefinidamente;
// 3) não mantém sidebar interna duplicando perfil/salas fora da lista;
// 4) não usa ngSrc no avatar do header para evitar warning de proporção;
// 5) /chat/rooms permanece isolado como histórico/encerramento.
// ============================================================================
import {
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';

import { ActivatedRoute } from '@angular/router';
import {
  Observable,
  of,
} from 'rxjs';

import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  tap,
} from 'rxjs/operators';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

import {
  DIRECT_CHAT_MAX_MESSAGE_LENGTH,
  directMessageLength,
  isDirectMessageNearLimit,
  isDirectMessageTooLong,
  normalizeDirectMessageContent,
  trimDirectMessageContent,
} from '../policies/direct-chat-composer.policy';
import { DirectChatNavigationOrchestrator } from '../application/direct-chat-navigation.orchestrator';
import { DirectChatComposeAccessFacade } from '../application/direct-chat-compose-access.facade';
import { DirectChatSendOrchestrator } from '../application/direct-chat-send.orchestrator';
import {
  DirectChatSelectionContextFacade,
  DirectChatSelectionEvent,
  DirectChatSelectionType,
} from '../application/direct-chat-selection-context.facade';

@Component({
  selector: 'app-chat-module-layout',
  templateUrl: './chat-module-layout.component.html',
  styleUrls: ['./chat-module-layout.component.css'],
  providers: [DirectChatNavigationOrchestrator, DirectChatComposeAccessFacade, DirectChatSendOrchestrator, DirectChatSelectionContextFacade],
  standalone: false,
})
export class ChatModuleLayoutComponent implements OnInit {
  // ---------------------------------------------------------------------------
  // Injects
  // ---------------------------------------------------------------------------
  private readonly destroyRef = inject(DestroyRef);

  private readonly authSession = inject(AuthSessionService);

  private readonly navigationOrchestrator = inject(DirectChatNavigationOrchestrator);
  private readonly composeAccessFacade = inject(DirectChatComposeAccessFacade);
  private readonly sendOrchestrator = inject(DirectChatSendOrchestrator);
  private readonly selectionContext = inject(DirectChatSelectionContextFacade);

  private readonly route = inject(ActivatedRoute);

  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  // ---------------------------------------------------------------------------
  // Internal reactive state
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Public state consumed by template
  // ---------------------------------------------------------------------------

  messageContent = '';

  readonly maxMessageLength = DIRECT_CHAT_MAX_MESSAGE_LENGTH;

get normalizedMessageContent(): string {
  return normalizeDirectMessageContent(this.messageContent);
}

get trimmedMessageContent(): string {
  return trimDirectMessageContent(this.messageContent);
}

get messageLength(): number {
  return directMessageLength(this.messageContent);
}

get messageLengthLabel(): string {
  return `${this.messageLength}/${this.maxMessageLength}`;
}

get isMessageTooLong(): boolean {
  return isDirectMessageTooLong(this.messageContent, this.maxMessageLength);
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
  return isDirectMessageNearLimit(this.messageContent, this.maxMessageLength);
}

get shouldShowComposerHelp(): boolean {
  return (
    this.isMessageTooLong ||
    this.isNearMessageLimit ||
    !!this.directMessageBlockedReason()
  );
}
  get selectedChatId(): string | undefined {
    return this.selectionContext.selectedChatId() ?? undefined;
  }

  get selectedType(): DirectChatSelectionType | undefined {
    return this.selectionContext.selectedType() ?? undefined;
  }

  get activeChatPeerUid(): string | null {
    return this.selectionContext.activePeerUid();
  }

  get activeChatPeerName(): string | null {
    return this.selectionContext.activePeerName();
  }

  get activeChatPeerPhotoURL(): string | null {
    return this.selectionContext.activePeerPhotoURL();
  }

  // ---------------------------------------------------------------------------
  // Core streams
  // ---------------------------------------------------------------------------

  readonly currentUid$: Observable<string | null> = this.authSession.uid$.pipe(
    map((uid) => (uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedDirectPeerUid$: Observable<string | null> =
    this.selectionContext.selectedDirectPeerUid$(this.currentUid$);

  private readonly selectedChatId$ = this.selectionContext.selectedChatId$;
  private readonly selectedType$ = this.selectionContext.selectedType$;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  ngOnInit(): void {
    this.observeAuthenticatedUser();
    this.observeChatDeepLink();
    this.observeSelectionPeerContext();
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
  // Route/session observers
  // ---------------------------------------------------------------------------

  private observeAuthenticatedUser(): void {
    this.currentUid$
      .pipe(
        tap((uid) => {
          if (!uid) {
            this.messageContent = '';
            this.selectionContext.clear();
          }

          this.dbg('observeAuthenticatedUser()', {
            hasUid: !!uid,
          });
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao obter sessão do usuário.',
            error,
            { op: 'observeAuthenticatedUser' },
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
    this.navigationOrchestrator
      .observeResolvedDeepLinks$(this.currentUid$, this.route.queryParamMap)
      .pipe(
        tap((resolved) => {
          if (!resolved?.chatId) {
            this.consumeDeepLinkQueryParams();
            return;
          }

          this.selectionContext.select(resolved.chatId, 'chat');
          this.directMessageBlockedReason.set(null);

          if (resolved.withUser) {
            this.selectionContext.applyPeer({
              peerUid: resolved.withUser,
            });
          } else {
            this.selectionContext.clearPeer();
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
    this.navigationOrchestrator
      .consumeDeepLinkQueryParams(this.route)
      .catch((error) => {
        this.reportError(
          'A conversa foi aberta, mas a limpeza da URL falhou.',
          error,
          { op: 'consumeDeepLinkQueryParams' },
          false
        );
      });
  }

  private observeSelectionPeerContext(): void {
    this.selectionContext
      .syncPeerContext$(this.currentUid$)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  /**
   * Mantém sinais locais sincronizados para template e clique rápido.
   */
  private observeComposePermissions(): void {
    this.composeAccessFacade
      .observe$(
        this.currentUid$,
        this.selectedDirectPeerUid$,
        this.selectedType$,
        this.selectedChatId$
      )
      .pipe(
        tap((state) => {
          this.canSendCurrentMessage.set(state.canSendCurrentMessage);
          this.sendStatusMessageSignal.set(state.statusMessage);
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

  onChatSelected(event: DirectChatSelectionEvent): void {
    if (!this.selectionContext.selectEvent(event)) {
      this.dbg('onChatSelected() ignorado', {
        hasEvent: !!event,
      });
      return;
    }

    this.directMessageBlockedReason.set(null);

    this.dbg('onChatSelected()', {
      selectedChatId: this.selectedChatId,
      selectedType: this.selectedType,
      hasActivePeerUid: !!this.activeChatPeerUid,
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

    this.sendOrchestrator
      .send$(selectedChatId, content)
      .pipe(
        tap((result) => {
          if (result.blockedReason) {
            this.directMessageBlockedReason.set(result.blockedReason);
          }

          if (result.messageId) {
            this.messageContent = '';
            this.directMessageBlockedReason.set(null);

            this.dbg('sendMessage() -> direct orchestrator ok', {
              selectedChatId,
              messageId: result.messageId,
            });
          }
        }),
        finalize(() => {
          this.isSendingMessage.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
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

  // ---------------------------------------------------------------------------
  // Error helpers
  // ---------------------------------------------------------------------------

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>,
    notifyUser = true
  ): void {
    this.applicationError.report(error, {
      feature: 'direct-chat',
      operation: String(context?.['op'] ?? 'chat'),
      fallbackMessage: userMessage,
      presentation: notifyUser
        ? undefined
        : { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'ChatModuleLayoutComponent',
        ...(context ?? {}),
      },
    });
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('chat', `ChatModuleLayout: ${message}`, extra);
  }

}