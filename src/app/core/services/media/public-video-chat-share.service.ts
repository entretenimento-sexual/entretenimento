import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, takeUntil } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';


import { MediaApplicationErrorService } from './media-application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

interface SendDirectVideoReferenceRequest {
  chatId: string;
  expectedActorUid: string;
  clientRequestId: string;
  publicVideoReference: {
    ownerUid: string;
    videoId: string;
  };
}

interface SendDirectVideoReferenceResponse {
  chatId: string;
  messageId: string;
  deduplicated: boolean;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

@Injectable({ providedIn: 'root' })
export class PublicVideoChatShareService {
  private readonly functions = inject(Functions);
  private readonly authSession = inject(AuthSessionService);
  private readonly session = toSignal(this.authSession.uid$.pipe(
    distinctUntilChanged(), map(uid => ({ uid }))
  ), { initialValue: { uid: null } });
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(MediaApplicationErrorService);
  private readonly callable = httpsCallable<
    SendDirectVideoReferenceRequest,
    SendDirectVideoReferenceResponse
  >(this.functions, 'sendDirectVideoReference');

  /**
   * MANUTENÇÃO — RESTRIÇÃO FUTURA POR ASSINATURA/AUDIÊNCIA
   *
   * Este cliente envia somente IDs. Nunca decidir entitlement aqui e nunca
   * anexar URL assinada. Quando SUBSCRIBERS/PREMIUM forem ativados, a callable
   * e o playback continuarão responsáveis por revalidar o acesso do receptor.
   */
  sendToChat$(params: {
    chatId: string;
    expectedActorUid: string;
    ownerUid: string;
    videoId: string;
  }): Observable<string | null> {
    const session = this.session();
    const expectedActorUid = this.normalizeId(params.expectedActorUid);
    if (!expectedActorUid || session.uid !== expectedActorUid) return of(null);
    const chatId = this.normalizeId(params.chatId);
    const ownerUid = this.normalizeId(params.ownerUid);
    const videoId = this.normalizeId(params.videoId);

    if (!chatId || !ownerUid || !videoId) {
      this.errorNotification.showWarning(
        'Não foi possível preparar este vídeo para a conversa.'
      );
      return of(null);
    }

    return defer(() => {
      // Cold requests prepared by an old session must not dispatch after relogin.
      if (this.session() !== session) return of(null);
      return defer(() => from(this.callable({
        chatId,
        expectedActorUid,
        clientRequestId: this.createClientRequestId(),
        publicVideoReference: { ownerUid, videoId },
      }))).pipe(
        takeUntil(this.authSession.uid$.pipe(filter(uid => uid !== expectedActorUid))),
        map(result => this.session() === session && result.data?.chatId === chatId
          ? String(result.data?.messageId ?? '').trim() || null : null),
        catchError((error: unknown) => {
          if (this.session() === session) this.reportError(error, { chatId, ownerUid, videoId });
          return of(null);
        })
      );
    });
  }

  private normalizeId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
  }

  private createClientRequestId(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid || [
      'video_share',
      Date.now().toString(36),
      Math.random().toString(36).slice(2),
    ].join('_');
  }

  private resolveUserMessage(error: unknown): string {
    const code = String(
      (error as { code?: unknown } | null)?.code ?? ''
    ).toLowerCase();
    const message = String(
      (error as { message?: unknown } | null)?.message ?? ''
    ).toLowerCase();

    if (code.includes('failed-precondition')) {
      if (message.includes('conexão')) {
        return 'Vocês precisam estar conectados para compartilhar vídeos.';
      }
      if (message.includes('disponível')) {
        return 'Este vídeo não está mais disponível para compartilhamento.';
      }
      return 'A conversa não permite este compartilhamento agora.';
    }
    if (code.includes('resource-exhausted')) {
      return 'Muitas mensagens em pouco tempo. Aguarde antes de enviar novamente.';
    }

    if (code.includes('permission-denied')) {
      return 'Esta conversa não está disponível.';
    }
    if (code.includes('unauthenticated')) {
      return 'Entre novamente para compartilhar o vídeo.';
    }
    return 'Não foi possível enviar o vídeo na conversa.';
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    this.globalErrorHandler.report(error, {
      operation: 'sendToChat$',
      fallbackMessage: this.resolveUserMessage(error),
      metadata: {
        scope: 'PublicVideoChatShareService',
        ...context,
      },
    });
  }
}
