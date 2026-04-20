//src\app\media\shared\components\public-photo-lightbox\public-photo-lightbox.component.ts
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  input,
  output,
} from '@angular/core';
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
export class PublicPhotoLightboxComponent implements AfterViewInit {
  readonly items = input.required<IPublicPhotoItem[]>();
  readonly activeIndex = input<number>(0);
  readonly title = input<string>('Foto pública');

  readonly closed = output<void>();
  readonly prevRequested = output<void>();
  readonly nextRequested = output<void>();

  @ViewChild('dialogRoot', { static: true })
  private dialogRoot!: ElementRef<HTMLDivElement>;

  private previouslyFocused: HTMLElement | null = null;

  readonly currentPhoto = computed(() => {
    const collection = this.items();
    const index = this.activeIndex();
    return collection[index] ?? null;
  });

  readonly hasPrev = computed(() => this.activeIndex() > 0);
  readonly hasNext = computed(() => this.activeIndex() < this.items().length - 1);

  ngAfterViewInit(): void {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    queueMicrotask(() => {
      this.dialogRoot?.nativeElement?.focus();
    });
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

  close(): void {
    this.restoreFocus();
    this.closed.emit();
  }

  prev(): void {
    this.prevRequested.emit();
  }

  next(): void {
    this.nextRequested.emit();
  }

  private restoreFocus(): void {
    if (this.previouslyFocused && typeof this.previouslyFocused.focus === 'function') {
      queueMicrotask(() => this.previouslyFocused?.focus());
    }
  }
}