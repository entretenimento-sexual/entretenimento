// src/app/media/photos/shared/public-photo-card/public-photo-card.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';

export type TPublicPhotoCardVariant =
  | 'profile'
  | 'feed'
  | 'latest'
  | 'top'
  | 'boosted';

@Component({
  selector: 'app-public-photo-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './public-photo-card.component.html',
  styleUrls: [
    './public-photo-card.component.css',
    './public-photo-card.feed.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicPhotoCardComponent {
  readonly photo = input.required<IPublicPhotoItem>();
  readonly variant = input<TPublicPhotoCardVariant>('profile');

  readonly preview = output<void>();

  readonly profileLink = computed(() => [
    '/outro-perfil',
    this.photo().ownerUid,
  ]);

  onPreview(): void {
    this.preview.emit();
  }

  getOwnerName(item: IPublicPhotoItem): string {
    return item.ownerNickname?.trim() || 'Perfil';
  }

  getOwnerInitial(item: IPublicPhotoItem): string {
    return this.getOwnerName(item).charAt(0).toLocaleUpperCase('pt-BR') || 'P';
  }

  getOwnerMeta(item: IPublicPhotoItem): string | null {
    const parts = [item.ownerGender, item.ownerOrientation]
      .map((value) => value?.trim())
      .filter(Boolean);

    return parts.length ? parts.join(' • ') : null;
  }

  getOwnerLocation(item: IPublicPhotoItem): string | null {
    const parts = [item.ownerMunicipio, item.ownerEstado]
      .map((value) => value?.trim())
      .filter(Boolean);

    return parts.length ? parts.join(', ') : null;
  }

  getPublishedLabel(item: IPublicPhotoItem): string {
    const publishedAt = this.toMillis(item.publishedAt);

    if (!publishedAt) {
      return 'Publicada';
    }

    const diffMs = Math.max(0, Date.now() - publishedAt);
    const minutes = Math.floor(diffMs / 60_000);

    if (minutes < 1) return 'agora';
    if (minutes < 60) return `há ${minutes} min`;

    const hours = Math.floor(minutes / 60);

    if (hours < 24) return `há ${hours} h`;

    const days = Math.floor(hours / 24);

    if (days < 7) {
      return `há ${days} dia${days > 1 ? 's' : ''}`;
    }

    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(publishedAt));
  }

  private toMillis(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();

    const maybeTimestamp = value as
      | { toMillis?: () => number }
      | null
      | undefined;

    if (typeof maybeTimestamp?.toMillis === 'function') {
      return maybeTimestamp.toMillis();
    }

    return 0;
  }
}
