import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import {
  PhotoViewTrackingService,
  TPhotoViewSource,
} from 'src/app/core/services/media/photo-view-tracking.service';

@Component({
  selector: 'app-public-photo-lightbox',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './public-photo-lightbox.component.html',
  styleUrls: ['./public-photo-lightbox.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicPhotoLightboxComponent
implements AfterViewInit, OnDestroy {
  private readonly photoViewTracking = inject(PhotoViewTrackingService);

  readonly items = input.required<readonly IPublicPhotoItem[]>();
  readonly activeIndex = input<number>(0);
  readonly title = input<string>('Foto pública');
  readonly viewSource = input<TPhotoViewSource>('unknown');

  readonly closed = output<void>();
  readonly prevRequested = output<void>();
  readonly nextRequested = output<void>();

  @ViewChild('dialogRoot', { static: true })
  private dialogRoot!: ElementRef<HTMLDivElement>;

  private previouslyFocused: HTMLElement | null = null;
  private viewTrackingSubscription: Subscription | null = null;
  private activeViewKey: string | null = null;
  private readonly recordedViewKeys = new Set<string>();

  readonly currentPhoto = computed(() => {
    const collection = this.items();
    const index = this.activeIndex();
    return collection[index] ?? null;
  });

  readonly hasPrev = computed(() => this.activeIndex() > 0);
  readonly hasNext = computed(() => this.activeIndex() < this.items().length - 1);

  readonly profileLink = computed(() => {
    const photo = this.currentPhoto();
    return photo?.ownerUid ? ['/outro-perfil', photo.ownerUid] : null;
  });

  getOwnerName(photo: IPublicPhotoItem): string {
    return photo.ownerNickname?.trim() || 'Ver perfil';
  }

  getOwnerLocation(photo: IPublicPhotoItem): string | null {
    const parts = [
      photo.ownerMunicipio,
      photo.ownerEstado,
    ]
      .map((value) => value?.trim())
      .filter(Boolean);

    return parts.length ? parts.join(', ') : null;
  }

  ngAfterViewInit(): void {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    queueMicrotask(() => {
      this.dialogRoot?.nativeElement?.focus();
    });
  }

  ngOnDestroy(): void {
    this.cancelViewTracking();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  @HostListener('document:keydown.arrowleft')
  onArrowLeft(): void {
    if (this.hasPrev()) {
      this.prev();
    }
  }

  @HostListener('document:keydown.arrowright')
  onArrowRight(): void {
    if (this.hasNext()) {
      this.next();
    }
  }

  onImageLoaded(): void {
    const photo = this.currentPhoto();
    const ownerUid = String(photo?.ownerUid ?? '').trim();
    const photoId = String(photo?.id ?? '').trim();

    if (!ownerUid || !photoId) {
      return;
    }

    const viewKey = `${ownerUid}:${photoId}`;

    if (
      this.recordedViewKeys.has(viewKey) ||
      this.activeViewKey === viewKey
    ) {
      return;
    }

    this.cancelViewTracking();
    this.activeViewKey = viewKey;
    this.viewTrackingSubscription = this.photoViewTracking
      .trackQualifiedPhotoView$(ownerUid, photoId, this.viewSource())
      .subscribe({
        next: () => this.recordedViewKeys.add(viewKey),
        complete: () => {
          if (this.activeViewKey === viewKey) {
            this.activeViewKey = null;
          }
        },
      });
  }

  close(): void {
    this.cancelViewTracking();
    this.restoreFocus();
    this.closed.emit();
  }

  prev(): void {
    this.cancelViewTracking();
    this.prevRequested.emit();
  }

  next(): void {
    this.cancelViewTracking();
    this.nextRequested.emit();
  }

  private cancelViewTracking(): void {
    this.viewTrackingSubscription?.unsubscribe();
    this.viewTrackingSubscription = null;
    this.activeViewKey = null;
  }

  private restoreFocus(): void {
    if (this.previouslyFocused && typeof this.previouslyFocused.focus === 'function') {
      queueMicrotask(() => this.previouslyFocused?.focus());
    }
  }
}
