import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';

@Component({
  selector: 'app-public-video-feed-card',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './public-video-feed-card.component.html',
  styleUrl: './public-video-feed-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicVideoFeedCardComponent {
  readonly video = input.required<IPublicVideoItem>();
  readonly previewRequested = output<IPublicVideoItem>();
  readonly posterFailed = signal(false);

  openVideo(): void {
    this.previewRequested.emit(this.video());
  }

  onPosterError(): void {
    this.posterFailed.set(true);
  }

  hasPoster(): boolean {
    return !!this.video().posterUrl?.trim() && !this.posterFailed();
  }

  titleId(): string {
    return `feed-video-title-${this.video().ownerUid}-${this.video().id}`;
  }

  ownerName(): string {
    return this.video().owner?.nickname?.trim() || 'Perfil';
  }

  ownerInitial(): string {
    return this.ownerName().slice(0, 1).toUpperCase() || '?';
  }

  ownerLocation(): string | null {
    const owner = this.video().owner;
    const parts = [owner?.municipio, owner?.estado]
      .map((value) => value?.trim())
      .filter((value): value is string => !!value);

    return parts.length ? parts.join(' · ') : null;
  }

  videoTitle(): string {
    return this.video().title?.trim() || 'Vídeo do perfil';
  }

  openAriaLabel(): string {
    return `Assistir ${this.videoTitle()}, publicado por ${this.ownerName()}.`;
  }

  formatDuration(): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(Number(this.video().durationMs ?? 0) / 1000)
    );

    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      return 'Vídeo';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return [hours, minutes, seconds]
        .map((value, index) => index === 0
          ? String(value)
          : String(value).padStart(2, '0'))
        .join(':');
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  formatCount(value: number | null | undefined): string {
    const count = Number(value ?? 0);
    const normalized = Number.isFinite(count) && count > 0
      ? Math.trunc(count)
      : 0;

    return normalized.toLocaleString('pt-BR');
  }
}
