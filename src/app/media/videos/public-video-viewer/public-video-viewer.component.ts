import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Inject,
  ViewChild,
  inject,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { take } from 'rxjs/operators';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import {
  TVideoViewSource,
  VideoViewTrackingService,
} from 'src/app/core/services/media/video-view-tracking.service';

export interface IPublicVideoViewerData {
  ownerUid: string;
  items: IPublicVideoItem[];
  startIndex: number;
  source?: TVideoViewSource;
}

@Component({
  selector: 'app-public-video-viewer',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  templateUrl: './public-video-viewer.component.html',
  styleUrls: ['./public-video-viewer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicVideoViewerComponent {
  private readonly videoViewTracking = inject(VideoViewTrackingService);
  private readonly recordedViewKeys = new Set<string>();

  @ViewChild('videoPlayer')
  private videoPlayer?: ElementRef<HTMLVideoElement>;

  index: number;

  constructor(
    private readonly dialogRef: MatDialogRef<PublicVideoViewerComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: IPublicVideoViewerData
  ) {
    const itemsCount = data.items?.length ?? 0;
    this.index = itemsCount > 0
      ? Math.max(0, Math.min(data.startIndex ?? 0, itemsCount - 1))
      : 0;

    this.recordCurrentVideoView();
  }

  get current(): IPublicVideoItem | null {
    return this.data.items?.[this.index] ?? null;
  }

  get hasPrevious(): boolean {
    return this.index > 0;
  }

  get hasNext(): boolean {
    return this.index < (this.data.items?.length ?? 0) - 1;
  }

  get positionLabel(): string {
    const total = this.data.items?.length ?? 0;
    return total > 0 ? `${this.index + 1} de ${total}` : 'Sem vídeos';
  }

  @HostListener('document:keydown.arrowleft', ['$event'])
  onArrowLeft(event: Event): void {
    if (this.isTypingTarget(event.target)) {
      return;
    }

    event.preventDefault();
    this.previous();
  }

  @HostListener('document:keydown.arrowright', ['$event'])
  onArrowRight(event: Event): void {
    if (this.isTypingTarget(event.target)) {
      return;
    }

    event.preventDefault();
    this.next();
  }

  close(): void {
    this.pauseCurrentVideo();
    this.dialogRef.close();
  }

  previous(): void {
    if (!this.hasPrevious) {
      return;
    }

    this.changeIndex(this.index - 1);
  }

  next(): void {
    if (!this.hasNext) {
      return;
    }

    this.changeIndex(this.index + 1);
  }

  formatDuration(durationMs: number | null | undefined): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(Number(durationMs ?? 0) / 1000)
    );

    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      return 'Duração não informada';
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

  private changeIndex(nextIndex: number): void {
    this.pauseCurrentVideo();
    this.index = nextIndex;
    this.recordCurrentVideoView();

    queueMicrotask(() => {
      this.videoPlayer?.nativeElement.load();
      this.videoPlayer?.nativeElement.focus({ preventScroll: true });
    });
  }

  private recordCurrentVideoView(): void {
    const video = this.current;
    const ownerUid = (video?.ownerUid ?? this.data.ownerUid ?? '').trim();
    const videoId = (video?.id ?? '').trim();
    const viewKey = `${ownerUid}:${videoId}`;

    if (!ownerUid || !videoId || this.recordedViewKeys.has(viewKey)) {
      return;
    }

    this.recordedViewKeys.add(viewKey);
    this.videoViewTracking
      .recordVideoView$(ownerUid, videoId, this.data.source ?? 'unknown')
      .pipe(take(1))
      .subscribe();
  }

  private pauseCurrentVideo(): void {
    try {
      this.videoPlayer?.nativeElement.pause();
    } catch {
      // noop
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return (
      target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    );
  }
}
