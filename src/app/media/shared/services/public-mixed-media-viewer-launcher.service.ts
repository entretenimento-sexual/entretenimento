import { Injectable, inject } from '@angular/core';
import { Observable, defer, of, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import type {
  IPublicMediaViewerMixedNavigation,
  OpenPublicMixedMediaViewerRequest,
} from 'src/app/core/interfaces/media/i-public-media-viewer-session';
import {
  IPublicProfileMediaItem,
  isPublicPhotoItem,
  isPublicVideoItem,
} from 'src/app/core/interfaces/media/i-public-profile-media-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicMixedMediaContinuationService } from 'src/app/core/services/media/public-mixed-media-continuation.service';
import { buildPublicMediaIdentity } from 'src/app/core/utils/media/public-media-identity';
import { PublicPhotoViewerLauncherService } from 'src/app/media/photos/photo-viewer/public-photo-viewer-launcher.service';
import { PublicVideoViewerLauncherService } from 'src/app/media/videos/public-video-viewer/public-video-viewer-launcher.service';

interface MixedMediaRun {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly items: readonly IPublicProfileMediaItem[];
  readonly navigation: IPublicMediaViewerMixedNavigation;
}

interface MixedMediaSession {
  readonly items: IPublicProfileMediaItem[];
  continuationExhausted: boolean;
}

const MIXED_CONTINUATION_LIMIT = 8;

/**
 * Preserva a ordem mista já calculada pela superfície de descoberta e expande
 * a sessão sob demanda quando o usuário alcança o fim da fila carregada.
 *
 * Cada dialog recebe somente o trecho contíguo do seu tipo. Quando o usuário
 * cruza uma fronteira PHOTO/VIDEO, o adapter devolve um handoff e esta classe
 * abre o próximo trecho sem transformar foto e vídeo em um único componente.
 */
@Injectable({ providedIn: 'root' })
export class PublicMixedMediaViewerLauncherService {
  private readonly photoViewer = inject(PublicPhotoViewerLauncherService);
  private readonly videoViewer = inject(PublicVideoViewerLauncherService);
  private readonly mixedContinuation = inject(PublicMixedMediaContinuationService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  open$(request: OpenPublicMixedMediaViewerRequest): Observable<void> {
    return defer(() => {
      const session: MixedMediaSession = {
        items: this.normalizeItems(request.items),
        continuationExhausted: false,
      };
      const selectedKey = this.mediaKey(request.selected);
      const selectedIndex = session.items.findIndex(
        (item) => this.mediaKey(item) === selectedKey
      );

      if (!selectedKey || selectedIndex < 0) {
        return throwError(() => new Error(
          'Mídia pública não está mais disponível nesta sequência.'
        ));
      }

      return this.openFromIndex$(session, selectedIndex, request);
    }).pipe(
      catchError((error: unknown) => {
        this.reportError(error, request, 'open$');
        return throwError(() => error);
      })
    );
  }

  private openFromIndex$(
    session: MixedMediaSession,
    selectedIndex: number,
    request: OpenPublicMixedMediaViewerRequest
  ): Observable<void> {
    const selected = session.items[selectedIndex] ?? null;

    if (!selected) {
      return of(void 0);
    }

    const run = this.resolveRun(session, selectedIndex);
    const result$ = isPublicVideoItem(selected)
      ? this.videoViewer.openWithResult$({
          items: run.items.filter(isPublicVideoItem),
          startIndex: selectedIndex - run.startIndex,
          source: request.source,
          continuationContext: request.continuationContext,
          mixedNavigation: run.navigation,
        })
      : this.photoViewer.openWithResult$({
          items: run.items.filter(isPublicPhotoItem),
          selected,
          source: request.source,
          continuationContext: request.continuationContext,
          mixedNavigation: run.navigation,
        });

    return result$.pipe(
      switchMap((result) => {
        if (!result || result.kind !== 'mixed-handoff') {
          return of(void 0);
        }

        if (result.direction === 'previous') {
          const previousIndex = run.startIndex - 1;
          return previousIndex >= 0
            ? this.openFromIndex$(session, previousIndex, request)
            : of(void 0);
        }

        const nextIndex = run.endIndex + 1;
        if (nextIndex < session.items.length) {
          return this.openFromIndex$(session, nextIndex, request);
        }

        if (session.continuationExhausted) {
          return of(void 0);
        }

        return this.continueAfterEnd$(session, request);
      })
    );
  }

  private continueAfterEnd$(
    session: MixedMediaSession,
    request: OpenPublicMixedMediaViewerRequest
  ): Observable<void> {
    const previousLength = session.items.length;

    return this.mixedContinuation.loadContinuation$({
      existingItems: [...session.items],
      source: request.source,
      limit: MIXED_CONTINUATION_LIMIT,
      continuationContext: request.continuationContext,
    }).pipe(
      switchMap((result) => {
        if (result.exhausted) {
          session.continuationExhausted = true;
        }

        const appendedCount = this.appendContinuationItems(
          session,
          result.items
        );

        if (appendedCount > 0) {
          return this.openFromIndex$(session, previousLength, request);
        }

        if (result.failed) {
          this.reportHandledContinuationFailure(request, session.items.length);
          this.errorNotification.showWarning(
            'Não foi possível carregar mais mídias agora. Tente novamente mais tarde.'
          );
          return of(void 0);
        }

        session.continuationExhausted = true;
        this.errorNotification.showInfo(
          'Você chegou ao fim das mídias públicas disponíveis agora.'
        );
        return of(void 0);
      }),
      catchError((error: unknown) => {
        this.reportError(error, request, 'loadContinuation$');
        this.errorNotification.showWarning(
          'Não foi possível carregar mais mídias agora. Tente novamente mais tarde.'
        );
        return of(void 0);
      })
    );
  }

  private resolveRun(
    session: MixedMediaSession,
    selectedIndex: number
  ): MixedMediaRun {
    const items = session.items;
    const selected = items[selectedIndex];
    const selectedIsVideo = isPublicVideoItem(selected);
    let startIndex = selectedIndex;
    let endIndex = selectedIndex;

    while (
      startIndex > 0 &&
      isPublicVideoItem(items[startIndex - 1]) === selectedIsVideo
    ) {
      startIndex -= 1;
    }

    while (
      endIndex < items.length - 1 &&
      isPublicVideoItem(items[endIndex + 1]) === selectedIsVideo
    ) {
      endIndex += 1;
    }

    return {
      startIndex,
      endIndex,
      items: items.slice(startIndex, endIndex + 1),
      navigation: {
        hasPrevious: startIndex > 0,
        hasNext:
          endIndex < items.length - 1 || !session.continuationExhausted,
      },
    };
  }

  private appendContinuationItems(
    session: MixedMediaSession,
    candidates: readonly IPublicProfileMediaItem[]
  ): number {
    const seen = new Set(
      session.items.map((item) => this.mediaKey(item)).filter(Boolean)
    );
    let appendedCount = 0;

    for (const item of candidates ?? []) {
      if (!this.isOpenable(item)) {
        continue;
      }

      const key = this.mediaKey(item);
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      session.items.push(item);
      appendedCount += 1;
    }

    return appendedCount;
  }

  private normalizeItems(
    input: readonly IPublicProfileMediaItem[]
  ): IPublicProfileMediaItem[] {
    const unique = new Map<string, IPublicProfileMediaItem>();

    for (const item of input ?? []) {
      if (!this.isOpenable(item)) {
        continue;
      }

      const key = this.mediaKey(item);
      if (!key || unique.has(key)) {
        continue;
      }

      unique.set(key, item);
    }

    return [...unique.values()];
  }

  private isOpenable(item: IPublicProfileMediaItem | null | undefined): boolean {
    if (!item?.id?.trim() || !item.ownerUid?.trim()) {
      return false;
    }

    if (
      item.visibility !== 'PUBLIC' ||
      item.moderationStatus !== 'APPROVED'
    ) {
      return false;
    }

    if (isPublicVideoItem(item)) {
      return true;
    }

    return !!String(item.url ?? '').trim();
  }

  private mediaKey(item: IPublicProfileMediaItem | null | undefined): string {
    if (!item) {
      return '';
    }

    return buildPublicMediaIdentity(
      isPublicVideoItem(item) ? 'VIDEO' : 'PHOTO',
      item.ownerUid,
      item.id
    );
  }

  private reportHandledContinuationFailure(
    request: OpenPublicMixedMediaViewerRequest,
    itemCount: number
  ): void {
    this.reportError(
      new Error('Continuação mista sem candidatos após falha de fonte.'),
      request,
      'loadContinuation$.degraded',
      itemCount
    );
  }

  private reportError(
    error: unknown,
    request: OpenPublicMixedMediaViewerRequest,
    operation: string,
    itemCount = request.items?.length ?? 0
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao abrir sequência pública de mídias.');
      const contextual = normalized as Error & {
        original?: unknown;
        context?: Record<string, unknown>;
        skipUserNotification?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'PublicMixedMediaViewerLauncherService',
        op: operation,
        source: request.source,
        requestedItems: itemCount,
        selectedType: isPublicVideoItem(request.selected) ? 'VIDEO' : 'PHOTO',
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha de diagnóstico não substitui o erro original.
    }
  }
}
