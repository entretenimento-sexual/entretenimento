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
import { combineLatest, Observable, of } from 'rxjs';
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
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class DirectChatService {
  constructor(
    private readonly chatService: ChatService,
    private readonly authSession: AuthSessionService,
    private readonly accessControl: AccessControlService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) {}

  /**
   * Lista apenas chats diretos 1:1.
   * Não traz salas.
   */
  getMyDirectChats$(): Observable<IChat[]> {
    return combineLatest([
      this.accessControl.canListenRealtime$,
      this.authSession.uid$,
    ]).pipe(
      switchMap(([canListen, uid]) => {
        if (!canListen || !uid) {
          return of([] as IChat[]);
        }

        return this.chatService.getChats(uid).pipe(
          map((items) => (items ?? []).filter((chat) => !chat?.isRoom))
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

        return this.chatService
          .getOrCreateChatId([safeCurrentUid, safeOtherUid])
          .pipe(
            catchError((error) => {
              this.reportSilent(
                error,
                'DirectChatService.ensureDirectChatIdWithUser$'
              );
              this.notifyUser('Não foi possível abrir a conversa agora.');
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

  private reportSilent(error: unknown, context: string): void {
    try {
      const err =
        error instanceof Error
          ? error
          : new Error('[DirectChatService] operation failed');

      (err as any).original = error;
      (err as any).context = context;
      (err as any).skipUserNotification = true;
      (err as any).silent = true;

      this.globalErrorHandler.handleError(err);
    } catch {
      // noop
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
