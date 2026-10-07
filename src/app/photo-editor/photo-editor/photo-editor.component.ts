// src/app/photo-editor/photo-editor/photo-editor.component.ts
// Editor canônico de imagens da plataforma.
// Baseado em Canvas, sem dependência de runtime externo e sem persistência.
// Recebe uma origem, processa a imagem e devolve um resultado puro ao consumidor.

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
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import {
  PhotoEditorHistoryService,
  PhotoEditorHistorySnapshot,
} from 'src/app/core/services/image-handling/photo-editor-history.service';
import {
  PhotoEditorPreset,
  PhotoEditorProcessedResult,
} from 'src/app/core/services/image-handling/photo-editor-result.model';
import {
  IPhotoEditorDraft,
  PhotoEditorSessionService,
} from 'src/app/core/services/image-handling/photo-editor-session.service';
import {
  MEDIA_IMAGE_EDITOR_MAX_INTERACTIVE_PIXELS,
  resolveImageEditorPreset,
} from 'src/app/core/services/media/media-format.policy';
import {
  PHOTO_EDITOR_MIN_PRIVACY_SIZE,
  PhotoEditorCaptionStyle,
  PhotoEditorDateTimeFormat,
  PhotoEditorDateTimeMeta,
  PhotoEditorDecorationOverlay,
  PhotoEditorDraftPrivacyRegion,
  PhotoEditorFontFamily,
  PhotoEditorNormalizedPoint,
  PhotoEditorOverlay,
  PhotoEditorPrivacyOverlay,
  PhotoEditorPrivacyShape,
  PhotoEditorTool,
  clonePhotoEditorOverlays,
  createPhotoEditorDateTimeMeta,
  createPhotoEditorOverlayId,
  drawPhotoEditorOverlays,
  formatPhotoEditorDateTime,
  hitTestPhotoEditorOverlay,
  normalizePhotoEditorOverlays,
  privacyRegionFromDraft,
} from './photo-editor-overlay.model';
import {
  PHOTO_EDITOR_LOCAL_TOOL_GROUPS,
  PHOTO_EDITOR_LOCAL_TOOL_REGISTRY,
  isLocalPhotoEditorTool,
} from './photo-editor-local-tool.registry';
import {
  PHOTO_EDITOR_FULL_CROP_RECT,
  PHOTO_EDITOR_MIN_CROP_SIZE,
  PhotoEditorCropRect,
  createPhotoEditorCropRect,
  isFullPhotoEditorCropRect,
  normalizePhotoEditorCropRect,
  resolvePhotoEditorCropOutputGeometry,
} from './photo-editor-transform.model';

export type PhotoEditorAspectRatio =
  | 'original'
  | 'square'
  | 'portrait'
  | 'landscape';

type PhotoEditorBrushMode = 'paint' | 'erase';
type PhotoEditorResizeHandle = 'nw' | 'ne' | 'sw' | 'se';
type PhotoEditorCropResizeHandle = PhotoEditorResizeHandle;

interface PhotoEditorNativeStateV1 {
  version: 1;
  editor: 'native-canvas';
  rotation: number;
  zoom: number;
  panX: number;
  panY: number;
  aspectRatio: PhotoEditorAspectRatio;
}

interface PhotoEditorNativeStateV2 {
  version: 2;
  editor: 'native-canvas';
  flattened: true;
  rotation: number;
  straighten?: number;
  flipHorizontal?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  zoom: number;
  panX: number;
  panY: number;
  aspectRatio: PhotoEditorAspectRatio;
  cropRect?: PhotoEditorCropRect;
  overlays: PhotoEditorOverlay[];
}

interface OriginalFileMetadata {
  fileName: string;
  mimeType: string;
}

interface ExportedPhotoEditorImage {
  blob: Blob;
  width: number;
  height: number;
}

const EDITOR_SESSION_MAX_AGE_MS = 15 * 60 * 1000;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.05;
const KEYBOARD_PAN_STEP = 0.025;
const KEYBOARD_OVERLAY_STEP = 0.01;
const KEYBOARD_CROP_STEP = 0.01;
const KEYBOARD_CROP_RESIZE_STEP = 0.02;

@Component({
  selector: 'app-photo-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, MatProgressSpinnerModule],
  providers: [PhotoEditorHistoryService],
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoEditorComponent implements AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly photoEditorSession = inject(PhotoEditorSessionService);
  private readonly photoEditorHistory = inject(PhotoEditorHistoryService);
  private readonly document = inject(DOCUMENT);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  @ViewChild('editorStage', { static: true })
  private readonly editorStageRef!: ElementRef<HTMLDivElement>;

  @ViewChild('editorCanvas', { static: true })
  private readonly editorCanvasRef!: ElementRef<HTMLCanvasElement>;

  @ViewChild('closeButton', { static: true })
  private readonly closeButtonRef!: ElementRef<HTMLButtonElement>;

  // Inputs mantidos apenas como porta direta/testável. O launcher usa sessão efêmera.
  readonly imageFile = input<File | null>(null);
  readonly storedImageUrl = input<string | null>(null);
  readonly storedImageState = input<string | null>(null);

  readonly emojiGroups: ReadonlyArray<{
    label: string;
    items: readonly string[];
  }> = [
    {
      label: 'Privacidade',
      items: ['🙈', '🔒', '🚫', '🔞', '🕶️', '🎭', '🫣', '🤫'],
    },
    {
      label: 'Reações',
      items: ['😎', '😉', '😘', '😈', '🥵', '😍', '🤭', '😏'],
    },
    {
      label: 'Destaques',
      items: ['❤️', '🖤', '🔥', '✨', '⭐', '💋', '👑', '💎'],
    },
    {
      label: 'Símbolos',
      items: ['📍', '⚡', '🌙', '☀️', '🎉', '🍒', '🍑', '💦'],
    },
  ];

  readonly emojiOptions = this.emojiGroups.flatMap((group) => [...group.items]);

  readonly fontOptions: ReadonlyArray<{
    value: PhotoEditorFontFamily;
    label: string;
  }> = [
    { value: 'system', label: 'Moderna' },
    { value: 'rounded', label: 'Arredondada' },
    { value: 'serif', label: 'Elegante' },
    { value: 'condensed', label: 'Impacto' },
    { value: 'handwritten', label: 'Manuscrita' },
    { value: 'mono', label: 'Monoespaçada' },
  ];

  readonly dateTimeFormatOptions: ReadonlyArray<{
    value: PhotoEditorDateTimeFormat;
    label: string;
  }> = [
    { value: 'instagram', label: '13 JUL • 15:42' },
    { value: 'numeric', label: '13/07 • 15:42' },
    { value: 'long', label: '13 JUL 2026 • 15:42' },
    { value: 'today', label: 'HOJE • 15:42' },
  ];

  readonly toolOptions = PHOTO_EDITOR_LOCAL_TOOL_REGISTRY;
  readonly toolGroups = PHOTO_EDITOR_LOCAL_TOOL_GROUPS;

  userId = '';
  rotation = 0;
  straighten = 0;
  flipHorizontal = false;
  brightness = 100;
  contrast = 100;
  saturation = 100;
  zoom = 1;
  panX = 0;
  panY = 0;
  aspectRatio: PhotoEditorAspectRatio = 'original';
  cropRect: PhotoEditorCropRect = { ...PHOTO_EDITOR_FULL_CROP_RECT };

  activeTool: PhotoEditorTool = 'move';
  privacyStrength = 3;
  privacyOpacity = 85;
  privacyShape: PhotoEditorPrivacyShape = 'rectangle';
  privacyBrushSize = 12;
  privacyBrushMode: PhotoEditorBrushMode = 'paint';
  decorationSize = 10;
  selectedEmoji = this.emojiOptions[0];
  captionText = '';
  captionStyle: PhotoEditorCaptionStyle = 'classic';
  captionFontFamily: PhotoEditorFontFamily = 'system';
  newDateTimeMeta: PhotoEditorDateTimeMeta = createPhotoEditorDateTimeMeta();
  overlays: PhotoEditorOverlay[] = [];
  selectedOverlayId: string | null = null;

  private sourceImage: HTMLImageElement | null = null;
  private sourceFile: File | null = null;
  private sourceObjectUrl: string | null = null;
  private activeDraft: IPhotoEditorDraft | null = null;
  private isStoredSource = false;
  private effectiveStoredImageUrl: string | null = null;
  private effectiveStoredImageState: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderFrame: number | null = null;
  private viewReady = false;
  private draggingPointerId: number | null = null;
  private pointerInteraction:
    | 'pan'
    | 'privacy'
    | 'privacy-brush'
    | 'privacy-brush-erase'
    | 'overlay'
    | 'overlay-resize'
    | 'crop'
    | 'crop-move'
    | 'crop-resize'
    | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private overlayDragSnapshot: PhotoEditorOverlay[] | null = null;
  private overlayDragChanged = false;
  private activeResizeHandle: PhotoEditorResizeHandle | null = null;
  private draftPrivacyRegion: PhotoEditorDraftPrivacyRegion | null = null;
  private brushStrokeSnapshot: PhotoEditorOverlay[] | null = null;
  private brushStrokeOverlayId: string | null = null;
  private brushEraseChanged = false;
  private brushCursorPoint: PhotoEditorNormalizedPoint | null = null;
  private cropStartPoint: PhotoEditorNormalizedPoint | null = null;
  private cropInteractionSnapshot: PhotoEditorCropRect | null = null;
  private activeCropResizeHandle: PhotoEditorCropResizeHandle | null = null;
  private cropInteractionChanged = false;
  private draftCropRect: PhotoEditorCropRect | null = null;
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
  readonly canUndo$: Observable<boolean> = this.photoEditorHistory.canUndo$;
  readonly canRedo$: Observable<boolean> = this.photoEditorHistory.canRedo$;

  constructor(
    public readonly activeModal: NgbActiveModal,
    private readonly authSession: AuthSessionService,
    private readonly errorHandler: MediaApplicationErrorService
  ) {
    this.captureAndReleaseBackgroundFocus();

    this.destroyRef.onDestroy(() => {
      this.isClosingSubject.next(true);
      this.cancelScheduledRender();
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.revokeSourceObjectUrl();
      this.photoEditorHistory.clear();
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

  get canUndo(): boolean {
    return this.photoEditorHistory.canUndo;
  }

  get canRedo(): boolean {
    return this.photoEditorHistory.canRedo;
  }

  get hasOverlays(): boolean {
    return this.overlays.length > 0;
  }

  get selectedOverlay(): PhotoEditorOverlay | null {
    if (!this.selectedOverlayId) {
      return null;
    }
    return (
      this.overlays.find((overlay) => overlay.id === this.selectedOverlayId) ??
      null
    );
  }

  get selectedDateTimeMeta(): PhotoEditorDateTimeMeta | null {
    const selected = this.selectedOverlay;
    return selected?.kind === 'datetime' && selected.dateTimeMeta
      ? selected.dateTimeMeta
      : null;
  }

  get isPrivacyTool(): boolean {
    return (
      this.activeTool === 'blur' ||
      this.activeTool === 'pixelate' ||
      this.activeTool === 'bar'
    );
  }

  get hasCustomCrop(): boolean {
    return !isFullPhotoEditorCropRect(this.cropRect);
  }

  isToolDisabled(tool: PhotoEditorTool): boolean {
    return tool === 'crop' && this.isAspectRatioLocked;
  }

  get isDecorationTool(): boolean {
    return (
      this.activeTool === 'emoji' ||
      this.activeTool === 'text' ||
      this.activeTool === 'datetime'
    );
  }

  get saveActionLabel(): string {
    return 'Aplicar edição';
  }

  get savingActionLabel(): string {
    return 'Aplicando...';
  }

  get activePreset(): PhotoEditorPreset {
    return this.activeDraft?.preset ?? 'free';
  }

  get isAspectRatioLocked(): boolean {
    return resolveImageEditorPreset(this.activePreset).lockAspectRatio;
  }

  isAspectRatioOptionDisabled(value: PhotoEditorAspectRatio): boolean {
    const preset = resolveImageEditorPreset(this.activePreset);
    return preset.lockAspectRatio && value !== preset.aspectRatio;
  }

  get toolInstruction(): string {
    if (this.selectedOverlay) {
      return 'Arraste o elemento selecionado ou ajuste suas propriedades abaixo.';
    }

    switch (this.activeTool) {
      case 'crop':
        return this.isAspectRatioLocked
          ? 'Este uso exige formato fixo; ajuste o enquadramento com zoom e movimento.'
          : 'Arraste para criar o recorte; depois mova a área ou redimensione pelos cantos.';
      case 'adjust':
        return 'Ajuste alinhamento, espelhamento, brilho, contraste e saturação.';
      case 'blur':
        return 'Arraste sobre o rosto, tatuagem ou outra área que precisa ser escondida.';
      case 'pixelate':
        return 'Arraste sobre a área para aplicar pixels grandes na foto final.';
      case 'bar':
        return 'Arraste para criar uma tarja sólida ou semitransparente sobre a área.';
      case 'emoji':
        return 'Escolha um emoji e clique na foto para posicionar.';
      case 'text':
        return this.captionText.trim()
          ? 'Clique na foto para posicionar o texto.'
          : 'Digite o texto antes de clicar na foto.';
      case 'datetime':
        return 'Ajuste data, hora e estilo; depois clique na foto para posicionar.';
      default:
        return 'Clique em um elemento para selecioná-lo ou arraste a imagem para enquadrar.';
    }
  }

  get canvasAriaLabel(): string {
    return `Prévia editável da foto. ${this.toolInstruction}`;
  }

  selectTool(tool: PhotoEditorTool): void {
    if (
      this.isBusy() ||
      !isLocalPhotoEditorTool(tool) ||
      this.isToolDisabled(tool)
    ) {
      return;
    }
    this.activeTool = tool;
    this.selectedOverlayId = null;
    this.cancelPointerInteraction(false);
    this.scheduleRender();
  }

  selectEmoji(emoji: string): void {
    if (!this.emojiOptions.includes(emoji) || this.isBusy()) return;
    this.selectedEmoji = emoji;
    this.activeTool = 'emoji';
    this.selectedOverlayId = null;
  }

  updateSelectedEmoji(emoji: string): void {
    if (!this.emojiOptions.includes(emoji)) return;
    this.updateSelectedDecoration(
      (overlay) => ({ ...overlay, value: emoji }),
      true
    );
  }

  setCaptionStyle(style: PhotoEditorCaptionStyle): void {
    if (this.isBusy()) return;
    this.captionStyle = this.normalizeCaptionStyle(style);
  }

  setCaptionFontFamily(fontFamily: PhotoEditorFontFamily): void {
    if (this.isBusy()) return;
    this.captionFontFamily = this.normalizeFontFamily(fontFamily);
  }

  updatePrivacyStrength(value: number | string): void {
    const numericValue = Number(value);
    this.privacyStrength = this.clamp(
      Number.isFinite(numericValue) ? numericValue : 3,
      0.8,
      8
    );
  }

  updatePrivacyOpacity(value: number | string): void {
    const numericValue = Number(value);
    this.privacyOpacity = this.clamp(
      Number.isFinite(numericValue) ? numericValue : 85,
      25,
      100
    );
  }

  setPrivacyShape(shape: PhotoEditorPrivacyShape): void {
    if (this.isBusy()) return;
    this.privacyShape =
      shape === 'ellipse' || shape === 'brush' ? shape : 'rectangle';
    this.scheduleRender();
  }

  updatePrivacyBrushSize(value: number | string): void {
    const numericValue = Number(value);
    this.privacyBrushSize = this.clamp(
      Number.isFinite(numericValue) ? numericValue : 12,
      3,
      30
    );
    this.scheduleRender();
  }

  setPrivacyBrushMode(mode: PhotoEditorBrushMode): void {
    if (this.isBusy()) return;
    this.privacyBrushMode = mode === 'erase' ? 'erase' : 'paint';
    this.selectedOverlayId = null;
    this.scheduleRender();
  }

  updateDecorationSize(value: number | string): void {
    const numericValue = Number(value);
    this.decorationSize = this.clamp(
      Number.isFinite(numericValue) ? numericValue : 10,
      3.5,
      28
    );
  }

  setNewDateTimeDate(value: string): void {
    this.newDateTimeMeta = { ...this.newDateTimeMeta, date: value };
  }

  setNewDateTimeTime(value: string): void {
    this.newDateTimeMeta = { ...this.newDateTimeMeta, time: value };
  }

  setNewDateTimeFormat(value: PhotoEditorDateTimeFormat): void {
    this.newDateTimeMeta = {
      ...this.newDateTimeMeta,
      format: this.normalizeDateTimeFormat(value),
    };
  }

  setNewDateTimeIncludeYear(value: boolean): void {
    this.newDateTimeMeta = {
      ...this.newDateTimeMeta,
      includeYear: value === true,
    };
  }

  resetNewDateTimeToNow(): void {
    this.newDateTimeMeta = createPhotoEditorDateTimeMeta();
  }

  addCurrentToolAtCenter(): void {
    if (!this.isDecorationTool || this.isBusy()) return;
    this.placeDecorationAt({ x: 0.5, y: 0.5 });
  }

  selectOverlay(overlayId: string | null): void {
    this.selectedOverlayId =
      overlayId && this.overlays.some((overlay) => overlay.id === overlayId)
        ? overlayId
        : null;
    this.scheduleRender();
  }

  updateSelectedText(value: string): void {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').slice(0, 40);
    this.updateSelectedDecoration(
      (overlay) =>
        overlay.kind === 'text'
          ? { ...overlay, value: normalized || overlay.value }
          : overlay,
      false
    );
  }

  updateSelectedStyle(style: PhotoEditorCaptionStyle): void {
    const normalized = this.normalizeCaptionStyle(style);
    this.updateSelectedDecoration(
      (overlay) => ({ ...overlay, style: normalized }),
      true
    );
  }

  updateSelectedFontFamily(fontFamily: PhotoEditorFontFamily): void {
    const normalized = this.normalizeFontFamily(fontFamily);
    this.updateSelectedDecoration(
      (overlay) => ({ ...overlay, fontFamily: normalized }),
      true
    );
  }

  updateSelectedDecorationSize(value: number | string): void {
    const size = this.clamp(Number(value) / 100, 0.035, 0.28);
    this.updateSelectedDecoration(
      (overlay) => ({ ...overlay, size }),
      false
    );
  }

  updateSelectedPrivacyStrength(value: number | string): void {
    const strength = this.clamp(Number(value) / 100, 0.008, 0.08);
    this.updateSelectedPrivacy(
      (overlay) =>
        overlay.kind === 'bar' ? overlay : { ...overlay, strength },
      false
    );
  }

  updateSelectedPrivacyOpacity(value: number | string): void {
    const opacity = this.clamp(Number(value) / 100, 0.25, 1);
    this.updateSelectedPrivacy(
      (overlay) =>
        overlay.kind === 'bar' ? { ...overlay, opacity } : overlay,
      false
    );
  }

  updateSelectedPrivacyShape(shape: 'rectangle' | 'ellipse'): void {
    const normalizedShape = shape === 'ellipse' ? 'ellipse' : 'rectangle';
    this.updateSelectedPrivacy(
      (overlay) =>
        overlay.kind === 'bar' || overlay.shape === 'brush'
          ? overlay
          : { ...overlay, shape: normalizedShape },
      true
    );
  }

  updateSelectedDateTimeDate(value: string): void {
    this.updateSelectedDateTimeMeta({ date: value }, false);
  }

  updateSelectedDateTimeTime(value: string): void {
    this.updateSelectedDateTimeMeta({ time: value }, false);
  }

  updateSelectedDateTimeFormat(value: PhotoEditorDateTimeFormat): void {
    this.updateSelectedDateTimeMeta(
      { format: this.normalizeDateTimeFormat(value) },
      true
    );
  }

  updateSelectedDateTimeIncludeYear(value: boolean): void {
    this.updateSelectedDateTimeMeta({ includeYear: value === true }, true);
  }

  useCurrentDateTimeForSelected(): void {
    const current = createPhotoEditorDateTimeMeta();
    this.updateSelectedDateTimeMeta(
      {
        date: current.date,
        time: current.time,
      },
      true
    );
  }

  commitSelectedOverlayEdit(): void {
    if (this.selectedOverlay) {
      this.commitOverlays(this.overlays);
    }
  }

  removeSelectedOverlay(): void {
    const selectedId = this.selectedOverlayId;
    if (!selectedId || this.isBusy()) return;
    this.selectedOverlayId = null;
    this.commitOverlays(
      this.overlays.filter((overlay) => overlay.id !== selectedId)
    );
  }

  duplicateSelectedOverlay(): void {
    const selected = this.selectedOverlay;
    if (!selected || this.isBusy()) return;
    const duplicate = this.offsetOverlay(
      {
        ...selected,
        id: createPhotoEditorOverlayId(),
        ...(selected.kind === 'datetime' && selected.dateTimeMeta
          ? { dateTimeMeta: { ...selected.dateTimeMeta } }
          : {}),
      },
      0.035,
      0.035
    );
    this.selectedOverlayId = duplicate.id;
    this.commitOverlays([...this.overlays, duplicate]);
  }

  bringSelectedOverlayForward(): void {
    const selectedId = this.selectedOverlayId;
    if (!selectedId || this.isBusy()) return;
    const index = this.overlays.findIndex((overlay) => overlay.id === selectedId);
    if (index < 0 || index === this.overlays.length - 1) return;
    const reordered = clonePhotoEditorOverlays(this.overlays);
    const [selected] = reordered.splice(index, 1);
    reordered.splice(index + 1, 0, selected);
    this.commitOverlays(reordered);
  }

  sendSelectedOverlayBackward(): void {
    const selectedId = this.selectedOverlayId;
    if (!selectedId || this.isBusy()) return;
    const index = this.overlays.findIndex((overlay) => overlay.id === selectedId);
    if (index <= 0) return;
    const reordered = clonePhotoEditorOverlays(this.overlays);
    const [selected] = reordered.splice(index, 1);
    reordered.splice(index - 1, 0, selected);
    this.commitOverlays(reordered);
  }

  undoOverlay(): void {
    if (!this.canUndo || this.isBusy()) return;
    const snapshot = this.photoEditorHistory.undo();
    if (snapshot) this.restoreHistorySnapshot(snapshot);
  }

  redoOverlay(): void {
    if (!this.canRedo || this.isBusy()) return;
    const snapshot = this.photoEditorHistory.redo();
    if (snapshot) this.restoreHistorySnapshot(snapshot);
  }

  clearOverlays(): void {
    if (!this.hasOverlays || this.isBusy()) return;
    this.selectedOverlayId = null;
    this.commitOverlays([]);
  }

  setAspectRatio(value: PhotoEditorAspectRatio): void {
    const preset = resolveImageEditorPreset(this.activePreset);
    if (
      this.aspectRatio === value ||
      this.isBusy() ||
      (preset.lockAspectRatio && value !== preset.aspectRatio)
    ) {
      return;
    }

    this.aspectRatio = value;
    this.panX = 0;
    this.panY = 0;
    this.commitEditorState();
  }

  rotateLeft(): void {
    if (this.isBusy()) return;
    this.rotation = this.normalizeRotation(this.rotation - 90);
    this.panX = 0;
    this.panY = 0;
    this.commitEditorState();
  }

  rotateRight(): void {
    if (this.isBusy()) return;
    this.rotation = this.normalizeRotation(this.rotation + 90);
    this.panX = 0;
    this.panY = 0;
    this.commitEditorState();
  }

  updateZoom(value: number | string): void {
    if (this.isBusy()) return;
    const numericValue = Number(value);
    const nextZoom = this.clamp(
      Number.isFinite(numericValue) ? numericValue : MIN_ZOOM,
      MIN_ZOOM,
      MAX_ZOOM
    );
    if (nextZoom === this.zoom) return;
    this.zoom = nextZoom;
    this.commitEditorState();
  }

  updateStraighten(value: number | string): void {
    if (this.isBusy()) return;
    const next = this.clamp(Number(value), -15, 15);
    if (next === this.straighten) return;
    this.straighten = next;
    this.panX = 0;
    this.panY = 0;
    this.scheduleRender();
  }

  commitImageAdjustment(): void {
    if (this.isBusy()) return;
    this.commitEditorState();
  }

  toggleFlipHorizontal(): void {
    if (this.isBusy()) return;
    this.flipHorizontal = !this.flipHorizontal;
    this.commitEditorState();
  }

  updateBrightness(value: number | string): void {
    this.updateToneAdjustment('brightness', value, 50, 150, 100);
  }

  updateContrast(value: number | string): void {
    this.updateToneAdjustment('contrast', value, 50, 150, 100);
  }

  updateSaturation(value: number | string): void {
    this.updateToneAdjustment('saturation', value, 0, 200, 100);
  }

  resetAdjustments(): void {
    if (this.isBusy()) return;
    this.straighten = 0;
    this.flipHorizontal = false;
    this.brightness = 100;
    this.contrast = 100;
    this.saturation = 100;
    this.panX = 0;
    this.panY = 0;
    this.commitEditorState();
  }

  resetCrop(): void {
    if (this.isBusy() || !this.hasCustomCrop) return;
    this.cropRect = { ...PHOTO_EDITOR_FULL_CROP_RECT };
    this.draftCropRect = null;
    this.commitEditorState();
  }

  resetEditor(): void {
    if (this.isBusy()) return;
    this.rotation = 0;
    this.straighten = 0;
    this.flipHorizontal = false;
    this.brightness = 100;
    this.contrast = 100;
    this.saturation = 100;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.aspectRatio = this.resolvePresetAspectRatio();
    this.cropRect = { ...PHOTO_EDITOR_FULL_CROP_RECT };
    this.draftCropRect = null;
    this.activeTool = 'move';
    this.selectedOverlayId = null;
    this.overlays = [];
    this.privacyShape = 'rectangle';
    this.privacyBrushSize = 12;
    this.privacyBrushMode = 'paint';
    this.draftPrivacyRegion = null;
    this.newDateTimeMeta = createPhotoEditorDateTimeMeta();
    this.commitEditorState();
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.sourceImage || this.isBusy()) return;
    const point = this.resolveNormalizedPointer(event);
    if (!point) return;

    if (
      (this.activeTool === 'blur' || this.activeTool === 'pixelate') &&
      this.privacyShape === 'brush'
    ) {
      this.selectedOverlayId = null;
      this.draggingPointerId = event.pointerId;
      this.brushStrokeSnapshot = clonePhotoEditorOverlays(this.overlays);
      this.brushCursorPoint = point;
      this.brushEraseChanged = false;

      if (this.privacyBrushMode === 'erase') {
        this.pointerInteraction = 'privacy-brush-erase';
        this.brushEraseChanged = this.eraseBrushAt(point);
      } else {
        this.pointerInteraction = 'privacy-brush';
        const overlay = this.createBrushOverlay(point);
        this.brushStrokeOverlayId = overlay.id;
        this.overlays = [...this.overlays, overlay];
      }

      this.capturePointer(event.pointerId);
      this.scheduleRender();
      event.preventDefault();
      return;
    }

    const resizeHandle = this.hitTestSelectedPrivacyResizeHandle(point);
    if (resizeHandle && this.selectedOverlayId) {
      this.pointerInteraction = 'overlay-resize';
      this.activeResizeHandle = resizeHandle;
      this.overlayDragSnapshot = clonePhotoEditorOverlays(this.overlays);
      this.overlayDragChanged = false;
      this.draggingPointerId = event.pointerId;
      this.capturePointer(event.pointerId);
      this.scheduleRender();
      event.preventDefault();
      return;
    }

    const hitOverlay = this.hitTestOverlay(point);
    if (hitOverlay) {
      this.selectedOverlayId = hitOverlay.id;
      this.pointerInteraction = 'overlay';
      this.overlayDragSnapshot = clonePhotoEditorOverlays(this.overlays);
      this.overlayDragChanged = false;
      this.draggingPointerId = event.pointerId;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.capturePointer(event.pointerId);
      this.scheduleRender();
      event.preventDefault();
      return;
    }

    this.selectedOverlayId = null;

    if (this.activeTool === 'crop' && !this.isAspectRatioLocked) {
      const cropHandle = this.hitTestCropResizeHandle(point);
      this.draggingPointerId = event.pointerId;
      this.cropInteractionSnapshot = { ...this.cropRect };
      this.cropInteractionChanged = false;

      if (cropHandle && this.hasCustomCrop) {
        this.pointerInteraction = 'crop-resize';
        this.activeCropResizeHandle = cropHandle;
      } else if (this.hasCustomCrop && this.isPointInsideCrop(point, this.cropRect)) {
        this.pointerInteraction = 'crop-move';
        this.cropStartPoint = point;
      } else {
        this.pointerInteraction = 'crop';
        this.cropStartPoint = point;
        this.draftCropRect = {
          x: point.x,
          y: point.y,
          width: 0,
          height: 0,
        };
      }

      this.capturePointer(event.pointerId);
      this.scheduleRender();
      event.preventDefault();
      return;
    }

    if (this.activeTool === 'move') {
      this.pointerInteraction = 'pan';
      this.draggingPointerId = event.pointerId;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.capturePointer(event.pointerId);
      event.preventDefault();
      return;
    }

    if (this.isPrivacyTool) {
      this.pointerInteraction = 'privacy';
      this.draggingPointerId = event.pointerId;
      this.draftPrivacyRegion = {
        kind: this.activeTool,
        startX: point.x,
        startY: point.y,
        endX: point.x,
        endY: point.y,
        strength: this.privacyStrength / 100,
        ...(this.activeTool === 'bar'
          ? { opacity: this.privacyOpacity / 100 }
          : {
              shape:
                this.privacyShape === 'ellipse' ? 'ellipse' : 'rectangle',
            }),
      };
      this.capturePointer(event.pointerId);
      this.scheduleRender();
      event.preventDefault();
      return;
    }

    this.placeDecorationAt(point);
    event.preventDefault();
  }

  onPointerMove(event: PointerEvent): void {
    if (this.isBusy()) return;

    if (
      (this.activeTool === 'blur' || this.activeTool === 'pixelate') &&
      this.privacyShape === 'brush' &&
      !this.selectedOverlay
    ) {
      const hoverPoint = this.resolveNormalizedPointer(event);
      if (hoverPoint) {
        this.brushCursorPoint = hoverPoint;
        this.scheduleRender();
      }
    }

    if (this.draggingPointerId !== event.pointerId) return;

    const width = Math.max(1, this.previewWidth);
    const height = Math.max(1, this.previewHeight);

    if (this.pointerInteraction === 'pan') {
      this.panX += (event.clientX - this.lastPointerX) / width;
      this.panY += (event.clientY - this.lastPointerY) / height;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.scheduleRender();
      event.preventDefault();
      return;
    }

    if (
      this.pointerInteraction === 'overlay-resize' &&
      this.selectedOverlayId &&
      this.activeResizeHandle
    ) {
      const point = this.resolveNormalizedPointer(event);
      if (!point) return;
      const changed = this.resizeSelectedPrivacyOverlay(
        point,
        this.activeResizeHandle
      );
      this.overlayDragChanged = changed || this.overlayDragChanged;
      if (changed) {
        this.scheduleRender();
      }
      event.preventDefault();
      return;
    }

    if (this.pointerInteraction === 'overlay' && this.selectedOverlayId) {
      const deltaX = (event.clientX - this.lastPointerX) / width;
      const deltaY = (event.clientY - this.lastPointerY) / height;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      if (deltaX || deltaY) {
        this.overlays = this.overlays.map((overlay) =>
          overlay.id === this.selectedOverlayId
            ? this.offsetOverlay(overlay, deltaX, deltaY)
            : overlay
        );
        this.overlayDragChanged = true;
        this.scheduleRender();
      }
      event.preventDefault();
      return;
    }

    if (this.pointerInteraction === 'privacy-brush') {
      const point = this.resolveNormalizedPointer(event);
      if (!point) return;
      this.brushCursorPoint = point;
      this.appendBrushPoint(point);
      this.scheduleRender();
      event.preventDefault();
      return;
    }

    if (this.pointerInteraction === 'privacy-brush-erase') {
      const point = this.resolveNormalizedPointer(event);
      if (!point) return;
      this.brushCursorPoint = point;
      this.brushEraseChanged = this.eraseBrushAt(point) || this.brushEraseChanged;
      this.scheduleRender();
      event.preventDefault();
      return;
    }

    if (this.pointerInteraction === 'privacy' && this.draftPrivacyRegion) {
      const point = this.resolveNormalizedPointer(event);
      if (!point) return;
      this.draftPrivacyRegion = {
        ...this.draftPrivacyRegion,
        endX: point.x,
        endY: point.y,
      };
      this.scheduleRender();
      event.preventDefault();
      return;
    }

    if (this.pointerInteraction === 'crop' && this.cropStartPoint) {
      const point = this.resolveNormalizedPointer(event);
      if (!point) return;
      this.draftCropRect = this.createRawCropRect(this.cropStartPoint, point);
      this.cropInteractionChanged =
        this.draftCropRect.width >= PHOTO_EDITOR_MIN_CROP_SIZE &&
        this.draftCropRect.height >= PHOTO_EDITOR_MIN_CROP_SIZE;
      this.scheduleRender();
      event.preventDefault();
      return;
    }

    if (this.pointerInteraction === 'crop-move' && this.cropStartPoint) {
      const point = this.resolveNormalizedPointer(event);
      if (!point || !this.cropInteractionSnapshot) return;
      const deltaX = point.x - this.cropStartPoint.x;
      const deltaY = point.y - this.cropStartPoint.y;
      const next = this.moveCropRect(
        this.cropInteractionSnapshot,
        deltaX,
        deltaY
      );
      this.cropInteractionChanged =
        next.x !== this.cropRect.x || next.y !== this.cropRect.y;
      this.cropRect = next;
      this.scheduleRender();
      event.preventDefault();
      return;
    }

    if (
      this.pointerInteraction === 'crop-resize' &&
      this.activeCropResizeHandle &&
      this.cropInteractionSnapshot
    ) {
      const point = this.resolveNormalizedPointer(event);
      if (!point) return;
      const next = this.resizeCropRect(
        this.cropInteractionSnapshot,
        point,
        this.activeCropResizeHandle
      );
      this.cropInteractionChanged =
        next.x !== this.cropRect.x ||
        next.y !== this.cropRect.y ||
        next.width !== this.cropRect.width ||
        next.height !== this.cropRect.height;
      this.cropRect = next;
      this.scheduleRender();
      event.preventDefault();
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (this.draggingPointerId !== event.pointerId) return;
    if (this.pointerInteraction === 'privacy-brush') {
      if (this.brushStrokeOverlayId) {
        this.selectedOverlayId = null;
        this.commitOverlays(this.overlays);
      } else if (this.brushStrokeSnapshot) {
        this.overlays = clonePhotoEditorOverlays(this.brushStrokeSnapshot);
      }
    } else if (this.pointerInteraction === 'privacy-brush-erase') {
      if (this.brushEraseChanged) {
        this.selectedOverlayId = null;
        this.commitOverlays(this.overlays);
      } else if (this.brushStrokeSnapshot) {
        this.overlays = clonePhotoEditorOverlays(this.brushStrokeSnapshot);
      }
    } else if (this.pointerInteraction === 'privacy' && this.draftPrivacyRegion) {
      const overlay = privacyRegionFromDraft(this.draftPrivacyRegion);
      if (overlay) {
        this.selectedOverlayId = overlay.id;
        this.commitOverlays([...this.overlays, overlay]);
      }
    } else if (this.pointerInteraction === 'crop' && this.draftCropRect) {
      if (
        this.draftCropRect.width >= PHOTO_EDITOR_MIN_CROP_SIZE &&
        this.draftCropRect.height >= PHOTO_EDITOR_MIN_CROP_SIZE
      ) {
        this.cropRect = normalizePhotoEditorCropRect(this.draftCropRect);
        this.commitEditorState();
      } else if (this.cropInteractionSnapshot) {
        this.cropRect = { ...this.cropInteractionSnapshot };
      }
    } else if (
      (this.pointerInteraction === 'crop-move' ||
        this.pointerInteraction === 'crop-resize') &&
      this.cropInteractionChanged
    ) {
      this.commitEditorState();
    } else if (
      this.pointerInteraction === 'overlay-resize' &&
      this.overlayDragChanged
    ) {
      this.commitOverlays(this.overlays);
    } else if (this.pointerInteraction === 'overlay' && this.overlayDragChanged) {
      this.commitOverlays(this.overlays);
    } else if (this.pointerInteraction === 'pan') {
      this.commitEditorState();
    }
    this.cancelPointerInteraction(true, event.pointerId);
  }

  onPointerCancel(event: PointerEvent): void {
    if (this.draggingPointerId !== event.pointerId) return;
    if (
      (this.pointerInteraction === 'privacy-brush' ||
        this.pointerInteraction === 'privacy-brush-erase') &&
      this.brushStrokeSnapshot
    ) {
      this.overlays = clonePhotoEditorOverlays(this.brushStrokeSnapshot);
    } else if (
      (this.pointerInteraction === 'overlay' ||
        this.pointerInteraction === 'overlay-resize') &&
      this.overlayDragSnapshot
    ) {
      this.overlays = clonePhotoEditorOverlays(this.overlayDragSnapshot);
    } else if (this.pointerInteraction === 'pan') {
      const snapshot = this.photoEditorHistory.current;
      if (snapshot) this.restoreHistorySnapshot(snapshot);
    } else if (
      (this.pointerInteraction === 'crop' ||
        this.pointerInteraction === 'crop-move' ||
        this.pointerInteraction === 'crop-resize') &&
      this.cropInteractionSnapshot
    ) {
      this.cropRect = { ...this.cropInteractionSnapshot };
      this.draftCropRect = null;
    }
    this.cancelPointerInteraction(true, event.pointerId);
  }

  onCanvasKeydown(event: KeyboardEvent): void {
    if (this.isBusy()) return;
    const key = event.key.toLowerCase();

    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redoOverlay() : this.undoOverlay();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault();
      this.redoOverlay();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'd' && this.selectedOverlay) {
      event.preventDefault();
      this.duplicateSelectedOverlay();
      return;
    }
    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      this.selectedOverlay
    ) {
      event.preventDefault();
      this.removeSelectedOverlay();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.selectedOverlay) {
        this.selectOverlay(null);
      } else if (this.activeTool !== 'move') {
        this.selectTool('move');
      }
      return;
    }
    if (event.key === 'Enter' && this.isDecorationTool && !this.selectedOverlay) {
      event.preventDefault();
      this.addCurrentToolAtCenter();
      return;
    }

    const selected = this.selectedOverlay;
    if (selected && event.key.startsWith('Arrow')) {
      const step = event.shiftKey
        ? KEYBOARD_OVERLAY_STEP * 3
        : KEYBOARD_OVERLAY_STEP;
      let deltaX = 0;
      let deltaY = 0;
      if (event.key === 'ArrowLeft') deltaX = -step;
      else if (event.key === 'ArrowRight') deltaX = step;
      else if (event.key === 'ArrowUp') deltaY = -step;
      else if (event.key === 'ArrowDown') deltaY = step;
      event.preventDefault();
      this.commitOverlays(
        this.overlays.map((overlay) =>
          overlay.id === selected.id
            ? this.offsetOverlay(overlay, deltaX, deltaY)
            : overlay
        )
      );
      return;
    }

    if (
      this.activeTool === 'crop' &&
      !this.isAspectRatioLocked &&
      !this.selectedOverlay
    ) {
      if (event.key.startsWith('Arrow')) {
        const step = event.shiftKey ? KEYBOARD_CROP_STEP * 3 : KEYBOARD_CROP_STEP;
        let deltaX = 0;
        let deltaY = 0;
        if (event.key === 'ArrowLeft') deltaX = -step;
        else if (event.key === 'ArrowRight') deltaX = step;
        else if (event.key === 'ArrowUp') deltaY = -step;
        else if (event.key === 'ArrowDown') deltaY = step;
        event.preventDefault();
        this.cropRect = this.moveCropRect(this.cropRect, deltaX, deltaY);
        this.commitEditorState();
        return;
      }

      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        const delta =
          event.key === ']'
            ? KEYBOARD_CROP_RESIZE_STEP
            : -KEYBOARD_CROP_RESIZE_STEP;
        this.cropRect = this.resizeCropFromCenter(this.cropRect, delta);
        this.commitEditorState();
        return;
      }

      if (key === '0' && this.hasCustomCrop) {
        event.preventDefault();
        this.resetCrop();
        return;
      }
    }

    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      const shortcutTool: Partial<Record<string, PhotoEditorTool>> = {
        m: 'move',
        c: 'crop',
        b: 'blur',
        p: 'pixelate',
      };
      const tool = shortcutTool[key];
      if (tool && !this.isToolDisabled(tool)) {
        event.preventDefault();
        this.selectTool(tool);
        return;
      }
    }

    if (this.activeTool !== 'move') return;
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
        this.zoom = this.clamp(this.zoom + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
        break;
      case '-':
      case '_':
        this.zoom = this.clamp(this.zoom - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      this.commitEditorState();
    }
  }

  async save(): Promise<void> {
    if (!this.userId || !this.sourceImage || this.isBusy()) return;

    const originalMeta = this.resolveOriginalFileMetadata();
    if (!originalMeta) {
      this.reportError(
        'Imagem de origem indisponível para edição.',
        new Error('Metadados da imagem não foram resolvidos.'),
        { op: 'save.resolveOriginalFileMetadata' }
      );
      return;
    }

    this.isSavingSubject.next(true);
    this.errorMessageSubject.next(null);

    try {
      const exported = await this.exportImage(originalMeta.mimeType);
      const imageStateStr = JSON.stringify(this.buildEditorState());
      const file = this.createProcessedFile(
        exported.blob,
        originalMeta.fileName,
        exported.blob.type || originalMeta.mimeType
      );
      const result: PhotoEditorProcessedResult = {
        kind: 'image',
        file,
        imageStateStr,
        width: exported.width,
        height: exported.height,
        context: this.activeDraft?.context ?? 'generic',
        preset: this.activePreset,
        metadataStripped: true,
      };
      this.closeWithProcessedResult(result);
    } catch (error) {
      this.reportError('Erro ao aplicar a edição na imagem.', error, {
        op: 'save',
        source: this.activeDraft?.source ?? 'direct-input',
        preset: this.activePreset,
      });
    } finally {
      this.isSavingSubject.next(false);
    }
  }

  onClose(): void {
    if (this.isClosingSubject.value) return;
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
      this.assertInteractivePixelBudget(image);
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

    if (this.effectiveStoredImageUrl) return this.effectiveStoredImageUrl;
    if (!this.sourceFile) return null;

    this.revokeSourceObjectUrl();
    this.sourceObjectUrl = URL.createObjectURL(this.sourceFile);
    return this.sourceObjectUrl;
  }

  private assertInteractivePixelBudget(image: HTMLImageElement): void {
    const pixels = image.naturalWidth * image.naturalHeight;

    if (
      !Number.isSafeInteger(pixels)
      || pixels <= 0
      || pixels > MEDIA_IMAGE_EDITOR_MAX_INTERACTIVE_PIXELS
    ) {
      throw new Error(
        'A imagem excede o limite de pixels seguro para edição neste dispositivo.'
      );
    }
  }

  private createImage(src: string): Promise<HTMLImageElement> {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      if (/^https?:\/\//i.test(src)) image.crossOrigin = 'anonymous';
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
    if (!this.viewReady || !this.sourceImage || this.isClosingSubject.value) return;
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
    if (stageRect.width < 80 || stageRect.height < 80) return;

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
    this.drawBrushCursor(context, this.previewWidth, this.previewHeight);
    if (this.activeTool === 'crop' || this.hasCustomCrop) {
      this.drawCropGuide(context, this.previewWidth, this.previewHeight);
    }
  }

  private drawImageFrame(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    preview: boolean
  ): void {
    const baseCanvas = this.document.createElement('canvas');
    baseCanvas.width = Math.max(1, Math.round(width));
    baseCanvas.height = Math.max(1, Math.round(height));
    const baseContext = baseCanvas.getContext('2d');
    if (!baseContext) return;

    this.drawBaseImage(baseContext, width, height, preview);
    context.save();
    context.clearRect(0, 0, width, height);
    context.drawImage(baseCanvas, 0, 0, width, height);
    drawPhotoEditorOverlays({
      context,
      baseCanvas,
      width,
      height,
      overlays: this.overlays,
      draftRegion: preview ? this.draftPrivacyRegion : null,
      selectedOverlayId: preview ? this.selectedOverlayId : null,
      preview,
      createCanvas: () => this.document.createElement('canvas'),
    });
    context.restore();
  }

  private drawBaseImage(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    preview: boolean
  ): void {
    const image = this.sourceImage;
    if (!image) return;

    context.save();
    context.clearRect(0, 0, width, height);
    if (preview) {
      context.fillStyle = '#080b10';
      context.fillRect(0, 0, width, height);
    } else if (this.resolveOutputMimeType() === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }

    const effectiveRotation = this.rotation + this.straighten;
    const radians = (effectiveRotation * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(radians));
    const absSin = Math.abs(Math.sin(radians));
    const baseScale = Math.max(
      (absCos * width + absSin * height) /
        Math.max(1, image.naturalWidth),
      (absSin * width + absCos * height) /
        Math.max(1, image.naturalHeight)
    );
    const scale = baseScale * this.zoom;
    const displayedWidth =
      (absCos * image.naturalWidth + absSin * image.naturalHeight) * scale;
    const displayedHeight =
      (absSin * image.naturalWidth + absCos * image.naturalHeight) * scale;
    const maxPanX = Math.max(0, (displayedWidth - width) / 2) / width;
    const maxPanY = Math.max(0, (displayedHeight - height) / 2) / height;

    this.panX = this.clamp(this.panX, -maxPanX, maxPanX);
    this.panY = this.clamp(this.panY, -maxPanY, maxPanY);

    context.translate(
      width / 2 + this.panX * width,
      height / 2 + this.panY * height
    );
    context.rotate(radians);
    context.scale(this.flipHorizontal ? -scale : scale, scale);
    context.filter =
      `brightness(${this.brightness}%) contrast(${this.contrast}%) saturate(${this.saturation}%)`;
    context.drawImage(
      image,
      -image.naturalWidth / 2,
      -image.naturalHeight / 2
    );
    context.filter = 'none';
    context.restore();
  }

  private async exportImage(
    originalMimeType: string
  ): Promise<ExportedPhotoEditorImage> {
    const preset = resolveImageEditorPreset(this.activePreset);
    const maxOutputEdge = preset.maxOutputEdge;
    const workingRatio = this.resolveOutputAspectRatio();
    let workingWidth: number = maxOutputEdge;
    let workingHeight = Math.round(workingWidth / workingRatio);

    if (workingHeight > maxOutputEdge) {
      workingHeight = maxOutputEdge;
      workingWidth = Math.round(workingHeight * workingRatio);
    }

    const workingCanvas = this.document.createElement('canvas');
    workingCanvas.width = Math.max(1, workingWidth);
    workingCanvas.height = Math.max(1, workingHeight);
    const workingContext = workingCanvas.getContext('2d');
    if (!workingContext) {
      throw new Error('Canvas de exportação indisponível.');
    }

    this.drawImageFrame(
      workingContext,
      workingCanvas.width,
      workingCanvas.height,
      false
    );

    const cropGeometry = resolvePhotoEditorCropOutputGeometry(
      workingCanvas.width,
      workingCanvas.height,
      this.cropRect,
      maxOutputEdge
    );

    const output = this.document.createElement('canvas');
    output.width = cropGeometry.outputWidth;
    output.height = cropGeometry.outputHeight;
    const context = output.getContext('2d');
    if (!context) {
      throw new Error('Canvas de exportação indisponível.');
    }

    context.drawImage(
      workingCanvas,
      cropGeometry.sourceX,
      cropGeometry.sourceY,
      cropGeometry.sourceWidth,
      cropGeometry.sourceHeight,
      0,
      0,
      output.width,
      output.height
    );

    const preferredMimeType = this.normalizeOutputMimeType(originalMimeType);
    const blob = await this.canvasToBlob(
      output,
      preferredMimeType,
      preset.lossyQuality
    );
    if (blob) {
      return { blob, width: output.width, height: output.height };
    }

    const fallback = await this.canvasToBlob(
      output,
      'image/jpeg',
      preset.lossyQuality
    );
    if (!fallback) {
      throw new Error('O navegador não conseguiu exportar a imagem.');
    }
    return { blob: fallback, width: output.width, height: output.height };
  }

  private canvasToBlob(
    canvas: HTMLCanvasElement,
    mimeType: string,
    lossyQuality: number
  ): Promise<Blob | null> {
    return new Promise((resolve) => {
      canvas.toBlob(
        resolve,
        mimeType,
        mimeType === 'image/png' ? undefined : lossyQuality
      );
    });
  }

  private resolveOutputAspectRatio(): number {
    if (this.aspectRatio === 'square') return 1;
    if (this.aspectRatio === 'portrait') return 4 / 5;
    if (this.aspectRatio === 'landscape') return 16 / 9;

    const image = this.sourceImage;
    if (!image) return 1;
    const quarterTurn = Math.abs(this.rotation % 180) === 90;
    const width = quarterTurn ? image.naturalHeight : image.naturalWidth;
    const height = quarterTurn ? image.naturalWidth : image.naturalHeight;
    return Math.max(0.1, width / Math.max(1, height));
  }

  private buildEditorState(): PhotoEditorNativeStateV2 {
    return {
      version: 2,
      editor: 'native-canvas',
      flattened: true,
      rotation: this.rotation,
      straighten: Number(this.straighten.toFixed(2)),
      flipHorizontal: this.flipHorizontal,
      brightness: Math.round(this.brightness),
      contrast: Math.round(this.contrast),
      saturation: Math.round(this.saturation),
      zoom: Number(this.zoom.toFixed(3)),
      panX: Number(this.panX.toFixed(4)),
      panY: Number(this.panY.toFixed(4)),
      aspectRatio: this.aspectRatio,
      cropRect: normalizePhotoEditorCropRect(this.cropRect),
      overlays: clonePhotoEditorOverlays(this.overlays),
    };
  }

  private applyStoredEditorState(value: string | null): void {
    // Uma fonte armazenada já é a derivada achatada publicada/privada. Reaplicar
    // o estado duplicaria corte, texto e proteção visual.
    if (!value || this.isStoredSource) {
      this.rotation = 0;
      this.straighten = 0;
      this.flipHorizontal = false;
      this.brightness = 100;
      this.contrast = 100;
      this.saturation = 100;
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.aspectRatio = this.resolvePresetAspectRatio();
      this.cropRect = { ...PHOTO_EDITOR_FULL_CROP_RECT };
      this.resetOverlayHistory([]);
      return;
    }

    try {
      const parsed = JSON.parse(value) as
        | Partial<PhotoEditorNativeStateV1>
        | Partial<PhotoEditorNativeStateV2>;

      if (parsed.editor !== 'native-canvas') {
        this.rotation = 0;
        this.straighten = 0;
        this.flipHorizontal = false;
        this.brightness = 100;
        this.contrast = 100;
        this.saturation = 100;
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.aspectRatio = this.resolvePresetAspectRatio();
        this.cropRect = { ...PHOTO_EDITOR_FULL_CROP_RECT };
        this.resetOverlayHistory([]);
        return;
      }

      const parsedV2 = parsed as Partial<PhotoEditorNativeStateV2>;
      this.rotation = this.normalizeRotation(Number(parsed.rotation ?? 0));
      this.straighten = this.clamp(Number(parsedV2.straighten ?? 0), -15, 15);
      this.flipHorizontal = parsedV2.flipHorizontal === true;
      this.brightness = this.clamp(Number(parsedV2.brightness ?? 100), 50, 150);
      this.contrast = this.clamp(Number(parsedV2.contrast ?? 100), 50, 150);
      this.saturation = this.clamp(Number(parsedV2.saturation ?? 100), 0, 200);
      this.zoom = this.clamp(Number(parsed.zoom ?? 1), MIN_ZOOM, MAX_ZOOM);
      this.panX = this.clamp(Number(parsed.panX ?? 0), -1, 1);
      this.panY = this.clamp(Number(parsed.panY ?? 0), -1, 1);
      this.aspectRatio = this.isAspectRatioLocked
        ? this.resolvePresetAspectRatio()
        : this.normalizeAspectRatio(parsed.aspectRatio);
      this.cropRect = this.isAspectRatioLocked
        ? { ...PHOTO_EDITOR_FULL_CROP_RECT }
        : normalizePhotoEditorCropRect(parsedV2.cropRect);

      const overlays =
        parsed.version === 2
          ? normalizePhotoEditorOverlays(parsedV2.overlays)
          : [];
      this.resetOverlayHistory(overlays);
    } catch {
      this.rotation = 0;
      this.straighten = 0;
      this.flipHorizontal = false;
      this.brightness = 100;
      this.contrast = 100;
      this.saturation = 100;
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.aspectRatio = this.resolvePresetAspectRatio();
      this.cropRect = { ...PHOTO_EDITOR_FULL_CROP_RECT };
      this.resetOverlayHistory([]);
      // Estados de editores antigos ou inválidos são deliberadamente ignorados.
    }
  }

  private normalizeAspectRatio(value: unknown): PhotoEditorAspectRatio {
    return value === 'square' ||
      value === 'portrait' ||
      value === 'landscape'
      ? value
      : 'original';
  }

  private resolvePresetAspectRatio(): PhotoEditorAspectRatio {
    return this.normalizeAspectRatio(
      resolveImageEditorPreset(this.activePreset).aspectRatio
    );
  }

  private normalizeRotation(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  }

  private resolveEffectiveState(draft: IPhotoEditorDraft | null): void {
    this.isStoredSource =
      draft?.mode === 'edit' || !!String(this.storedImageUrl() ?? '').trim();
    this.effectiveStoredImageUrl =
      String(this.storedImageUrl() ?? '').trim() ||
      (draft?.mode === 'edit' ? draft.storedImageUrl : '') ||
      null;
    this.effectiveStoredImageState =
      String(this.storedImageState() ?? '').trim() ||
      (draft?.mode === 'edit' ? String(draft.storedImageState ?? '') : '') ||
      null;
    this.aspectRatio = this.resolvePresetAspectRatio();
  }

  private isValidDraft(
    draft: IPhotoEditorDraft | null,
    authenticatedUid: string
  ): boolean {
    if (!draft) return true;
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
    const url = String(this.effectiveStoredImageUrl ?? '').trim();
    const fileName =
      draftFileName ||
      this.extractFileName(url) ||
      `foto-${Date.now()}.jpg`;

    return {
      fileName,
      mimeType: this.normalizeOutputMimeType(this.guessMimeType(fileName)),
    };
  }

  private createProcessedFile(
    blob: Blob,
    originalFileName: string,
    mimeType: string
  ): File {
    const extension = this.extensionForMimeType(mimeType);
    const baseName =
      String(originalFileName || 'foto')
        .trim()
        .replace(/\.[^.]+$/, '') || 'foto';
    return new File([blob], `${baseName}-editada.${extension}`, {
      type: mimeType,
      lastModified: Date.now(),
    });
  }

  private extensionForMimeType(mimeType: string): string {
    const normalized = this.normalizeOutputMimeType(mimeType);
    if (normalized === 'image/png') return 'png';
    if (normalized === 'image/webp') return 'webp';
    return 'jpg';
  }

  private placeDecorationAt(point: PhotoEditorNormalizedPoint): void {
    let overlay: PhotoEditorOverlay | null = null;
    const size = this.decorationSize / 100;

    if (this.activeTool === 'emoji') {
      overlay = {
        id: createPhotoEditorOverlayId(),
        kind: 'emoji',
        x: point.x,
        y: point.y,
        size,
        value: this.selectedEmoji,
        style: this.captionStyle,
        fontFamily: this.captionFontFamily,
      };
    } else if (this.activeTool === 'text') {
      const value = this.captionText.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!value) return;
      overlay = {
        id: createPhotoEditorOverlayId(),
        kind: 'text',
        x: point.x,
        y: point.y,
        size,
        value,
        style: this.captionStyle,
        fontFamily: this.captionFontFamily,
      };
    } else if (this.activeTool === 'datetime') {
      const dateTimeMeta = { ...this.newDateTimeMeta };
      overlay = {
        id: createPhotoEditorOverlayId(),
        kind: 'datetime',
        x: point.x,
        y: point.y,
        size,
        value: formatPhotoEditorDateTime(dateTimeMeta),
        style: this.captionStyle,
        fontFamily: this.captionFontFamily,
        dateTimeMeta,
      };
    }

    if (overlay) {
      this.selectedOverlayId = overlay.id;
      this.commitOverlays([...this.overlays, overlay]);
    }
  }

  private updateSelectedDecoration(
    transform: (
      overlay: PhotoEditorDecorationOverlay
    ) => PhotoEditorDecorationOverlay,
    commit: boolean
  ): void {
    const selectedId = this.selectedOverlayId;
    if (!selectedId || this.isBusy()) return;
    let changed = false;
    this.overlays = this.overlays.map((overlay) => {
      if (
        overlay.id !== selectedId ||
        (overlay.kind !== 'emoji' &&
          overlay.kind !== 'text' &&
          overlay.kind !== 'datetime')
      ) {
        return overlay;
      }
      changed = true;
      return transform(overlay);
    });
    if (!changed) return;
    if (commit) this.commitOverlays(this.overlays);
    else this.scheduleRender();
  }

  private updateSelectedPrivacy(
    transform: (overlay: PhotoEditorPrivacyOverlay) => PhotoEditorPrivacyOverlay,
    commit: boolean
  ): void {
    const selectedId = this.selectedOverlayId;
    if (!selectedId || this.isBusy()) return;
    let changed = false;
    this.overlays = this.overlays.map((overlay) => {
      if (
        overlay.id !== selectedId ||
        (overlay.kind !== 'blur' &&
          overlay.kind !== 'pixelate' &&
          overlay.kind !== 'bar')
      ) {
        return overlay;
      }
      changed = true;
      return transform(overlay);
    });
    if (!changed) return;
    if (commit) this.commitOverlays(this.overlays);
    else this.scheduleRender();
  }

  private updateSelectedDateTimeMeta(
    patch: Partial<PhotoEditorDateTimeMeta>,
    commit: boolean
  ): void {
    this.updateSelectedDecoration((overlay) => {
      if (overlay.kind !== 'datetime') return overlay;
      const dateTimeMeta = {
        ...(overlay.dateTimeMeta ?? createPhotoEditorDateTimeMeta()),
        ...patch,
      };
      return {
        ...overlay,
        dateTimeMeta,
        value: formatPhotoEditorDateTime(dateTimeMeta),
      };
    }, commit);
  }

  private hitTestSelectedPrivacyResizeHandle(
    point: PhotoEditorNormalizedPoint
  ): PhotoEditorResizeHandle | null {
    const selected = this.selectedOverlay;
    if (
      !selected ||
      (selected.kind !== 'blur' &&
        selected.kind !== 'pixelate' &&
        selected.kind !== 'bar') ||
      ((selected.kind === 'blur' || selected.kind === 'pixelate') &&
        selected.shape === 'brush') ||
      !this.previewWidth ||
      !this.previewHeight
    ) {
      return null;
    }

    const width = this.previewWidth;
    const height = this.previewHeight;
    const padding = Math.max(5, Math.min(width, height) * 0.008);
    const hitRadius = Math.max(12, Math.min(width, height) * 0.018);
    const pixelX = point.x * width;
    const pixelY = point.y * height;
    const left = selected.x * width - padding;
    const top = selected.y * height - padding;
    const right = (selected.x + selected.width) * width + padding;
    const bottom = (selected.y + selected.height) * height + padding;

    const handles: ReadonlyArray<
      readonly [PhotoEditorResizeHandle, number, number]
    > = [
      ['nw', left, top],
      ['ne', right, top],
      ['sw', left, bottom],
      ['se', right, bottom],
    ];

    for (const [handle, x, y] of handles) {
      if (Math.hypot(pixelX - x, pixelY - y) <= hitRadius) {
        return handle;
      }
    }

    return null;
  }

  private resizeSelectedPrivacyOverlay(
    point: PhotoEditorNormalizedPoint,
    handle: PhotoEditorResizeHandle
  ): boolean {
    const selectedId = this.selectedOverlayId;
    const snapshot = this.overlayDragSnapshot;
    if (!selectedId || !snapshot) return false;

    const original = snapshot.find((overlay) => overlay.id === selectedId);
    if (
      !original ||
      (original.kind !== 'blur' &&
        original.kind !== 'pixelate' &&
        original.kind !== 'bar') ||
      ((original.kind === 'blur' || original.kind === 'pixelate') &&
        original.shape === 'brush')
    ) {
      return false;
    }

    const left = original.x;
    const top = original.y;
    const right = original.x + original.width;
    const bottom = original.y + original.height;
    let x = left;
    let y = top;
    let width = original.width;
    let height = original.height;

    if (handle === 'nw' || handle === 'sw') {
      x = this.clamp(point.x, 0, right - PHOTO_EDITOR_MIN_PRIVACY_SIZE);
      width = right - x;
    } else {
      const nextRight = this.clamp(
        point.x,
        left + PHOTO_EDITOR_MIN_PRIVACY_SIZE,
        1
      );
      width = nextRight - left;
    }

    if (handle === 'nw' || handle === 'ne') {
      y = this.clamp(point.y, 0, bottom - PHOTO_EDITOR_MIN_PRIVACY_SIZE);
      height = bottom - y;
    } else {
      const nextBottom = this.clamp(
        point.y,
        top + PHOTO_EDITOR_MIN_PRIVACY_SIZE,
        1
      );
      height = nextBottom - top;
    }

    const next = { ...original, x, y, width, height };
    const changed =
      Math.abs(next.x - original.x) > Number.EPSILON ||
      Math.abs(next.y - original.y) > Number.EPSILON ||
      Math.abs(next.width - original.width) > Number.EPSILON ||
      Math.abs(next.height - original.height) > Number.EPSILON;

    if (!changed) return false;

    this.overlays = this.overlays.map((overlay) =>
      overlay.id === selectedId ? next : overlay
    );
    return true;
  }

  private hitTestOverlay(
    point: PhotoEditorNormalizedPoint
  ): PhotoEditorOverlay | null {
    const canvas = this.editorCanvasRef.nativeElement;
    const context = canvas.getContext('2d');
    if (!context || !this.previewWidth || !this.previewHeight) return null;
    return hitTestPhotoEditorOverlay(
      this.overlays,
      point,
      this.previewWidth,
      this.previewHeight,
      context
    );
  }

  private offsetOverlay(
    overlay: PhotoEditorOverlay,
    deltaX: number,
    deltaY: number
  ): PhotoEditorOverlay {
    if (overlay.kind === 'blur' || overlay.kind === 'pixelate') {
      if (overlay.shape === 'brush') {
        const safeDeltaX = this.clamp(
          deltaX,
          -overlay.x,
          1 - overlay.x - overlay.width
        );
        const safeDeltaY = this.clamp(
          deltaY,
          -overlay.y,
          1 - overlay.y - overlay.height
        );
        return {
          ...overlay,
          x: overlay.x + safeDeltaX,
          y: overlay.y + safeDeltaY,
          points: overlay.points.map((point) => ({
            x: this.clamp(point.x + safeDeltaX, 0, 1),
            y: this.clamp(point.y + safeDeltaY, 0, 1),
          })),
        };
      }
      return {
        ...overlay,
        x: this.clamp(overlay.x + deltaX, 0, 1 - overlay.width),
        y: this.clamp(overlay.y + deltaY, 0, 1 - overlay.height),
      };
    }
    if (overlay.kind === 'bar') {
      return {
        ...overlay,
        x: this.clamp(overlay.x + deltaX, 0, 1 - overlay.width),
        y: this.clamp(overlay.y + deltaY, 0, 1 - overlay.height),
      };
    }
    return {
      ...overlay,
      x: this.clamp(overlay.x + deltaX, 0, 1),
      y: this.clamp(overlay.y + deltaY, 0, 1),
      ...(overlay.kind === 'datetime' && overlay.dateTimeMeta
        ? { dateTimeMeta: { ...overlay.dateTimeMeta } }
        : {}),
    };
  }

  private createBrushOverlay(
    point: PhotoEditorNormalizedPoint
  ): PhotoEditorPrivacyOverlay {
    const width = Math.max(1, this.previewWidth);
    const height = Math.max(1, this.previewHeight);
    const radiusPx = Math.max(
      3,
      (Math.min(width, height) * this.privacyBrushSize) / 200
    );
    const radiusX = this.clamp(radiusPx / width, 0.004, 0.25);
    const radiusY = this.clamp(radiusPx / height, 0.004, 0.25);
    const bounds = this.resolveBrushBounds([point], radiusX, radiusY);

    return {
      id: createPhotoEditorOverlayId(),
      kind: this.activeTool === 'pixelate' ? 'pixelate' : 'blur',
      shape: 'brush',
      ...bounds,
      radiusX,
      radiusY,
      points: [{ ...point }],
      strength: this.clamp(this.privacyStrength / 100, 0.008, 0.08),
    };
  }

  private appendBrushPoint(point: PhotoEditorNormalizedPoint): void {
    const overlayId = this.brushStrokeOverlayId;
    if (!overlayId) return;

    this.overlays = this.overlays.map((overlay) => {
      if (
        overlay.id !== overlayId ||
        (overlay.kind !== 'blur' && overlay.kind !== 'pixelate') ||
        overlay.shape !== 'brush'
      ) {
        return overlay;
      }

      const lastPoint = overlay.points[overlay.points.length - 1];
      if (!lastPoint) return overlay;
      const width = Math.max(1, this.previewWidth);
      const height = Math.max(1, this.previewHeight);
      const distance = Math.hypot(
        (point.x - lastPoint.x) * width,
        (point.y - lastPoint.y) * height
      );
      const radiusPx = Math.max(
        1,
        Math.min(overlay.radiusX * width, overlay.radiusY * height)
      );
      const spacing = Math.max(2, radiusPx * 0.55);
      const steps = Math.max(1, Math.ceil(distance / spacing));
      const points = [...overlay.points];

      for (let index = 1; index <= steps && points.length < 512; index += 1) {
        const fraction = index / steps;
        points.push({
          x: lastPoint.x + (point.x - lastPoint.x) * fraction,
          y: lastPoint.y + (point.y - lastPoint.y) * fraction,
        });
      }

      return {
        ...overlay,
        ...this.resolveBrushBounds(points, overlay.radiusX, overlay.radiusY),
        points,
      };
    });
  }

  private eraseBrushAt(point: PhotoEditorNormalizedPoint): boolean {
    const width = Math.max(1, this.previewWidth);
    const height = Math.max(1, this.previewHeight);
    const eraserRadiusPx = Math.max(
      3,
      (Math.min(width, height) * this.privacyBrushSize) / 200
    );
    let changed = false;

    this.overlays = this.overlays.flatMap((overlay) => {
      if (
        (overlay.kind !== 'blur' && overlay.kind !== 'pixelate') ||
        overlay.kind !== this.activeTool ||
        overlay.shape !== 'brush'
      ) {
        return [overlay];
      }

      const remainingPoints = overlay.points.filter((brushPoint) => {
        const dx = (brushPoint.x - point.x) * width;
        const dy = (brushPoint.y - point.y) * height;
        const brushRadiusPx = Math.max(
          1,
          Math.min(overlay.radiusX * width, overlay.radiusY * height)
        );
        return Math.hypot(dx, dy) > eraserRadiusPx + brushRadiusPx * 0.45;
      });

      if (remainingPoints.length === overlay.points.length) {
        return [overlay];
      }

      changed = true;
      if (remainingPoints.length === 0) {
        return [];
      }

      return [
        {
          ...overlay,
          ...this.resolveBrushBounds(
            remainingPoints,
            overlay.radiusX,
            overlay.radiusY
          ),
          points: remainingPoints,
        },
      ];
    });

    return changed;
  }

  private resolveBrushBounds(
    points: readonly PhotoEditorNormalizedPoint[],
    radiusX: number,
    radiusY: number
  ): PhotoEditorCropRect {
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    const x = this.clamp(minX - radiusX, 0, 1);
    const y = this.clamp(minY - radiusY, 0, 1);
    const right = this.clamp(maxX + radiusX, 0, 1);
    const bottom = this.clamp(maxY + radiusY, 0, 1);
    return {
      x,
      y,
      width: Math.max(0.012, right - x),
      height: Math.max(0.012, bottom - y),
    };
  }

  private drawBrushCursor(
    context: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    if (
      !this.brushCursorPoint ||
      this.selectedOverlay ||
      (this.activeTool !== 'blur' && this.activeTool !== 'pixelate') ||
      this.privacyShape !== 'brush'
    ) {
      return;
    }

    const radius = Math.max(
      3,
      (Math.min(width, height) * this.privacyBrushSize) / 200
    );
    context.save();
    context.beginPath();
    context.arc(
      this.brushCursorPoint.x * width,
      this.brushCursorPoint.y * height,
      radius,
      0,
      Math.PI * 2
    );
    context.fillStyle =
      this.privacyBrushMode === 'erase'
        ? 'rgb(255 112 112 / 10%)'
        : 'rgb(255 255 255 / 8%)';
    context.fill();
    context.strokeStyle =
      this.privacyBrushMode === 'erase'
        ? 'rgb(255 112 112 / 96%)'
        : 'rgb(255 255 255 / 92%)';
    context.lineWidth = Math.max(1.5, Math.min(width, height) * 0.0025);
    context.setLineDash([5, 4]);
    context.stroke();

    if (this.privacyBrushMode === 'erase') {
      const markerRadius = Math.max(3, radius * 0.25);
      context.setLineDash([]);
      context.beginPath();
      context.moveTo(
        this.brushCursorPoint.x * width - markerRadius,
        this.brushCursorPoint.y * height - markerRadius
      );
      context.lineTo(
        this.brushCursorPoint.x * width + markerRadius,
        this.brushCursorPoint.y * height + markerRadius
      );
      context.moveTo(
        this.brushCursorPoint.x * width + markerRadius,
        this.brushCursorPoint.y * height - markerRadius
      );
      context.lineTo(
        this.brushCursorPoint.x * width - markerRadius,
        this.brushCursorPoint.y * height + markerRadius
      );
      context.stroke();
    }

    context.restore();
  }

  onBrushPointerLeave(): void {
    if (this.draggingPointerId !== null) return;
    this.brushCursorPoint = null;
    this.scheduleRender();
  }

  private commitOverlays(next: readonly PhotoEditorOverlay[]): void {
    this.overlays = clonePhotoEditorOverlays(normalizePhotoEditorOverlays(next));
    this.ensureSelectedOverlayExists();
    this.commitEditorState();
  }

  private resetOverlayHistory(overlays: readonly PhotoEditorOverlay[]): void {
    this.overlays = clonePhotoEditorOverlays(normalizePhotoEditorOverlays(overlays));
    this.ensureSelectedOverlayExists();
    this.resetEditorHistory();
  }

  private buildHistorySnapshot(): PhotoEditorHistorySnapshot {
    return {
      state: JSON.stringify(this.buildEditorState()),
      selectedOverlayId: this.selectedOverlayId,
    };
  }

  private resetEditorHistory(): void {
    try {
      this.photoEditorHistory.reset(this.buildHistorySnapshot());
    } catch (error) {
      this.reportError('Não foi possível iniciar o histórico da edição.', error, {
        op: 'history.reset',
      });
    }
    this.scheduleRender();
  }

  private commitEditorState(): void {
    try {
      this.photoEditorHistory.commit(this.buildHistorySnapshot());
    } catch (error) {
      this.reportError('Não foi possível registrar a alteração da foto.', error, {
        op: 'history.commit',
      });
    }
    this.scheduleRender();
  }

  private restoreHistorySnapshot(snapshot: PhotoEditorHistorySnapshot): void {
    try {
      const parsed = JSON.parse(snapshot.state) as Partial<PhotoEditorNativeStateV2>;
      if (parsed.editor !== 'native-canvas' || parsed.version !== 2) {
        throw new Error('Snapshot incompatível com o editor canônico atual.');
      }

      this.rotation = this.normalizeRotation(Number(parsed.rotation ?? 0));
      this.straighten = this.clamp(Number(parsed.straighten ?? 0), -15, 15);
      this.flipHorizontal = parsed.flipHorizontal === true;
      this.brightness = this.clamp(Number(parsed.brightness ?? 100), 50, 150);
      this.contrast = this.clamp(Number(parsed.contrast ?? 100), 50, 150);
      this.saturation = this.clamp(Number(parsed.saturation ?? 100), 0, 200);
      this.zoom = this.clamp(Number(parsed.zoom ?? 1), MIN_ZOOM, MAX_ZOOM);
      this.panX = this.clamp(Number(parsed.panX ?? 0), -1, 1);
      this.panY = this.clamp(Number(parsed.panY ?? 0), -1, 1);
      this.aspectRatio = this.isAspectRatioLocked
        ? this.resolvePresetAspectRatio()
        : this.normalizeAspectRatio(parsed.aspectRatio);
      this.cropRect = this.isAspectRatioLocked
        ? { ...PHOTO_EDITOR_FULL_CROP_RECT }
        : normalizePhotoEditorCropRect(parsed.cropRect);
      this.overlays = clonePhotoEditorOverlays(
        normalizePhotoEditorOverlays(parsed.overlays)
      );
      this.selectedOverlayId = snapshot.selectedOverlayId;
      this.ensureSelectedOverlayExists();
      this.scheduleRender();
    } catch (error) {
      this.reportError('Não foi possível restaurar a alteração da foto.', error, {
        op: 'history.restore',
      });
    }
  }

  private ensureSelectedOverlayExists(): void {
    if (
      this.selectedOverlayId &&
      !this.overlays.some((overlay) => overlay.id === this.selectedOverlayId)
    ) {
      this.selectedOverlayId = null;
    }
  }

  private resolveNormalizedPointer(
    event: PointerEvent
  ): PhotoEditorNormalizedPoint | null {
    const canvas = this.editorCanvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: this.clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: this.clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  private capturePointer(pointerId: number): void {
    const canvas = this.editorCanvasRef.nativeElement;
    if (!canvas.hasPointerCapture(pointerId)) {
      canvas.setPointerCapture(pointerId);
    }
  }

  private cancelPointerInteraction(
    releaseCapture: boolean,
    pointerId = this.draggingPointerId
  ): void {
    const canvas = this.editorCanvasRef.nativeElement;
    if (
      releaseCapture &&
      pointerId !== null &&
      canvas.hasPointerCapture(pointerId)
    ) {
      canvas.releasePointerCapture(pointerId);
    }
    this.draggingPointerId = null;
    this.pointerInteraction = null;
    this.overlayDragSnapshot = null;
    this.overlayDragChanged = false;
    this.activeResizeHandle = null;
    this.draftPrivacyRegion = null;
    this.brushStrokeSnapshot = null;
    this.brushStrokeOverlayId = null;
    this.brushEraseChanged = false;
    this.cropStartPoint = null;
    this.cropInteractionSnapshot = null;
    this.activeCropResizeHandle = null;
    this.cropInteractionChanged = false;
    this.draftCropRect = null;
    this.scheduleRender();
  }

  private closeWithProcessedResult(result: PhotoEditorProcessedResult): void {
    this.isClosingSubject.next(true);
    this.activeModal.close({ reason: 'processSuccess', result });
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
    this.errorHandler.report(error, {
      operation: String(context?.['op'] ?? 'unknown'),
      fallbackMessage: userMessage,
      metadata: {
        scope: 'PhotoEditorComponent',
        ...(context ?? {}),
      },
    });
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
    if (!origin) return;
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
    if (!value) return '';
    try {
      const parsed = new URL(value);
      return decodeURIComponent(parsed.pathname).split('/').pop() ?? '';
    } catch {
      return value.split('/').pop()?.split('?')[0] ?? '';
    }
  }

  private guessMimeType(fileName: string): string {
    const normalized = fileName.toLowerCase();
    if (normalized.endsWith('.png')) return 'image/png';
    if (normalized.endsWith('.webp')) return 'image/webp';
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

  private normalizeCaptionStyle(value: unknown): PhotoEditorCaptionStyle {
    return value === 'badge' || value === 'neon' ? value : 'classic';
  }

  private normalizeFontFamily(value: unknown): PhotoEditorFontFamily {
    return value === 'serif' ||
      value === 'condensed' ||
      value === 'rounded' ||
      value === 'handwritten' ||
      value === 'mono'
      ? value
      : 'system';
  }

  private updateToneAdjustment(
    key: 'brightness' | 'contrast' | 'saturation',
    value: number | string,
    minimum: number,
    maximum: number,
    fallback: number
  ): void {
    if (this.isBusy()) return;
    const numericValue = Number(value);
    const next = this.clamp(
      Number.isFinite(numericValue) ? numericValue : fallback,
      minimum,
      maximum
    );
    if (this[key] === next) return;
    this[key] = next;
    this.scheduleRender();
  }

  private createRawCropRect(
    start: PhotoEditorNormalizedPoint,
    end: PhotoEditorNormalizedPoint
  ): PhotoEditorCropRect {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }

  private isPointInsideCrop(
    point: PhotoEditorNormalizedPoint,
    crop: PhotoEditorCropRect
  ): boolean {
    return (
      point.x >= crop.x &&
      point.x <= crop.x + crop.width &&
      point.y >= crop.y &&
      point.y <= crop.y + crop.height
    );
  }

  private hitTestCropResizeHandle(
    point: PhotoEditorNormalizedPoint
  ): PhotoEditorCropResizeHandle | null {
    if (!this.hasCustomCrop || !this.previewWidth || !this.previewHeight) {
      return null;
    }

    const width = this.previewWidth;
    const height = this.previewHeight;
    const crop = this.cropRect;
    const hitRadius = Math.max(12, Math.min(width, height) * 0.022);
    const pixelX = point.x * width;
    const pixelY = point.y * height;
    const left = crop.x * width;
    const top = crop.y * height;
    const right = (crop.x + crop.width) * width;
    const bottom = (crop.y + crop.height) * height;

    const handles: ReadonlyArray<
      readonly [PhotoEditorCropResizeHandle, number, number]
    > = [
      ['nw', left, top],
      ['ne', right, top],
      ['sw', left, bottom],
      ['se', right, bottom],
    ];

    for (const [handle, x, y] of handles) {
      if (Math.hypot(pixelX - x, pixelY - y) <= hitRadius) {
        return handle;
      }
    }
    return null;
  }

  private moveCropRect(
    crop: PhotoEditorCropRect,
    deltaX: number,
    deltaY: number
  ): PhotoEditorCropRect {
    return {
      ...crop,
      x: this.clamp(crop.x + deltaX, 0, 1 - crop.width),
      y: this.clamp(crop.y + deltaY, 0, 1 - crop.height),
    };
  }

  private resizeCropRect(
    crop: PhotoEditorCropRect,
    point: PhotoEditorNormalizedPoint,
    handle: PhotoEditorCropResizeHandle
  ): PhotoEditorCropRect {
    const left = crop.x;
    const top = crop.y;
    const right = crop.x + crop.width;
    const bottom = crop.y + crop.height;
    let x = left;
    let y = top;
    let width = crop.width;
    let height = crop.height;

    if (handle === 'nw' || handle === 'sw') {
      x = this.clamp(point.x, 0, right - PHOTO_EDITOR_MIN_CROP_SIZE);
      width = right - x;
    } else {
      const nextRight = this.clamp(
        point.x,
        left + PHOTO_EDITOR_MIN_CROP_SIZE,
        1
      );
      width = nextRight - left;
    }

    if (handle === 'nw' || handle === 'ne') {
      y = this.clamp(point.y, 0, bottom - PHOTO_EDITOR_MIN_CROP_SIZE);
      height = bottom - y;
    } else {
      const nextBottom = this.clamp(
        point.y,
        top + PHOTO_EDITOR_MIN_CROP_SIZE,
        1
      );
      height = nextBottom - top;
    }

    return normalizePhotoEditorCropRect({ x, y, width, height });
  }

  private resizeCropFromCenter(
    crop: PhotoEditorCropRect,
    delta: number
  ): PhotoEditorCropRect {
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    const width = this.clamp(
      crop.width + delta * 2,
      PHOTO_EDITOR_MIN_CROP_SIZE,
      1
    );
    const height = this.clamp(
      crop.height + delta * 2,
      PHOTO_EDITOR_MIN_CROP_SIZE,
      1
    );
    const x = this.clamp(centerX - width / 2, 0, 1 - width);
    const y = this.clamp(centerY - height / 2, 0, 1 - height);
    return normalizePhotoEditorCropRect({ x, y, width, height });
  }

  private drawCropGuide(
    context: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    const crop = normalizePhotoEditorCropRect(this.draftCropRect ?? this.cropRect);
    const x = crop.x * width;
    const y = crop.y * height;
    const cropWidth = crop.width * width;
    const cropHeight = crop.height * height;

    context.save();
    context.fillStyle = 'rgb(0 0 0 / 52%)';
    context.beginPath();
    context.rect(0, 0, width, height);
    context.rect(x, y, cropWidth, cropHeight);
    context.fill('evenodd');

    context.strokeStyle = '#ffffff';
    context.lineWidth = Math.max(1.5, Math.min(width, height) * 0.003);
    context.setLineDash([8, 5]);
    context.strokeRect(x, y, cropWidth, cropHeight);
    context.setLineDash([]);

    context.strokeStyle = 'rgb(255 255 255 / 42%)';
    context.lineWidth = Math.max(1, Math.min(width, height) * 0.0015);
    for (const fraction of [1 / 3, 2 / 3]) {
      context.beginPath();
      context.moveTo(x + cropWidth * fraction, y);
      context.lineTo(x + cropWidth * fraction, y + cropHeight);
      context.stroke();

      context.beginPath();
      context.moveTo(x, y + cropHeight * fraction);
      context.lineTo(x + cropWidth, y + cropHeight * fraction);
      context.stroke();
    }

    const handleSize = Math.max(8, Math.min(width, height) * 0.018);
    context.fillStyle = '#ff7070';
    for (const [handleX, handleY] of [
      [x, y],
      [x + cropWidth, y],
      [x, y + cropHeight],
      [x + cropWidth, y + cropHeight],
    ] as const) {
      context.fillRect(
        handleX - handleSize / 2,
        handleY - handleSize / 2,
        handleSize,
        handleSize
      );
    }
    context.restore();
  }

  private normalizeDateTimeFormat(value: unknown): PhotoEditorDateTimeFormat {
    return value === 'numeric' || value === 'long' || value === 'today'
      ? value
      : 'instagram';
  }

  private isBusy(): boolean {
    return (
      this.isLoadingSubject.value ||
      this.isSavingSubject.value ||
      this.isClosingSubject.value
    );
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, value));
  }
}
