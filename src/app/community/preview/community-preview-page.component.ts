// src/app/community/preview/community-preview-page.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  catchError,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import {
  CommunityPreviewCard,
  CommunityPreviewResponse,
  CommunityPreviewViewerMode,
} from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';

type CommunityPreviewState =
  | { status: 'loading'; preview: null }
  | { status: 'ready'; preview: CommunityPreviewResponse }
  | { status: 'error'; preview: null };

@Component({
  selector: 'app-community-preview-page',
  standalone: true,
  imports: [AsyncPipe, RouterLink, ImageFallbackDirective],
  templateUrl: './community-preview-page.component.html',
  styleUrl: './community-preview-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityPreviewPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly repository = inject(CommunityPreviewRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  readonly state$ = this.route.paramMap.pipe(
    map((params) => String(params.get('communityId') ?? '').trim()),
    switchMap((communityId) => {
      if (!communityId) {
        throw new Error('Identificador de comunidade ausente.');
      }

      return this.repository.getPreview$(communityId).pipe(
        map(
          (preview): CommunityPreviewState => ({
            status: 'ready',
            preview,
          })
        ),
        startWith<CommunityPreviewState>({ status: 'loading', preview: null })
      );
    }),
    catchError((error: unknown) => {
      this.reportError(error);
      return of<CommunityPreviewState>({ status: 'error', preview: null });
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  sourceLabel(community: CommunityPreviewCard): string {
    return community.source.type === 'venue' ? 'Local' : 'Sala';
  }

  viewerLabel(mode: CommunityPreviewViewerMode): string {
    const labels: Record<CommunityPreviewViewerMode, string> = {
      visitor: 'Visitante',
      pending: 'Pendente',
      member: 'Membro',
      moderator: 'Moderação',
      manager: 'Gestão',
    };

    return labels[mode];
  }

  accessLabel(community: CommunityPreviewCard): string | null {
    if (!community.access.requiresActiveSubscription) return null;

    const minimumRole = community.access.minimumRole;
    return minimumRole === 'vip'
      ? 'VIP'
      : minimumRole === 'premium'
        ? 'Premium'
        : 'Assinantes';
  }

  private reportError(error: unknown): void {
    try {
      this.errorNotifier.showError('Não foi possível abrir esta comunidade.');
    } catch {
      // O diagnóstico técnico abaixo permanece ativo.
    }

    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityPreviewPageComponent',
        op: 'loadPreview',
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
