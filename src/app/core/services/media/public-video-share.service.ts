import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export type PublicVideoShareOutcome =
  | 'shared'
  | 'copied'
  | 'cancelled'
  | 'failed';

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function normalizeId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
}

export function buildPublicVideoCanonicalPath(
  ownerUidValue: unknown,
  videoIdValue: unknown
): string | null {
  const ownerUid = normalizeId(ownerUidValue);
  const videoId = normalizeId(videoIdValue);

  return ownerUid && videoId
    ? `/media/video/${ownerUid}/${videoId}`
    : null;
}

@Injectable({ providedIn: 'root' })
export class PublicVideoShareService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  async sharePublicVideo(
    video: Pick<IPublicVideoItem, 'id' | 'ownerUid'>
  ): Promise<PublicVideoShareOutcome> {
    const canonicalPath = buildPublicVideoCanonicalPath(
      video?.ownerUid,
      video?.id
    );

    if (!canonicalPath || !isPlatformBrowser(this.platformId)) {
      this.errorNotification.showWarning(
        'Este vídeo não possui um link compartilhável.'
      );
      return 'failed';
    }

    const canonicalUrl = this.buildAbsoluteUrl(canonicalPath);
    const navigatorRef = this.document.defaultView?.navigator;

    if (!navigatorRef) {
      this.errorNotification.showError(
        'Não foi possível compartilhar este vídeo agora.'
      );
      return 'failed';
    }

    const shareData: ShareData = {
      title: 'Vídeo compartilhado',
      text: 'Confira este vídeo compartilhado na plataforma.',
      url: canonicalUrl,
    };

    try {
      if (this.canUseNativeShare(navigatorRef, shareData)) {
        await navigatorRef.share(shareData);
        this.errorNotification.showSuccess('Vídeo compartilhado.');
        return 'shared';
      }

      await this.copyText(navigatorRef, canonicalUrl);
      this.errorNotification.showSuccess('Link do vídeo copiado.');
      return 'copied';
    } catch (error) {
      if (this.isShareCancellation(error)) {
        return 'cancelled';
      }

      this.reportError(error);
      this.errorNotification.showError(
        'Não foi possível compartilhar este vídeo agora.'
      );
      return 'failed';
    }
  }

  private buildAbsoluteUrl(path: string): string {
    const origin = String(this.document.location?.origin ?? '').trim();

    if (!origin || origin === 'null') {
      return path;
    }

    return `${origin}${path}`;
  }

  private canUseNativeShare(
    navigatorRef: Navigator,
    data: ShareData
  ): navigatorRef is Navigator & {
    share: (shareData?: ShareData) => Promise<void>;
  } {
    if (typeof navigatorRef.share !== 'function') {
      return false;
    }

    if (typeof navigatorRef.canShare !== 'function') {
      return true;
    }

    try {
      return navigatorRef.canShare(data);
    } catch {
      return false;
    }
  }

  private async copyText(
    navigatorRef: Navigator,
    text: string
  ): Promise<void> {
    if (navigatorRef.clipboard?.writeText) {
      await navigatorRef.clipboard.writeText(text);
      return;
    }

    const textarea = this.document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.position = 'fixed';
    textarea.style.inset = '-9999px auto auto -9999px';

    this.document.body.appendChild(textarea);
    textarea.select();

    const copied = this.document.execCommand('copy');
    textarea.remove();

    if (!copied) {
      throw new Error('O navegador recusou a cópia do link.');
    }
  }

  private isShareCancellation(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  private reportError(error: unknown): void {
    try {
      const normalized = error instanceof Error
        ? new Error(error.message)
        : new Error('Falha ao compartilhar vídeo público.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PublicVideoShareService',
        op: 'sharePublicVideo',
      };
      (normalized as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
