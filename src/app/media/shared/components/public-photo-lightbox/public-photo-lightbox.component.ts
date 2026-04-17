//src\app\media\shared\components\public-photo-lightbox\public-photo-lightbox.component.ts
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';

@Component({
  selector: 'app-public-photo-lightbox',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './public-photo-lightbox.component.html',
  styleUrls: ['./public-photo-lightbox.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicPhotoLightboxComponent {
  readonly items = input.required<IPublicPhotoItem[]>();
  readonly activeIndex = input<number>(0);
  readonly title = input<string>('Foto pública');

  readonly closed = output<void>();
  readonly prevRequested = output<void>();
  readonly nextRequested = output<void>();

  readonly currentPhoto = computed(() => {
    const collection = this.items();
    const index = this.activeIndex();
    return collection[index] ?? null;
  });

  readonly hasPrev = computed(() => this.activeIndex() > 0);
  readonly hasNext = computed(() => this.activeIndex() < this.items().length - 1);

  close(): void {
    this.closed.emit();
  }

  prev(): void {
    this.prevRequested.emit();
  }

  next(): void {
    this.nextRequested.emit();
  }
}