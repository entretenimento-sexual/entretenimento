// src/app/photo-editor/photo-editor/photo-editor.component.ts
// Editor interno de imagens, baseado em Canvas e sem dependência de runtime externo.
// Mantém os contratos existentes de criação, substituição e sessão efêmera.

import { CommonModule, DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject, Observable, firstValueFrom, of } from 'rxjs';
import { catchError, distinctUntilChanged, map } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  IPhotoFlowResult,
  PhotoUploadFlowService,
} from 'src/app/core/services/image-handling/photo-upload-flow.service';
import {
  IPhotoEditorDraft,
  PhotoEditorSessionService,
} from 'src/app/core/services/image-handling/photo-editor-session.service';

export type PhotoEditorAspectRatio =
  | 'original'
  | 'square'
  | 'portrait'
  | 'landscape';

interface PhotoEditorNativeStateV1 {
  version: 1;
  editor: 'native-canvas';
  rotation: number;
  zoom: number;
  panX: number;
  panY: number;
  aspectRatio: PhotoEditorAspectRatio;
}

interface OriginalFileMetadata {
  fileName: string;
  mimeType: string;
}

const EDITOR_SESSION_MAX_AGE_MS = 15 * 60 * 1000;
const MAX_OUTPUT_EDGE = 2048;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.05;
const KEYBOARD_PAN_STEP = 0.025;

@Component({
  selector: 'app-photo-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, MatProgressSpinnerModule],
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoEditorComponent implements AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly photoEditorSession = inject(PhotoEditorSessionService);
  private readonly document = inject(DOCUMENT);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  @ViewChild('editorStage', { static: true })
  private readonly editorStageRef!: ElementRef<HTMLDivElement>;

  @ViewChild('editorCanvas', { static: true })
  private readonly editorCanvasRef!: ElementRef<HTMLCanvasElement>;

  @ViewChild('closeButton', { static: true })
  private readonly closeButtonRef!: ElementRef<HTMLButtonElement>;

  readonly imageFile = input<File | null>(null);
  readonly storedImageUrl = input<string | null>(null);
  readonly storedImagePath = input<string | null>(null);
  readonly storedImageState = input<string | null>(null);
  readonly photoId = input<string | null>(null);
  readonly isEditMode = input<boolean>(false);

  userId = '';
  rotation = 0;
  zoom = 1;
  panX = 0;
  panY = 0;
  aspectRatio: PhotoEditorAspectRatio = 'original';

  private sourceImage: HTMLImageElement | null = null;
  private sourceFile: File | null = null;
  private sourceObjectUrl: string | null = null;
  private activeDraft: IPhotoEditorDraft | null = null;
  private effectiveIsEditMode = false;
  private effectiveStoredImageUrl: string | null = null;
  private effectiveStoredImagePath: string | null = null;
  private effectivePhotoId: string | null = null;
  private effectiveStoredImageState: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderFrame: number | null = null;
  private viewReady = false;
  private draggingPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private previewWidth = 0;
  private previewHeight = 0;
  private focusOrigin: HTMLElement | null = null;

  private readonly isLoadingSubject = new BehaviorSubject<boolean>(true);
  private readonly isSavingSubject = new BehaviorSubject<boolean>(false);
  private readonly isEditorReadySubject = new BehaviorSubject<boolean>(false);
  private readonly errorMessageSubject = new BehaviorSubject<string | null>(null);
  private readonly isClosingSubject = new BehaviorSubject<boolean>(false);

  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();
  readonly isSaving$: Observable<boolean> = this.isSavingSubject.asObservable();
  readonly isEditorReady$: Observable<boolean> =
    this.isEditorReadySubject.asObservable();
  readonly errorMessage$: Observable<string | null> =
    this.errorMessageSubject.asObservable();

  constructor(
    private readonly photoUploadFlow: PhotoUploadFlowService,
    public readonly activeModal: NgbActiveModal,
    private readonly authSession: AuthSessionService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) {
    this.captureAndReleaseBackgroundFocus();

    this.destroyRef.onDestroy(() => {
      this.isClosingSubject.next(true);
      this.cancelScheduledRender();
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.revokeSourceObjectUrl();
      this.photoEditorSession.clearDraft();
      this.restoreBackgroundFocus();
    });

    this.initializeSession();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.observeStageSize();
    this.scheduleRender();

    queueMicrotask(() => {
      if (!this.isClosingSubject.value) {
        this.closeButtonRef.nativeElement.focus({ preventScroll: true });
      }
    });
  }

  setAspectRatio(value: PhotoEditorAspectRatio): void {
    if (this.aspectRatio === value || this.isBusy()) {
      return;
    }

    this.aspectRatio = value;
    this.panX = 0;
    this.panY = 0;
    this.scheduleRender();
  }

  rotateLeft(): void {
    if (this.isBusy()) {
      return;
    }

    this.rotation = this.normalizeRotation(this.rotation - 90);
    this.panX = 0;
    this.panY = 0;
    this.scheduleRender();
  }

  rotateRight(): void {
    if (this.isBusy()) {
      return;
    }

    this.rotation = this.normalizeRotation(this.rotation + 90);
    this.panX = 0;
    this.panY = 0;
    this.scheduleRender();
  }

  updateZoom(value: number | string): void {
    if (this.isBusy()) {
      return;
    }

    const numericValue = Number(value);
    this.zoom = this.clamp(
      Number.isFinite(numericValue) ? numericValue : MIN_ZOOM,
      MIN_ZOOM,
      MAX_ZOOM
    );
    this.scheduleRender();
  }

  resetEditor(): void {
    if (this.isBusy()) {
      return;
    }

    this.rotation = 0;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.aspectRatio = 'original';
    this.scheduleRender();
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.sourceImage || this.isBusy()) {
      return;
    }

    this.draggingPointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.editorCanvasRef.nativeElement.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onPointerMove(event: PointerEvent): void {
    if (this.draggingPointerId !== event.pointerId || this.isBusy()) {
      return;
    }

    const width = Math.max(1, this.previewWidth);
    const height = Math.max(1, this.previewHeight);
    this.panX += (event.clientX - this.lastPointerX) / width;
    this.panY += (event.clientY - this.lastPointerY) / height;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.scheduleRender();
    event.preventDefault();
  }

  onPointerUp(event: PointerEvent): void {
    if (this.draggingPointerId !== event.pointerId) {
      return;
    }

    this.draggingPointerId = null;

    const canvas = this.editorCanvasRef.nativeElement;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  onCanvasKeydown(event: KeyboardEvent): void {
    if (this.isBusy()) {
      return;
    }

    let handled = true;

    switch (event.key) {
      case 'ArrowLeft':
        this.panX -= KEYBOARD_PAN_STEP;
        break;
      case 'ArrowRight':
        this.panX += KEYBOARD_PAN_STEP;
        break;
      case 'ArrowUp':
        this.panY -= KEYBOARD_PAN_STEP;
        break;
      case 'ArrowDown':
        this.panY += KEYBOARD_PAN_STEP;
        break;
      case '+':
      case '=':
        this.updateZoom(this.zoom + ZOOM_STEP);
        break;
      case '-':
      case '_':
        this.updateZoom(this.zoom - ZOOM_STEP);
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      this.scheduleRender();
    }
  }

  async save(): Promise<void> {
    if (!this.userId || !this.sourceImage || this.isBusy()) {
      return;
    }

    const originalMeta = this.resolveOriginalFileMetadata();
    if (!originalMeta) {
      this.reportError(
        'Imagem de origem indisponível para envio.',
        new Error('Metadados da imagem não foram resolvidos.'),
        { op: 'save.resolveOriginalFileMetadata' }
      );
      return;
    }

    this.isSavingSubject.next(true);
    this.errorMessageSubject.next(null);

    try {
      const processedFile = await this.exportImage(originalMeta.mimeType);
      const imageStateStr = JSON.stringify(this.buildEditorState());
      const result = this.effectiveIsEditMode
        ? await this.replaceStoredPhoto(
            processedFile,
            imageStateStr,
            originalMeta
          )
        : await this.uploadNewPhoto(
            processedFile,
            imageStateStr,
            originalMeta
          );

      this.closeWithSuccess(
        this.effectiveIsEditMode ? 'updateSuccess' : 'uploadSuccess',
        result
      );
    } catch (error) {
      this.reportError(
        this.effectiveIsEditMode
          ? 'Erro ao atualizar a imagem.'
          : 'Erro ao enviar a imagem.',
        error,
        { op: 'save', isEditMode: this.effectiveIsEditMode }
      );
    } finally {
      this.isSavingSubject.next(false);
    }
  }

  onClose(): void {
    if (this.isClosingSubject.value) {
      return;
    }

    this.isClosingSubject.next(true);
    this.activeModal.dismiss('close');
  }

  private initializeSession(): void {
    this.authSession.uid$
      .pipe(
        map((uid) => String(uid ?? '').trim()),
        distinctUntilChanged(),
        catchError((error) => {
          this.reportError('Erro ao preparar o editor de imagem.', error, {
            op: 'initializeSession.uid$',
          });
          return of('');
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((uid) => {
        this.userId = uid;

        if (!uid) {
          this.failAndDismiss(
            'Usuário não autenticado.',
            new Error('Usuário não autenticado.'),
            'user-not-authenticated'
          );
          return;
        }

        const draft = this.photoEditorSession.peekDraft();
        this.activeDraft = draft;

        if (!this.isValidDraft(draft, uid)) {
          this.failAndDismiss(
            'A sessão do editor expirou ou não pertence a este usuário.',
            new Error('Sessão efêmera do editor inválida.'),
            'invalid-editor-session'
          );
          return;
        }

        this.resolveEffectiveState(draft);
        void this.loadSourceImage();
      });
  }

  private async loadSourceImage(): Promise<void> {
    const source = this.resolveSource();

    if (!source) {
      this.failAndDismiss(
        'Nenhuma imagem disponível para edição.',
        new Error('Editor aberto sem imagem de origem.'),
        'missing-editor-source'
      );
      return;
    }

    this.isLoadingSubject.next(true);
    this.isEditorReadySubject.next(false);

    try {
      const image = await this.createImage(source);
      this.sourceImage = image;
      this.applyStoredEditorState(this.effectiveStoredImageState);
      this.isEditorReadySubject.next(true);
      this.errorMessageSubject.next(null);
      this.scheduleRender();
    } catch (error) {
      this.failAndDismiss(
        'Não foi possível carregar a imagem para edição.',
        error,
        'editor-source-load-failed'
      );
    } finally {
      this.isLoadingSubject.next(false);
      this.changeDetectorRef.markForCheck();
    }
  }

  private resolveSource(): string | null {
    const directFile = this.imageFile();
    this.sourceFile =
      directFile ??
      (this.activeDraft?.mode === 'create' ? this.activeDraft.file : null);

    if (this.effectiveStoredImageUrl) {
      return this.effectiveStoredImageUrl;
    }

    if (!this.sourceFile) {
      return null;
    }

    this.revokeSourceObjectUrl();
    this.sourceObjectUrl = URL.createObjectURL(this.sourceFile);
    return this.sourceObjectUrl;
  }

  private createImage(src: string): Promise<HTMLImageElement> {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();

      if (/^https?:\/\//i.test(src)) {
        image.crossOrigin = 'anonymous';
      }

      image.decoding = 'async';
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('Imagem carregada sem dimensões válidas.'));
          return;
        }

        resolve(image);
      };
      image.onerror = () => reject(new Error('Falha ao carregar a imagem.'));
      image.src = src;
    });
  }

  private observeStageSize(): void {
    if (typeof ResizeObserver === 'undefined') {
      this.scheduleRender();
      return;
    }

    this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
    this.resizeObserver.observe(this.editorStageRef.nativeElement);
  }

  private scheduleRender(): void {
    if (!this.viewReady || !this.sourceImage || this.isClosingSubject.value) {
      return;
    }

    this.cancelScheduledRender();
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.renderPreview();
    });
  }

  private cancelScheduledRender(): void {
    if (this.renderFrame !== null) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
  }

  private renderPreview(): void {
    const stage = this.editorStageRef.nativeElement;
    const canvas = this.editorCanvasRef.nativeElement;
    const stageRect = stage.getBoundingClientRect();

    if (stageRect.width < 80 || stageRect.height < 80) {
      return;
    }

    const ratio = this.resolveOutputAspectRatio();
    const availableWidth = Math.max(1, stageRect.width - 24);
    const availableHeight = Math.max(1, stageRect.height - 24);
    let width = availableWidth;
    let height = width / ratio;

    if (height > availableHeight) {
      height = availableHeight;
      width = height * ratio;
    }

    this.previewWidth = Math.max(1, Math.floor(width));
    this.previewHeight = Math.max(1, Math.floor(height));
    canvas.style.width = `${this.previewWidth}px`;
    canvas.style.height = `${this.previewHeight}px`;

    const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.round(this.previewWidth * pixelRatio));
    canvas.height = Math.max(1, Math.round(this.previewHeight * pixelRatio));

    const context = canvas.getContext('2d');
    if (!context) {
      this.reportError(
        'O navegador não conseguiu preparar o editor.',
        new Error('Canvas 2D indisponível.'),
        { op: 'renderPreview.context' }
      );
      return;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.drawImageFrame(context, this.previewWidth, this.previewHeight, true);
  }

  private drawImageFrame(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    preview: boolean
  ): void {
    const image = this.sourceImage;
    if (!image) {
      return;
    }

    context.save();
    context.clearRect(0, 0, width, height);

    if (preview) {
      context.fillStyle = '#080b10';
      context.fillRect(0, 0, width, height);
    } else if (this.resolveOutputMimeType() === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }

    const quarterTurn = Math.abs(this.rotation % 180) === 90;
    const rotatedWidth = quarterTurn ? image.naturalHeight : image.naturalWidth;
    const rotatedHeight = quarterTurn ? image.naturalWidth : image.naturalHeight;
    const baseScale = Math.max(
      width / Math.max(1, rotatedWidth),
      height / Math.max(1, rotatedHeight)
    );
    const scale = baseScale * this.zoom;
    const displayedWidth = rotatedWidth * scale;
    const displayedHeight = rotatedHeight * scale;
    const maxPanX = Math.max(0, (displayedWidth - width) / 2) / width;
    const maxPanY = Math.max(0, (displayedHeight - height) / 2) / height;

    this.panX = this.clamp(this.panX, -maxPanX, maxPanX);
    this.panY = this.clamp(this.panY, -maxPanY, maxPanY);

    context.translate(
      width / 2 + this.panX * width,
      height / 2 + this.panY * height
    );
    context.rotate((this.rotation * Math.PI) / 180);
    context.scale(scale, scale);
    context.drawImage(
      image,
      -image.naturalWidth / 2,
      -image.naturalHeight / 2
    );
    context.restore();
  }

  private async exportImage(originalMimeType: string): Promise<Blob> {
    const ratio = this.resolveOutputAspectRatio();
    let width = MAX_OUTPUT_EDGE;
    let height = Math.round(width / ratio);

    if (height > MAX_OUTPUT_EDGE) {
      height = MAX_OUTPUT_EDGE;
      width = Math.round(height * ratio);
    }

    const output = this.document.createElement('canvas');
    output.width = Math.max(1, width);
    output.height = Math.max(1, height);
    const context = output.getContext('2d');

    if (!context) {
      throw new Error('Canvas de exportação indisponível.');
    }

    this.drawImageFrame(context, output.width, output.height, false);

    const preferredMimeType = this.normalizeOutputMimeType(originalMimeType);
    const blob = await this.canvasToBlob(output, preferredMimeType);

    if (blob) {
      return blob;
    }

    const fallback = await this.canvasToBlob(output, 'image/jpeg');
    if (!fallback) {
      throw new Error('O navegador não conseguiu exportar a imagem.');
    }

    return fallback;
  }

  private canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob | null> {
    return new Promise((resolve) => {
      canvas.toBlob(resolve, mimeType, mimeType === 'image/png' ? undefined : 0.88);
    });
  }

  private resolveOutputAspectRatio(): number {
    if (this.aspectRatio === 'square') {
      return 1;
    }

    if (this.aspectRatio === 'portrait') {
      return 4 / 5;
    }

    if (this.aspectRatio === 'landscape') {
      return 16 / 9;
    }

    const image = this.sourceImage;
    if (!image) {
      return 1;
    }

    const quarterTurn = Math.abs(this.rotation % 180) === 90;
    const width = quarterTurn ? image.naturalHeight : image.naturalWidth;
    const height = quarterTurn ? image.naturalWidth : image.naturalHeight;
    return Math.max(0.1, width / Math.max(1, height));
  }

  private buildEditorState(): PhotoEditorNativeStateV1 {
    return {
      version: 1,
      editor: 'native-canvas',
      rotation: this.rotation,
      zoom: Number(this.zoom.toFixed(3)),
      panX: Number(this.panX.toFixed(4)),
      panY: Number(this.panY.toFixed(4)),
      aspectRatio: this.aspectRatio,
    };
  }

  private applyStoredEditorState(value: string | null): void {
    if (!value) {
      return;
    }

    try {
      const parsed = JSON.parse(value) as Partial<PhotoEditorNativeStateV1>;
      if (parsed.version !== 1 || parsed.editor !== 'native-canvas') {
        return;
      }

      this.rotation = this.normalizeRotation(Number(parsed.rotation ?? 0));
      this.zoom = this.clamp(Number(parsed.zoom ?? 1), MIN_ZOOM, MAX_ZOOM);
      this.panX = this.clamp(Number(parsed.panX ?? 0), -1, 1);
      this.panY = this.clamp(Number(parsed.panY ?? 0), -1, 1);
      this.aspectRatio = this.normalizeAspectRatio(parsed.aspectRatio);
    } catch {
      // Estados de editores antigos são deliberadamente ignorados.
    }
  }

  private normalizeAspectRatio(value: unknown): PhotoEditorAspectRatio {
    return value === 'square' ||
      value === 'portrait' ||
      value === 'landscape'
      ? value
      : 'original';
  }

  private normalizeRotation(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  }

  private resolveEffectiveState(draft: IPhotoEditorDraft | null): void {
    this.effectiveIsEditMode = this.isEditMode() || draft?.mode === 'edit';
    this.effectiveStoredImageUrl =
      String(this.storedImageUrl() ?? '').trim() ||
      (draft?.mode === 'edit' ? draft.storedImageUrl : '') ||
      null;
    this.effectiveStoredImagePath =
      String(this.storedImagePath() ?? '').trim() ||
      (draft?.mode === 'edit' ? draft.storedImagePath : '') ||
      null;
    this.effectiveStoredImageState =
      String(this.storedImageState() ?? '').trim() ||
      (draft?.mode === 'edit' ? String(draft.storedImageState ?? '') : '') ||
      null;
    this.effectivePhotoId =
      String(this.photoId() ?? '').trim() ||
      (draft?.mode === 'edit' ? draft.photoId : '') ||
      null;
  }

  private isValidDraft(
    draft: IPhotoEditorDraft | null,
    authenticatedUid: string
  ): boolean {
    if (!draft) {
      return true;
    }

    const age = Date.now() - Number(draft.createdAt ?? 0);
    return (
      draft.ownerUid === authenticatedUid &&
      Number.isFinite(age) &&
      age >= 0 &&
      age <= EDITOR_SESSION_MAX_AGE_MS
    );
  }

  private resolveOriginalFileMetadata(): OriginalFileMetadata | null {
    if (this.sourceFile) {
      return {
        fileName: this.sourceFile.name,
        mimeType: this.normalizeOutputMimeType(this.sourceFile.type),
      };
    }

    const draftFileName =
      this.activeDraft?.mode === 'edit'
        ? String(this.activeDraft.fileName ?? '').trim()
        : '';
    const path = String(this.effectiveStoredImagePath ?? '').trim();
    const url = String(this.effectiveStoredImageUrl ?? '').trim();
    const photoId = String(this.effectivePhotoId ?? '').trim();
    const fileName =
      draftFileName ||
      this.extractFileName(path) ||
      this.extractFileName(url) ||
      `${photoId || Date.now()}.jpg`;

    return {
      fileName,
      mimeType: this.normalizeOutputMimeType(this.guessMimeType(fileName)),
    };
  }

  private async uploadNewPhoto(
    processedFile: Blob,
    imageStateStr: string,
    metadata: OriginalFileMetadata
  ): Promise<IPhotoFlowResult> {
    return firstValueFrom(
      this.photoUploadFlow.uploadProcessedPhoto$({
        userId: this.userId,
        processedFile,
        originalFileName: metadata.fileName,
        mimeType: processedFile.type || metadata.mimeType,
        imageStateStr,
      })
    );
  }

  private async replaceStoredPhoto(
    processedFile: Blob,
    imageStateStr: string,
    metadata: OriginalFileMetadata
  ): Promise<IPhotoFlowResult> {
    const photoId = String(this.effectivePhotoId ?? '').trim();
    const storagePath = String(this.effectiveStoredImagePath ?? '').trim();

    if (!photoId || !storagePath) {
      throw new Error('Informações incompletas para substituir a foto.');
    }

    return firstValueFrom(
      this.photoUploadFlow.replaceProcessedPhoto$({
        userId: this.userId,
        photoId,
        currentStoragePath: storagePath,
        processedFile,
        originalFileName: metadata.fileName,
        mimeType: processedFile.type || metadata.mimeType,
        imageStateStr,
      })
    );
  }

  private closeWithSuccess(
    reason: 'uploadSuccess' | 'updateSuccess',
    photo: IPhotoFlowResult
  ): void {
    this.isClosingSubject.next(true);
    this.activeModal.close({ reason, photo });
  }

  private failAndDismiss(
    message: string,
    error: unknown,
    reason: string
  ): void {
    this.reportError(message, error, { op: 'failAndDismiss', reason });
    this.isClosingSubject.next(true);
    this.activeModal.dismiss(reason);
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    this.errorMessageSubject.next(userMessage);

    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // O erro seguirá para o handler global.
    }

    try {
      const normalized = error instanceof Error ? error : new Error(userMessage);
      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PhotoEditorComponent',
        ...(context ?? {}),
      };
      (normalized as any).skipUserNotification = true;
      this.errorHandler.handleError(normalized);
    } catch {
      // Evita que uma falha de telemetria quebre o editor.
    }
  }

  private captureAndReleaseBackgroundFocus(): void {
    const activeElement = this.document.activeElement;
    this.focusOrigin = activeElement instanceof HTMLElement ? activeElement : null;

    if (this.focusOrigin && this.focusOrigin !== this.document.body) {
      this.focusOrigin.blur();
    }
  }

  private restoreBackgroundFocus(): void {
    const origin = this.focusOrigin;
    this.focusOrigin = null;

    if (!origin) {
      return;
    }

    setTimeout(() => {
      if (origin.isConnected) {
        origin.focus({ preventScroll: true });
      }
    }, 0);
  }

  private revokeSourceObjectUrl(): void {
    if (this.sourceObjectUrl) {
      URL.revokeObjectURL(this.sourceObjectUrl);
      this.sourceObjectUrl = null;
    }
  }

  private extractFileName(value: string): string {
    if (!value) {
      return '';
    }

    try {
      const parsed = new URL(value);
      return decodeURIComponent(parsed.pathname).split('/').pop() ?? '';
    } catch {
      return value.split('/').pop()?.split('?')[0] ?? '';
    }
  }

  private guessMimeType(fileName: string): string {
    const normalized = fileName.toLowerCase();
    if (normalized.endsWith('.png')) {
      return 'image/png';
    }
    if (normalized.endsWith('.webp')) {
      return 'image/webp';
    }
    return 'image/jpeg';
  }

  private normalizeOutputMimeType(value?: string | null): string {
    const normalized = String(value ?? '').toLowerCase();
    return normalized === 'image/png' || normalized === 'image/webp'
      ? normalized
      : 'image/jpeg';
  }

  private resolveOutputMimeType(): string {
    return this.normalizeOutputMimeType(
      this.sourceFile?.type || this.resolveOriginalFileMetadata()?.mimeType
    );
  }

  private isBusy(): boolean {
    return (
      this.isLoadingSubject.value ||
      this.isSavingSubject.value ||
      this.isClosingSubject.value
    );
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    if (!Number.isFinite(value)) {
      return minimum;
    }
    return Math.min(maximum, Math.max(minimum, value));
  }
}
