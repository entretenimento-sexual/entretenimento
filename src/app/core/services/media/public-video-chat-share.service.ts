import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

interface SendDirectVideoReferenceRequest {
  chatId: string;
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
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly callable = httpsCallable<
    SendDirectVideoReferenceRequest,
    SendDirectVideoReferenceResponse
  >(this.functions, 'sendDirectVideoReference');

  /**
   * O cliente envia somente IDs. Entitlement, lifecycle, bloqueios e audiência
   * são avaliados no backend para remetente e destinatário. A mensagem nunca
   * recebe URL assinada, path, título mutável ou snapshot financeiro.
   */
  sendToChat$(params: {
    chatId: string;
    ownerUid: string;
    videoId: string;
  }): Observable<string | null> {
    const chatId = this.normalizeId(params.chatId);
    const ownerUid = this.normalizeId(params.ownerUid);
    const videoId = this.normalizeId(params.videoId);

    if (!chatId || !ownerUid || !videoId) {
      this.errorNotification.showWarning(
        'Não foi possível preparar este vídeo para a conversa.'
      );
      return of(null);
    }

    return defer(() => from(this.callable({
      chatId,
      clientRequestId: this.createClientRequestId(),
      publicVideoReference: { ownerUid, videoId },
    }))).pipe(
      map((result) => String(result.data?.messageId ?? '').trim() || null),
      catchError((error: unknown) => {
        this.reportError(error, { chatId, ownerUid, videoId });
        this.errorNotification.showError(
          this.resolveUserMessage(error)
        );
        return of(null);
      })
    );
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
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      details?: {
        perspective?: unknown;
        reason?: unknown;
      };
    } | null;
    const code = String(candidate?.code ?? '').toLowerCase();
    const message = String(candidate?.message ?? '').toLowerCase();
    const perspective = String(
      candidate?.details?.perspective ?? ''
    ).toLowerCase();

    if (perspective === 'recipient' || message.includes('destinatário')) {
      return 'O destinatário não pode acessar este vídeo.';
    }
    if (code.includes('failed-precondition')) {
      if (message.includes('conexão')) {
        return 'Vocês precisam estar conectados para compartilhar vídeos.';
      }
      if (message.includes('disponível')) {
        return 'Este vídeo não está mais disponível para compartilhamento.';
      }
      return 'A conversa não permite este compartilhamento agora.';
    }
    if (code.includes('permission-denied')) {
      if (message.includes('audiência') || message.includes('compartilhar')) {
        return 'Você não possui acesso para compartilhar este vídeo.';
      }
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
    try {
      const normalized = error instanceof Error
        ? new Error(error.message)
        : new Error('Falha ao enviar referência de vídeo.');
      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PublicVideoChatShareService',
        op: 'sendToChat$',
        ...context,
      };
      (normalized as any).skipUserNotification = true;
      this.globalErrorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
