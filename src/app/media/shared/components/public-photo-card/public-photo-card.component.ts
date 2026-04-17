// src/app/media/photos/shared/public-photo-card/public-photo-card.component.ts
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';

export type TPublicPhotoCardVariant = 'profile' | 'latest' | 'top' | 'boosted';

@Component({
  selector: 'app-public-photo-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './public-photo-card.component.html',
  styleUrls: ['./public-photo-card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicPhotoCardComponent {
  readonly photo = input.required<IPublicPhotoItem>();
  readonly variant = input<TPublicPhotoCardVariant>('profile');

  readonly preview = output<void>();

  readonly galleryLink = computed(() => [
    '/media',
    'perfil',
    this.photo().ownerUid,
    'fotos-publicas',
  ]);

  onPreview(): void {
    this.preview.emit();
  }
}