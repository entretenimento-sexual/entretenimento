// src/app/messaging/direct-chat/services/direct-chat.service.ts
// ============================================================================
// DIRECT CHAT SERVICE
//
// Responsabilidade deste service:
// - expor a lista de chats diretos 1:1
// - resolver/criar um chat direto entre o usuário autenticado e outro perfil
// - delegar enrichment legado necessário ao ChatService
//
// NÃO é responsabilidade deste service:
// - observar mensagens da thread
// - enviar/deletar mensagens
// - navegar
//
// Observação:
// - este service faz a ponte entre a arquitetura nova (direct-chat)
//   e o serviço legado de chat 1:1
// ============================================================================
import { Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { combineLatest, defer, from, Observable, of } from 'rxjs';
import {
  catchError,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';

import { ChatService } from '@core/services/batepapo/chat-service/chat.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

interface EnsureDirectChatPayload {
  otherUserUid: string;
}

interface EnsureDirectChatResponse {
  chatId: string;
  created: boolean;
  resolution:
    | 'registered'
    | 'legacy-adopted'
    | 'deterministic-recovered'
    | 'created';
}

@Injectable({ providedIn: 'root' })
export class DirectChatService {
  private readonly ensureDirectChatCallable = httpsCallable<
    EnsureDirectChatPayload,
    EnsureDirectChatResponse
  >(this.functions, 'ensureDirectChat');

  constructor(
    private readonly chatService: ChatService,
    private readonly functions: Functions,
    private readonly authSession: AuthSessionService,
    private readonly accessControl: AccessControlService,
    private readonly applicationError: ApplicationErrorService,
    private readonly errorNotifier: ErrorNotificationService
  ) {}

  /**
   * Lista apenas chats diretos 1:1.
   * Não traz salas.
   */
/**
 * Lista chats diretos 1:1 em tempo real.
 *
 * Regra desta versão:
 * - usa watchChats$ para refletir novas mensagens e novos chats sem depender
 *   de cache local;
 * - mantém filtro contra salas;
 * - respeita gate de realtime e autenticação;
 * - retorna [] em estado bloqueado, deslogado ou erro.
 */
getMyDirectChats$(): Observable<IChat[]> {
  return combineLatest([
    this.accessControl.canListenRealtime$,
    this.authSession.uid$,
  ]).pipe(
    switchMap(([canListen, uid]) => {
      const safeUid = (uid ?? '').trim();

      if (!canListen || !safeUid) {
        return of([] as IChat[]);
      }

      return this.chatService.watchChats$(safeUid, 50).pipe(
        map((items) => {
          return (items ?? []).filter((chat) => !chat?.isRoom);
        }),
        // ChatService já é o dono do diagnóstico do transporte realtime.
        // Aqui apenas convertemos o rethrow em fallback do adapter.
        catchError(() => of([] as IChat[]))
      );
    }),

    catchError((error) => {
      this.reportSilent(error, 'DirectChatService.getMyDirectChats$');
      return of([] as IChat[]);
    }),

    shareReplay({ bufferSize: 1, refCount: true })
  );
}

  /**
   * Resolve ou cria o chat direto 1:1 com outro usuário.
   *
   * Regras:
   * - exige uid autenticado
   * - não permite abrir chat consigo mesmo
   */
  ensureDirectChatIdWithUser$(otherUserUid: string): Observable<string | null> {
    const safeOtherUid = (otherUserUid ?? '').trim();
    if (!safeOtherUid) {
      return of(null);
    }

    return this.authSession.uid$.pipe(
      take(1),
      switchMap((currentUid) => {
        const safeCurrentUid = (currentUid ?? '').trim();

        if (!safeCurrentUid) {
          this.notifyUser('Você precisa estar autenticado para abrir este chat.');
          return of(null);
        }

        if (safeCurrentUid === safeOtherUid) {
          this.notifyUser('Não é possível abrir um chat com o próprio perfil.');
          return of(null);
        }

return defer(() =>
  from(
    this.ensureDirectChatCallable({
      otherUserUid: safeOtherUid,
    })
  )
).pipe(
  map((result) => {
    const chatId = String(result.data?.chatId ?? '').trim();

    if (!chatId) {
      throw new Error('Resposta inválida ao abrir conversa direta.');
    }

    return chatId;
  }),

  catchError((error) => {
    this.reportOpenChatError(error);
    return of(null);
  })
);
      }),
      catchError((error) => {
        this.reportSilent(error, 'DirectChatService.ensureDirectChatIdWithUser$');
        return of(null);
      })
    );
  }

  refreshParticipantDetailsIfNeeded(chatId: string): void {
    const safeChatId = (chatId ?? '').trim();
    if (!safeChatId) return;

    try {
      this.chatService.refreshParticipantDetailsIfNeeded(safeChatId);
    } catch (error) {
      this.reportSilent(
        error,
        'DirectChatService.refreshParticipantDetailsIfNeeded'
      );
    }
  }

  private getOpenChatUserMessage(error: unknown): string {
  const code = String(
    (error as { code?: unknown } | null)?.code ?? ''
  ).toLowerCase();

  const message = String(
    (error as { message?: unknown } | null)?.message ?? ''
  ).toLowerCase();

  if (code.includes('unauthenticated')) {
    return 'Entre novamente para iniciar uma conversa.';
  }

  if (code.includes('failed-precondition')) {
    if (message.includes('conexão precisa estar aceita')) {
      return 'Vocês precisam estar conectados para iniciar uma conversa.';
    }

    if (message.includes('verifique seu e-mail')) {
      return 'Verifique seu e-mail antes de iniciar conversas.';
    }

    return 'Não foi possível iniciar a conversa nas condições atuais.';
  }

  if (code.includes('permission-denied')) {
    return 'Esta conversa não está disponível.';
  }

  return 'Não foi possível abrir a conversa agora.';
}

  private reportOpenChatError(error: unknown): void {
    const userMessage = this.getOpenChatUserMessage(error);

    try {
      this.applicationError.report(error, {
        feature: 'direct-chat',
        operation: 'DirectChatService.ensureDirectChatIdWithUser$',
        fallbackMessage: userMessage,
        codeMessages: {
          unauthenticated: userMessage,
          'failed-precondition': userMessage,
          'permission-denied': userMessage,
        },
        presentation: { surface: 'snackbar', severity: 'error' },
        metadata: {
          scope: 'DirectChatService',
          context: 'DirectChatService.ensureDirectChatIdWithUser$',
        },
      });
    } catch {
      // Se a camada canônica falhar antes de apresentar a UX, mantém feedback.
      this.notifyUser(userMessage);
    }
  }

  private reportSilent(error: unknown, context: string): void {
    try {
      this.applicationError.report(error, {
        feature: 'direct-chat',
        operation: context,
        fallbackMessage:
          'Não foi possível concluir uma operação interna do chat direto.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'DirectChatService',
          context,
        },
      });
    } catch {
      // Diagnóstico secundário nunca interrompe os fallbacks do serviço.
    }
  }

  protected notifyUser(message: string): void {
    try {
      this.errorNotifier.showError(message);
    } catch {
      // noop
    }
  }
}
