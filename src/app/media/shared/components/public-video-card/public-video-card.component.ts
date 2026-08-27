import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { PublicVideoMetadataPreloadDirective } from 'src/app/media/videos/public-video-metadata-preload.directive';
import { PublicMediaEngagementActionsComponent } from '../public-media-engagement-actions/public-media-engagement-actions.component';

export type TPublicVideoCardVariant = 'feed' | 'highlight';

@Component({
  selector: 'app-public-video-card',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PublicVideoMetadataPreloadDirective,
    PublicMediaEngagementActionsComponent,
  ],
  templateUrl: './public-video-card.component.html',
  styleUrl: './public-video-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicVideoCardComponent {
  readonly video = input.required<IPublicVideoItem>();
  readonly variant = input<TPublicVideoCardVariant>('feed');
  readonly opening = input(false);
  readonly posterAvailable = input(true);
  readonly viewerUid = input<string | null>(null);
  readonly engagementActions = input(false);

  readonly preview = output<void>();
  readonly posterError = output<void>();
  readonly commentsRequested = output<void>();

  readonly profileLink = computed(() => [
    '/outro-perfil',
    this.video().ownerUid,
  ]);

  onPreview(): void {
    if (!this.opening()) {
      this.preview.emit();
    }
  }

  onPosterError(): void {
    this.posterError.emit();
  }

  onCommentsRequested(): void {
    this.commentsRequested.emit();
  }

  getTitle(item: IPublicVideoItem): string {
    return item.title?.trim() || item.alt?.trim() || 'Vídeo do perfil';
  }

  getOwnerName(item: IPublicVideoItem): string {
    return item.owner?.nickname?.trim() || 'Perfil público';
  }

  getOwnerInitial(item: IPublicVideoItem): string {
    return this.getOwnerName(item).charAt(0).toLocaleUpperCase('pt-BR') || 'P';
  }

  getPublishedLabel(item: IPublicVideoItem): string {
    const publishedAt = Number(item.publishedAt ?? 0);

    if (!Number.isFinite(publishedAt) || publishedAt <= 0) {
      return 'Publicado';
    }

    const diffMs = Math.max(0, Date.now() - publishedAt);
    const minutes = Math.floor(diffMs / 60_000);

    if (minutes < 1) return 'agora';
    if (minutes < 60) return `há ${minutes} min`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `há ${hours} h`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `há ${days} dia${days > 1 ? 's' : ''}`;

    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(publishedAt));
  }

  formatDuration(durationMs: number | null | undefined): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(Number(durationMs ?? 0) / 1000)
    );

    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      return 'Vídeo';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return [hours, minutes, seconds]
        .map((value, position) =>
          position === 0 ? String(value) : String(value).padStart(2, '0')
        )
        .join(':');
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  formatCount(value: number | null | undefined): string {
    const parsed = Number(value ?? 0);
    const count = Number.isFinite(parsed) && parsed > 0
      ? Math.trunc(parsed)
      : 0;

    return count.toLocaleString('pt-BR');
  }

  getPreviewAriaLabel(item: IPublicVideoItem): string {
    const title = this.getTitle(item);
    return this.opening()
      ? `Abrindo ${title}.`
      : `Assistir ${title}.`;
  }
}
