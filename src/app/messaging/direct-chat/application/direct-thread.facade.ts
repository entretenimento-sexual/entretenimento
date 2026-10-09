// src/app/messaging/direct-chat/application/direct-thread.facade.ts
// ============================================================================
// DIRECT THREAD FACADE
//
// Responsabilidade desta facade:
// - observar a thread ativa do chat direto 1:1
// - expor o estado consolidado da thread
// - centralizar comandos da thread:
//   - enviar mensagem
//   - excluir mensagem
//   - marcar mensagens visíveis como lidas
//
// NÃO é responsabilidade desta facade:
// - manter a seleção da conversa (DirectChatFacade faz isso)
// - navegar
// - hidratar store/cache manualmente
//
// Observação arquitetural:
// - DirectChatFacade = dona da seleção do chat 1:1
// - DirectThreadService = dono das operações da thread
// - DirectReceiptsService = dono dos receipts/read states
//
// SUPRESSÃO EXPLÍCITA NESTA VERSÃO:
// - não expomos ainda blockedReason dentro do state$
// - não expandimos DirectThreadState além do contrato atual
//
// Motivo:
// - o modelo atual DirectThreadState ainda contém apenas:
//   chatId, messages, loading
// - a prioridade agora é compatibilidade estável e sem erro de tipagem
// ============================================================================
import { Injectable } from '@angular/core';
import { combineLatest, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

import { DirectThreadState } from '../models/direct-message.models';
import { DirectThreadService } from '../services/direct-thread.service';
import { DirectReceiptsService } from '../services/direct-receipts.service';
import { DirectChatFacade } from './direct-chat.facade';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

@Injectable({ providedIn: 'root' })
export class DirectThreadFacade {
  
  /**
   * Chat ativo selecionado pela DirectChatFacade.
   */
  readonly activeChatId$: Observable<string | null> =
    this.directChatFacade.selectedChatId$.pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Pode abrir a thread atual?
   *
   * Nesta fase:
   * - depende de existir um chat realmente selecionado/válido
   */
  readonly canOpen$: Observable<boolean> =
    this.directChatFacade.selectedChatCanOpen$.pipe(
      distinctUntilChanged(),
      catchError((error) => {
        this.reportSilent(error, 'DirectThreadFacade.canOpen$');
        return of(false);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Pode enviar mensagem na thread atual?
   *
   * Mantido fora do state$ por compatibilidade com o modelo atual.
   */
  readonly canSend$: Observable<boolean> = combineLatest([
    this.activeChatId$,
    this.canOpen$,
    this.authSession.uid$,
    this.accessControl.canListenRealtime$,
  ]).pipe(
    map(([chatId, canOpen, uid, canListen]) => {
      return !!chatId && canOpen === true && !!uid && canListen === true;
    }),
    distinctUntilChanged(),
    tap((canSend) => {
      this.dbg('canSend$', { canSend });
    }),
    catchError((error) => {
      this.reportSilent(error, 'DirectThreadFacade.canSend$');
      return of(false);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Estado atômico por thread e sessão: o chatId acompanha as mensagens
   * produzidas por seu próprio listener, nunca por combineLatest paralelo.
   * Troca de chat, UID ou perda de acesso cancela o listener anterior e
   * emite imediatamente uma thread vazia.
   */
  readonly state$: Observable<DirectThreadState> = combineLatest([
    this.activeChatId$,
    this.canOpen$,
    this.authSession.uid$,
    this.accessControl.canListenRealtime$,
  ]).pipe(
    switchMap(([chatId, canOpen, uid, canListen]) => {
      const permittedChatId =
        chatId && canOpen && String(uid ?? '').trim() && canListen
          ? chatId
          : null;
      const emptyState: DirectThreadState = {
        chatId: permittedChatId,
        messages: [],
        loading: false,
      };

      if (!permittedChatId) {
        return of(emptyState);
      }

      return this.directThreadService.observeMessages$(permittedChatId).pipe(
        map((messages): DirectThreadState => ({
          chatId: permittedChatId,
          messages: Array.isArray(messages) ? messages : [],
          loading: false,
        })),
        startWith(emptyState),
        catchError((error) => {
          this.reportSilent(error, 'DirectThreadFacade.state$');
          return of(emptyState);
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly messages$: Observable<Message[]> = this.state$.pipe(
    map((state) => state.messages),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly directChatFacade: DirectChatFacade,
    private readonly directThreadService: DirectThreadService,
    private readonly directReceiptsService: DirectReceiptsService,
    private readonly authSession: AuthSessionService,
    private readonly accessControl: AccessControlService,
    private readonly applicationError: ApplicationErrorService,
    private readonly privacyDebug: PrivacyDebugLoggerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Envia mensagem para a thread atualmente selecionada.
   */
  sendMessage$(content: string): Observable<string | null> {
    const safeContent = (content ?? '').trim();
    if (!safeContent) {
      return of(null);
    }

    return combineLatest([
      this.activeChatId$.pipe(take(1)),
      this.canSend$.pipe(take(1)),
    ]).pipe(
      switchMap(([chatId, canSend]) => {
        if (!chatId || !canSend) {
          return of(null);
        }

        return this.directThreadService.sendMessage$(chatId, safeContent);
      })
    );
  }

  /**
   * Exclui mensagem da thread atualmente selecionada.
   */
  deleteMessage$(messageId: string): Observable<void> {
    const safeMessageId = (messageId ?? '').trim();
    if (!safeMessageId) {
      return of(void 0);
    }

    return combineLatest([
      this.activeChatId$.pipe(take(1)),
      this.canOpen$.pipe(take(1)),
    ]).pipe(
      switchMap(([chatId, canOpen]) => {
        if (!chatId || !canOpen) {
          return of(void 0);
        }

        return this.directThreadService.deleteMessage$(chatId, safeMessageId);
      }),
      catchError((error) => {
        this.reportSilent(error, 'DirectThreadFacade.deleteMessage$');
        return of(void 0);
      })
    );
  }

  /**
   * Marca mensagens visíveis como lidas.
   *
   * Best-effort:
   * - exige chat ativo
   * - exige uid autenticado
   * - exige thread válida
   */
  markVisibleMessagesAsRead$(messages: Message[]): Observable<number> {
    const safeMessages = Array.isArray(messages) ? messages : [];

    if (!safeMessages.length) {
      return of(0);
    }

    return combineLatest([
      this.activeChatId$.pipe(take(1)),
      this.authSession.uid$.pipe(take(1)),
      this.canOpen$.pipe(take(1)),
    ]).pipe(
      switchMap(([chatId, currentUid, canOpen]) => {
        if (!chatId || !currentUid || !canOpen) {
          return of(0);
        }

        return this.directReceiptsService.markDeliveredAsRead$(
          chatId,
          currentUid,
          safeMessages
        );
      }),
      catchError((error) => {
        this.reportSilent(error, 'DirectThreadFacade.markVisibleMessagesAsRead$');
        return of(0);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

private dbg(message: string, extra?: unknown): void {
  this.privacyDebug.log('chat', `DirectThreadFacade: ${message}`, extra);
}

  private reportSilent(error: unknown, context: string): void {
    try {
      this.applicationError.report(error, {
        feature: 'direct-thread',
        operation: context,
        fallbackMessage:
          'Não foi possível concluir uma operação interna da conversa direta.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'DirectThreadFacade',
          context,
        },
      });
    } catch {
      // Diagnóstico secundário não pode interromper os fallbacks reativos.
    }
  }
}
