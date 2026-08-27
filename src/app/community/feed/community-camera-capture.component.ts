// src/app/community/feed/community-camera-capture.component.ts
// -----------------------------------------------------------------------------
// COMMUNITY CAMERA CAPTURE
// -----------------------------------------------------------------------------
// Superfície explícita de câmera para o composer do Mural. A foto capturada é
// devolvida como o mesmo attachment canônico usado pela Galeria; o upload segue
// pertencendo ao CommunityFeedComponent/StorageService.
// -----------------------------------------------------------------------------

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, finalize, take } from 'rxjs';

import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import {
  CameraCaptureError,
  CameraCaptureService,
} from 'src/app/core/services/media/camera-capture.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  CommunityComposerAttachment,
  validateCommunityComposerImage,
} from './community-composer-attachment.model';

type CameraSurfaceState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'capturing'
  | 'captured'
  | 'error';

@Component({
  selector: 'app-community-camera-capture',
  standalone: true,
  template: `
    <button
      class="camera-capture__menu-action"
      type="button"
      [disabled]="disabled()"
      (click)="openCamera()"
    >
      <i class="fas fa-camera" aria-hidden="true"></i>
      <span>Câmera</span>
    </button>

    @if (isOpen()) {
      <div class="camera-capture__backdrop" (click)="onBackdropClick($event)">
        <section
          class="camera-capture__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="community-camera-title"
          aria-describedby="community-camera-description"
        >
          <header class="camera-capture__header">
            <div>
              <h2 id="community-camera-title">Câmera</h2>
              <p id="community-camera-description">
                A foto só será adicionada ao Mural depois que você confirmar.
              </p>
            </div>
            <button
              #closeButton
              class="camera-capture__icon-button"
              type="button"
              aria-label="Fechar câmera"
              [disabled]="editingPhoto()"
              (click)="closeCamera()"
            >
              <i class="fas fa-xmark" aria-hidden="true"></i>
            </button>
          </header>

          <div class="camera-capture__viewport">
            @if (state() === 'loading') {
              <div class="camera-capture__status" role="status" aria-live="polite">
                <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
                <span>Preparando a câmera...</span>
              </div>
            }

            @if (state() === 'error') {
              <div class="camera-capture__status is-error" role="alert">
                <i class="fas fa-camera-rotate" aria-hidden="true"></i>
                <strong>Não foi possível abrir a câmera.</strong>
                <span>{{ errorMessage() }}</span>
              </div>
            } @else if (state() === 'captured') {
              @if (capturedPreviewUrl(); as previewUrl) {
                <img
                  class="camera-capture__preview"
                  [src]="previewUrl"
                  alt="Prévia da foto capturada"
                />
              }
            } @else {
              <video
                #videoPreview
                class="camera-capture__video"
                [class.is-hidden]="state() === 'loading'"
                autoplay
                muted
                playsinline
                aria-label="Prévia ao vivo da câmera"
              ></video>

              @if (state() === 'capturing') {
                <div class="camera-capture__capture-progress" role="status">
                  <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
                  <span>Capturando...</span>
                </div>
              }
            }
          </div>

          <footer class="camera-capture__actions">
            @if (state() === 'error') {
              <button type="button" class="is-secondary" (click)="closeCamera()">
                Fechar
              </button>
              <button type="button" class="is-primary" (click)="useDeviceFallback()">
                <i class="fas fa-mobile-screen-button" aria-hidden="true"></i>
                Usar seletor do dispositivo
              </button>
            } @else if (state() === 'captured') {
              <button
                type="button"
                class="is-secondary"
                [disabled]="editingPhoto()"
                (click)="retake()"
              >
                <i class="fas fa-rotate-left" aria-hidden="true"></i>
                Refazer
              </button>
              <button
                type="button"
                class="is-secondary"
                [disabled]="editingPhoto()"
                (click)="editCapturedPhoto()"
              >
                @if (editingPhoto()) {
                  <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
                  Abrindo editor...
                } @else {
                  <i class="fas fa-crop-simple" aria-hidden="true"></i>
                  Editar
                }
              </button>
              <button
                type="button"
                class="is-primary"
                [disabled]="editingPhoto()"
                (click)="useCapturedPhoto()"
              >
                <i class="fas fa-check" aria-hidden="true"></i>
                Usar foto
              </button>
            } @else {
              <button type="button" class="is-secondary" (click)="closeCamera()">
                Cancelar
              </button>
              <button
                type="button"
                class="is-primary"
                [disabled]="state() !== 'ready'"
                (click)="capturePhoto()"
              >
                <i class="fas fa-camera" aria-hidden="true"></i>
                Capturar
              </button>
            }
          </footer>
        </section>
      </div>
    }
  `,
  styles: [`
    :host {
      display: contents;
    }

    .camera-capture__menu-action {
      width: 100%;
      min-height: 2.75rem;
      display: flex;
      align-items: center;
      gap: 0.65rem;
      padding: 0.55rem 0.65rem;
      border: 0;
      border-radius: 0.6rem;
      background: transparent;
      color: color-mix(in oklab, var(--text-color, #222) 82%, transparent);
      font: inherit;
      font-size: 0.78rem;
      font-weight: 700;
      text-align: left;
      cursor: pointer;
    }

    .camera-capture__menu-action i {
      width: 1rem;
      color: color-mix(in oklab, var(--text-color, #222) 58%, transparent);
      text-align: center;
    }

    .camera-capture__menu-action:hover:not(:disabled) {
      background: color-mix(
        in oklab,
        var(--surface-color, #fff) 90%,
        var(--text-color, #222) 10%
      );
      color: var(--text-color, #222);
    }

    .camera-capture__menu-action:focus-visible,
    .camera-capture__dialog button:focus-visible {
      outline: 3px solid color-mix(
        in oklab,
        var(--primary-color, #d83768) 34%,
        transparent
      );
      outline-offset: 2px;
    }

    .camera-capture__menu-action:disabled {
      cursor: wait;
      opacity: 0.45;
    }

    .camera-capture__backdrop {
      position: fixed;
      z-index: 1300;
      inset: 0;
      display: grid;
      place-items: center;
      padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
        max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
      background: color-mix(in oklab, #000 58%, transparent);
      backdrop-filter: blur(4px);
    }

    .camera-capture__dialog {
      width: min(100%, 40rem);
      max-height: min(90dvh, 46rem);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      overflow: hidden;
      border: 1px solid color-mix(in oklab, var(--surface-border, #d5d5d5) 80%, transparent);
      border-radius: 1rem;
      background: var(--surface-color, #fff);
      color: var(--text-color, #222);
      box-shadow: 0 1.4rem 4rem color-mix(in oklab, #000 30%, transparent);
    }

    .camera-capture__header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: 1rem;
      padding: 0.9rem 1rem;
      border-bottom: 1px solid var(--surface-border, #d5d5d5);
    }

    .camera-capture__header h2,
    .camera-capture__header p {
      margin: 0;
    }

    .camera-capture__header h2 {
      font-size: 1rem;
      line-height: 1.25;
    }

    .camera-capture__header p {
      margin-top: 0.2rem;
      color: color-mix(in oklab, var(--text-color, #222) 68%, transparent);
      font-size: 0.75rem;
      line-height: 1.45;
    }

    .camera-capture__icon-button {
      width: 2.75rem;
      height: 2.75rem;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }

    .camera-capture__icon-button:hover:not(:disabled) {
      background: color-mix(in oklab, var(--surface-color, #fff) 90%, var(--text-color, #222) 10%);
    }

    .camera-capture__viewport {
      position: relative;
      min-height: 18rem;
      display: grid;
      place-items: center;
      overflow: hidden;
      background: #0d0d0d;
    }

    .camera-capture__video,
    .camera-capture__preview {
      width: 100%;
      height: 100%;
      max-height: 62dvh;
      display: block;
      object-fit: contain;
      background: #0d0d0d;
    }

    .camera-capture__video.is-hidden {
      visibility: hidden;
    }

    .camera-capture__status,
    .camera-capture__capture-progress {
      position: absolute;
      z-index: 2;
      inset: 0;
      display: grid;
      place-content: center;
      justify-items: center;
      gap: 0.55rem;
      padding: 1.2rem;
      color: #fff;
      text-align: center;
    }

    .camera-capture__status.is-error {
      position: static;
      max-width: 30rem;
    }

    .camera-capture__status span {
      font-size: 0.82rem;
      line-height: 1.5;
    }

    .camera-capture__actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 0.55rem;
      padding: 0.8rem 1rem;
      border-top: 1px solid var(--surface-border, #d5d5d5);
    }

    .camera-capture__actions button {
      min-height: 2.75rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      padding: 0.58rem 0.95rem;
      border-radius: 999px;
      font: inherit;
      font-size: 0.78rem;
      font-weight: 750;
      cursor: pointer;
    }

    .camera-capture__actions .is-secondary {
      border: 1px solid var(--surface-border, #d5d5d5);
      background: var(--surface-color, #fff);
      color: var(--text-color, #222);
    }

    .camera-capture__actions .is-primary {
      border: 1px solid transparent;
      background: var(--primary-color, #d83768);
      color: #fff;
    }

    .camera-capture__actions button:disabled,
    .camera-capture__icon-button:disabled {
      cursor: wait;
      opacity: 0.48;
    }

    @media (max-width: 40rem) {
      .camera-capture__backdrop {
        place-items: end center;
        padding: 0;
      }

      .camera-capture__dialog {
        width: 100%;
        max-height: calc(100dvh - env(safe-area-inset-top));
        border-right: 0;
        border-bottom: 0;
        border-left: 0;
        border-radius: 1rem 1rem 0 0;
      }

      .camera-capture__viewport {
        min-height: min(56dvh, 30rem);
      }

      .camera-capture__actions {
        padding-bottom: max(0.8rem, env(safe-area-inset-bottom));
      }

      .camera-capture__actions button {
        flex: 1 1 9rem;
      }
    }

    @media (forced-colors: active) {
      .camera-capture__dialog,
      .camera-capture__actions button,
      .camera-capture__menu-action {
        border: 1px solid CanvasText;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityCameraCaptureComponent implements OnDestroy {
  private readonly camera = inject(CameraCaptureService);
  private readonly photoEditor = inject(PhotoEditorLauncherService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly destroyRef = inject(DestroyRef);

  readonly disabled = input(false);
  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly attachmentCaptured = output<CommunityComposerAttachment>();
  readonly fallbackRequested = output<void>();

  readonly isOpen = signal(false);
  readonly state = signal<CameraSurfaceState>('idle');
  readonly errorMessage = signal('');
  readonly capturedPreviewUrl = signal<string | null>(null);
  readonly editingPhoto = signal(false);

  private readonly videoPreview = viewChild<ElementRef<HTMLVideoElement>>('videoPreview');
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private activeStream: MediaStream | null = null;
  private capturedFile: File | null = null;
  private photoEditSubscription: Subscription | null = null;

  openCamera(): void {
    if (this.disabled()) return;

    this.cancelPhotoEditing();
    this.clearCapturedPhoto();
    this.errorMessage.set('');
    this.state.set('loading');
    this.isOpen.set(true);
    this.opened.emit();

    setTimeout(() => {
      this.closeButton()?.nativeElement.focus();
      this.startCameraStream();
    }, 0);
  }

  capturePhoto(): void {
    if (this.state() !== 'ready') return;
    const video = this.videoPreview()?.nativeElement;
    if (!video) {
      this.failCamera(new CameraCaptureError(
        'CAPTURE_FAILED',
        'A prévia da câmera não está disponível.'
      ));
      return;
    }

    this.state.set('capturing');
    this.camera.captureFrame$(video)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (file) => {
          const validation = validateCommunityComposerImage(file);
          if (!validation.valid) {
            this.failCamera(new CameraCaptureError(
              'CAPTURE_FAILED',
              validation.userMessage
            ));
            return;
          }

          this.stopActiveStream();
          this.replaceCapturedPhoto(file);
          this.state.set('captured');
        },
        error: (error: unknown) => this.failCamera(error),
      });
  }

  editCapturedPhoto(): void {
    const source = this.capturedFile;
    if (!source || this.state() !== 'captured' || this.editingPhoto()) return;

    this.editPhotoFile(source, 'community-feed-camera', false);
  }

  editDevicePhoto(event: Event): void {
    if (this.disabled() || this.editingPhoto()) return;

    const inputElement = event.target as HTMLInputElement | null;
    const file = inputElement?.files?.[0] ?? null;
    const source = inputElement?.id === 'community-feed-camera-input'
      ? 'community-feed-camera' as const
      : 'community-feed-gallery' as const;

    if (inputElement) inputElement.value = '';
    if (!file) return;

    const validation = validateCommunityComposerImage(file);
    if (!validation.valid) {
      this.errorNotifier.showWarning(validation.userMessage);
      return;
    }

    this.editPhotoFile(file, source, true);
  }

  retake(): void {
    if (!this.isOpen()) return;
    this.cancelPhotoEditing();
    this.clearCapturedPhoto();
    this.state.set('loading');
    setTimeout(() => this.startCameraStream(), 0);
  }

  useCapturedPhoto(): void {
    if (!this.capturedFile || this.state() !== 'captured' || this.editingPhoto()) return;

    const previewUrl = this.capturedPreviewUrl();
    const attachment: CommunityComposerAttachment = {
      kind: 'image',
      file: this.capturedFile,
      previewUrl,
    };

    // A propriedade do object URL passa ao composer, que já o revoga ao remover,
    // cancelar, publicar ou destruir o Mural.
    this.capturedFile = null;
    this.capturedPreviewUrl.set(null);
    this.stopActiveStream();
    this.isOpen.set(false);
    this.state.set('idle');
    this.closed.emit();
    this.attachmentCaptured.emit(attachment);
  }

  useDeviceFallback(): void {
    this.closeCamera();
    this.fallbackRequested.emit();
  }

  closeCamera(): void {
    const wasOpen = this.isOpen();
    this.cancelPhotoEditing();
    this.stopActiveStream();
    this.clearCapturedPhoto();
    this.state.set('idle');
    this.errorMessage.set('');
    this.isOpen.set(false);
    if (wasOpen) this.closed.emit();
  }

  ngOnDestroy(): void {
    this.cancelPhotoEditing();
    this.stopActiveStream();
    this.clearCapturedPhoto();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget && !this.editingPhoto()) {
      this.closeCamera();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    // Enquanto o editor canônico estiver aberto, ele é o dono do Escape. Isso
    // evita fechar a captura de fundo ao cancelar somente a edição.
    if (this.editingPhoto()) return;
    if (this.isOpen()) this.closeCamera();
  }

  private startCameraStream(): void {
    if (!this.isOpen()) return;
    this.stopActiveStream();

    this.camera.openCamera$()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stream) => {
          if (!this.isOpen()) {
            this.camera.stopStream(stream);
            return;
          }

          const video = this.videoPreview()?.nativeElement;
          if (!video) {
            this.camera.stopStream(stream);
            this.failCamera(new CameraCaptureError(
              'CAPTURE_FAILED',
              'A prévia da câmera não pôde ser preparada.'
            ));
            return;
          }

          this.activeStream = stream;
          video.srcObject = stream;
          this.state.set('ready');
        },
        error: (error: unknown) => this.failCamera(error),
      });
  }

  private editPhotoFile(
    sourceFile: File,
    source: 'community-feed-camera' | 'community-feed-gallery',
    emitAttachment: boolean
  ): void {
    this.cancelPhotoEditing();
    this.editingPhoto.set(true);
    this.photoEditSubscription = this.photoEditor.editFile$(
      sourceFile,
      {
        source,
        context: 'community-feed',
        preset: 'social-feed',
      }
    )
      .pipe(finalize(() => {
        this.editingPhoto.set(false);
        this.photoEditSubscription = null;
      }))
      .subscribe({
        next: (result) => {
          if (!result) return;

          const validation = validateCommunityComposerImage(result.file);
          if (!validation.valid) {
            try {
              this.errorNotifier.showWarning(validation.userMessage);
            } catch {
              // A mídia original permanece preservada quando o resultado é inválido.
            }
            return;
          }

          if (emitAttachment) {
            this.attachmentCaptured.emit({
              kind: 'image',
              file: result.file,
              previewUrl: this.createPreviewUrl(result.file),
            });
            return;
          }

          this.replaceCapturedPhoto(result.file);
          this.state.set('captured');
        },
        error: (error: unknown) => this.reportPhotoEditError(error),
      });
  }

  private replaceCapturedPhoto(file: File): void {
    this.clearCapturedPhoto();
    this.capturedFile = file;
    this.capturedPreviewUrl.set(this.createPreviewUrl(file));
  }

  private cancelPhotoEditing(): void {
    const subscription = this.photoEditSubscription;
    this.photoEditSubscription = null;
    if (subscription && !subscription.closed) {
      subscription.unsubscribe();
    }
    this.editingPhoto.set(false);
  }

  private failCamera(error: unknown): void {
    this.stopActiveStream();
    const normalized = error instanceof CameraCaptureError
      ? error
      : new CameraCaptureError('UNKNOWN', 'Não foi possível usar a câmera agora.', error);
    this.errorMessage.set(normalized.message);
    this.state.set('error');

    try {
      this.errorNotifier.showError(normalized.message);
    } catch {
      // O estado inline continua visível mesmo se o serviço de notificação falhar.
    }

    try {
      const contextual = normalized as CameraCaptureError & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityCameraCaptureComponent',
        op: 'cameraCapture',
        code: normalized.code,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária de diagnóstico não quebra a superfície de captura.
    }
  }

  private reportPhotoEditError(error: unknown): void {
    const normalized = error instanceof Error
      ? error
      : new Error('Não foi possível editar a foto agora.');

    try {
      this.errorNotifier.showError(
        'Não foi possível editar a foto agora. A foto original foi preservada.'
      );
    } catch {
      // A mídia original continua disponível mesmo se o toast falhar.
    }

    try {
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityCameraCaptureComponent',
        op: 'photoEdit',
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária de diagnóstico não altera a mídia preservada.
    }
  }

  private stopActiveStream(): void {
    this.camera.stopStream(this.activeStream);
    this.activeStream = null;
    const video = this.videoPreview()?.nativeElement;
    if (video) video.srcObject = null;
  }

  private clearCapturedPhoto(): void {
    this.revokePreviewUrl(this.capturedPreviewUrl());
    this.capturedPreviewUrl.set(null);
    this.capturedFile = null;
  }

  private createPreviewUrl(file: File): string | null {
    try {
      return typeof URL?.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : null;
    } catch {
      return null;
    }
  }

  private revokePreviewUrl(previewUrl: string | null): void {
    if (!previewUrl) return;
    try {
      URL.revokeObjectURL(previewUrl);
    } catch {
      // Object URL descartável; falha de revoke não impede a captura.
    }
  }
}
