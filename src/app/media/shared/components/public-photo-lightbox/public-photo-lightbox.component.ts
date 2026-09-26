import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';

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
  readonly items = input.required<readonly IPublicPhotoItem[]>();
  readonly activeIndex = input<number>(0);
  readonly title = input<string>('Foto pública');

  readonly closed = output<void>();
  readonly prevRequested = output<void>();
  readonly nextRequested = output<void>();

  @ViewChild('dialogRoot', { static: true })
  private dialogRoot!: ElementRef<HTMLDivElement>;

  private previouslyFocused: HTMLElement | null = null;
  private previousBodyOverflow: string | null = null;

  readonly currentPhoto = computed(() => {
    const collection = this.items();
    const index = this.activeIndex();
    return collection[index] ?? null;
  });

  readonly hasPrev = computed(() => this.activeIndex() > 0);
  readonly hasNext = computed(
    () => this.activeIndex() < this.items().length - 1
  );

  readonly profileLink = computed(() => {
    const photo = this.currentPhoto();
    return photo?.ownerUid ? ['/outro-perfil', photo.ownerUid] : null;
  });

  ngAfterViewInit(): void {
    if (typeof document === 'undefined') {
      return;
    }

    this.previouslyFocused = document.activeElement as HTMLElement | null;
    this.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    queueMicrotask(() => {
      const firstFocusable = this.getFocusableElements()[0];
      (firstFocusable ?? this.dialogRoot?.nativeElement)?.focus();
    });
  }

  ngOnDestroy(): void {
    this.restoreDocumentState();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key === 'ArrowLeft' && this.hasPrev()) {
      event.preventDefault();
      this.prev();
      return;
    }

    if (event.key === 'ArrowRight' && this.hasNext()) {
      event.preventDefault();
      this.next();
      return;
    }

    if (event.key === 'Tab') {
      this.trapFocus(event);
    }
  }

  close(): void {
    this.closed.emit();
  }

  prev(): void {
    if (this.hasPrev()) {
      this.prevRequested.emit();
    }
  }

  next(): void {
    if (this.hasNext()) {
      this.nextRequested.emit();
    }
  }

  getOwnerName(photo: IPublicPhotoItem): string {
    return photo.ownerNickname?.trim() || 'Ver perfil';
  }

  getOwnerLocation(photo: IPublicPhotoItem): string | null {
    const parts = [photo.ownerMunicipio, photo.ownerEstado]
      .map((value) => value?.trim())
      .filter(Boolean);

    return parts.length ? parts.join(', ') : null;
  }

  private trapFocus(event: KeyboardEvent): void {
    const dialog = this.dialogRoot?.nativeElement;

    if (!dialog || typeof document === 'undefined') {
      return;
    }

    const focusable = this.getFocusableElements();

    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (active === last || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  private getFocusableElements(): HTMLElement[] {
    const dialog = this.dialogRoot?.nativeElement;

    if (!dialog) {
      return [];
    }

    const selector = [
      'a[href]',
      'button:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    return Array.from(
      dialog.querySelectorAll<HTMLElement>(selector)
    ).filter(
      (element) =>
        !element.hasAttribute('disabled') &&
        element.getAttribute('aria-hidden') !== 'true'
    );
  }

  private restoreDocumentState(): void {
    if (typeof document !== 'undefined' && this.previousBodyOverflow !== null) {
      document.body.style.overflow = this.previousBodyOverflow;
      this.previousBodyOverflow = null;
    }

    const focusTarget = this.previouslyFocused;
    this.previouslyFocused = null;

    if (focusTarget && typeof focusTarget.focus === 'function') {
      queueMicrotask(() => focusTarget.focus());
    }
  }
}
