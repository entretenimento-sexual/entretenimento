import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface OwnerPrivateVideoViewerData {
  readonly url: string;
  readonly posterUrl: string | null;
  readonly title: string;
}

/** Temporary owner-only playback URL held only in MatDialog memory. */
@Component({
  selector: 'app-owner-private-video-viewer',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="owner-private-viewer" aria-label="Prévia privada do vídeo">
      <header class="owner-private-viewer__header">
        <h2>{{ data.title }}</h2>
        <button type="button" class="app-action app-action--ghost"
          aria-label="Fechar prévia e retornar à galeria" (click)="close()">Fechar</button>
      </header>
      <video #player controls playsinline preload="metadata"
        [src]="data.url" [poster]="data.posterUrl || null"
        (error)="onPlaybackError()"
        aria-label="Reprodução privada do vídeo">
        Seu navegador não suporta reprodução de vídeo.
      </video>
      @if (playbackError()) {
        <p role="alert">
          Não foi possível reproduzir este vídeo. Feche a prévia e abra
          novamente para solicitar um novo acesso temporário.
        </p>
      }
      <p>Prévia exclusiva do proprietário. Este acesso não publica o vídeo.</p>
    </section>
  `,
  styles: [`
    .owner-private-viewer {
      display: grid;
      gap: 12px;
      min-width: 0;
      padding: clamp(12px, 3vw, 24px);
      background: var(--background-color, #101017);
      color: var(--text-color, #fff);
    }
    .owner-private-viewer__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .owner-private-viewer__header h2 {
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: clamp(1rem, 2.5vw, 1.3rem);
    }
    .owner-private-viewer__header button {
      min-height: var(--tap-target, 44px);
      flex-shrink: 0;
    }
    video {
      display: block;
      width: 100%;
      max-height: min(74dvh, 760px);
      background: #000;
      object-fit: contain;
    }
    p { margin: 0; font-size: 0.8125rem; opacity: 0.8; }
  `],
})
export class OwnerPrivateVideoViewerComponent implements OnDestroy {
  readonly data = inject<OwnerPrivateVideoViewerData>(MAT_DIALOG_DATA);
  readonly playbackError = signal(false);
  onPlaybackError(): void { this.playbackError.set(true); }
  private readonly dialog = inject(MatDialogRef<OwnerPrivateVideoViewerComponent>);
  private readonly player = viewChild<ElementRef<HTMLVideoElement>>('player');

  close(): void {
    this.stopPlayback();
    this.dialog.close();
  }

  ngOnDestroy(): void { this.stopPlayback(); }

  private stopPlayback(): void {
    const video = this.player()?.nativeElement;
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
