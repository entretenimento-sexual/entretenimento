// src/app/photo-editor/photo-editor/photo-editor-overlay.model.ts
// Camada serializável e renderizável de anotações do editor nativo.
// As coordenadas são normalizadas para manter o mesmo resultado na prévia e exportação.

export type PhotoEditorTool =
  | 'move'
  | 'blur'
  | 'pixelate'
  | 'emoji'
  | 'text'
  | 'datetime';

export type PhotoEditorCaptionStyle = 'classic' | 'badge' | 'neon';

export interface PhotoEditorNormalizedPoint {
  x: number;
  y: number;
}

export interface PhotoEditorPrivacyOverlay {
  id: string;
  kind: 'blur' | 'pixelate';
  x: number;
  y: number;
  width: number;
  height: number;
  strength: number;
}

export interface PhotoEditorDecorationOverlay {
  id: string;
  kind: 'emoji' | 'text' | 'datetime';
  x: number;
  y: number;
  size: number;
  value: string;
  style: PhotoEditorCaptionStyle;
}

export type PhotoEditorOverlay =
  | PhotoEditorPrivacyOverlay
  | PhotoEditorDecorationOverlay;

export interface PhotoEditorDraftPrivacyRegion {
  kind: 'blur' | 'pixelate';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  strength: number;
}

export interface PhotoEditorOverlayRenderOptions {
  context: CanvasRenderingContext2D;
  baseCanvas: HTMLCanvasElement;
  width: number;
  height: number;
  overlays: readonly PhotoEditorOverlay[];
  draftRegion?: PhotoEditorDraftPrivacyRegion | null;
  createCanvas: () => HTMLCanvasElement;
  preview?: boolean;
}

const MAX_OVERLAYS = 60;
const MIN_PRIVACY_SIZE = 0.012;

export function clonePhotoEditorOverlays(
  overlays: readonly PhotoEditorOverlay[]
): PhotoEditorOverlay[] {
  return overlays.map((overlay) => ({ ...overlay }));
}

export function normalizePhotoEditorOverlays(value: unknown): PhotoEditorOverlay[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: PhotoEditorOverlay[] = [];

  for (const candidate of value.slice(0, MAX_OVERLAYS)) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const source = candidate as Partial<PhotoEditorOverlay> & Record<string, unknown>;
    const kind = source.kind;
    const id = normalizeId(source.id);

    if (kind === 'blur' || kind === 'pixelate') {
      const x = clampNumber(source.x, 0, 1);
      const y = clampNumber(source.y, 0, 1);
      const width = clampNumber(source.width, MIN_PRIVACY_SIZE, 1 - x);
      const height = clampNumber(source.height, MIN_PRIVACY_SIZE, 1 - y);

      if (width < MIN_PRIVACY_SIZE || height < MIN_PRIVACY_SIZE) {
        continue;
      }

      normalized.push({
        id,
        kind,
        x,
        y,
        width,
        height,
        strength: clampNumber(source.strength, 0.008, 0.08),
      });
      continue;
    }

    if (kind === 'emoji' || kind === 'text' || kind === 'datetime') {
      const valueText = String(source.value ?? '').trim().slice(0, 80);
      if (!valueText) {
        continue;
      }

      normalized.push({
        id,
        kind,
        x: clampNumber(source.x, 0, 1),
        y: clampNumber(source.y, 0, 1),
        size: clampNumber(source.size, 0.035, 0.28),
        value: valueText,
        style: normalizeCaptionStyle(source.style),
      });
    }
  }

  return normalized;
}

export function privacyRegionFromDraft(
  draft: PhotoEditorDraftPrivacyRegion
): PhotoEditorPrivacyOverlay | null {
  const x = Math.min(draft.startX, draft.endX);
  const y = Math.min(draft.startY, draft.endY);
  const width = Math.abs(draft.endX - draft.startX);
  const height = Math.abs(draft.endY - draft.startY);

  if (width < MIN_PRIVACY_SIZE || height < MIN_PRIVACY_SIZE) {
    return null;
  }

  return {
    id: createPhotoEditorOverlayId(),
    kind: draft.kind,
    x: clampNumber(x, 0, 1),
    y: clampNumber(y, 0, 1),
    width: clampNumber(width, MIN_PRIVACY_SIZE, 1 - x),
    height: clampNumber(height, MIN_PRIVACY_SIZE, 1 - y),
    strength: clampNumber(draft.strength, 0.008, 0.08),
  };
}

export function createPhotoEditorOverlayId(): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `overlay-${Date.now()}-${randomPart}`;
}

export function drawPhotoEditorOverlays(
  options: PhotoEditorOverlayRenderOptions
): void {
  const {
    context,
    baseCanvas,
    width,
    height,
    overlays,
    draftRegion,
    createCanvas,
    preview = false,
  } = options;

  for (const overlay of overlays) {
    if (overlay.kind === 'blur') {
      drawBlurOverlay(context, baseCanvas, overlay, width, height);
    } else if (overlay.kind === 'pixelate') {
      drawPixelateOverlay(
        context,
        baseCanvas,
        overlay,
        width,
        height,
        createCanvas
      );
    }
  }

  if (draftRegion) {
    const draftOverlay = privacyRegionFromDraft(draftRegion);
    if (draftOverlay) {
      if (draftOverlay.kind === 'blur') {
        drawBlurOverlay(context, baseCanvas, draftOverlay, width, height);
      } else {
        drawPixelateOverlay(
          context,
          baseCanvas,
          draftOverlay,
          width,
          height,
          createCanvas
        );
      }

      if (preview) {
        drawDraftOutline(context, draftOverlay, width, height);
      }
    }
  }

  for (const overlay of overlays) {
    if (overlay.kind === 'emoji') {
      drawEmojiOverlay(context, overlay, width, height);
    } else if (overlay.kind === 'text' || overlay.kind === 'datetime') {
      drawCaptionOverlay(context, overlay, width, height);
    }
  }
}

function drawBlurOverlay(
  context: CanvasRenderingContext2D,
  baseCanvas: HTMLCanvasElement,
  overlay: PhotoEditorPrivacyOverlay,
  width: number,
  height: number
): void {
  const rect = toPixelRect(overlay, width, height);
  const blurRadius = Math.max(6, Math.round(Math.min(width, height) * overlay.strength));

  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  context.filter = `blur(${blurRadius}px)`;
  context.drawImage(baseCanvas, 0, 0, width, height);
  context.filter = 'none';
  context.restore();
}

function drawPixelateOverlay(
  context: CanvasRenderingContext2D,
  baseCanvas: HTMLCanvasElement,
  overlay: PhotoEditorPrivacyOverlay,
  width: number,
  height: number,
  createCanvas: () => HTMLCanvasElement
): void {
  const rect = toPixelRect(overlay, width, height);
  const blockSize = Math.max(6, Math.round(Math.min(width, height) * overlay.strength));
  const sampleWidth = Math.max(1, Math.ceil(rect.width / blockSize));
  const sampleHeight = Math.max(1, Math.ceil(rect.height / blockSize));
  const sampleCanvas = createCanvas();
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  const sampleContext = sampleCanvas.getContext('2d');

  if (!sampleContext) {
    return;
  }

  sampleContext.imageSmoothingEnabled = true;
  sampleContext.drawImage(
    baseCanvas,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    sampleWidth,
    sampleHeight
  );

  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(
    sampleCanvas,
    0,
    0,
    sampleWidth,
    sampleHeight,
    rect.x,
    rect.y,
    rect.width,
    rect.height
  );
  context.restore();
}

function drawDraftOutline(
  context: CanvasRenderingContext2D,
  overlay: PhotoEditorPrivacyOverlay,
  width: number,
  height: number
): void {
  const rect = toPixelRect(overlay, width, height);

  context.save();
  context.strokeStyle = '#ff7070';
  context.lineWidth = Math.max(2, Math.min(width, height) * 0.004);
  context.setLineDash([8, 6]);
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.restore();
}

function drawEmojiOverlay(
  context: CanvasRenderingContext2D,
  overlay: PhotoEditorDecorationOverlay,
  width: number,
  height: number
): void {
  const size = Math.max(22, Math.min(width, height) * overlay.size);

  context.save();
  context.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(overlay.value, overlay.x * width, overlay.y * height);
  context.restore();
}

function drawCaptionOverlay(
  context: CanvasRenderingContext2D,
  overlay: PhotoEditorDecorationOverlay,
  width: number,
  height: number
): void {
  const fontSize = Math.max(18, Math.min(width, height) * overlay.size);
  const x = overlay.x * width;
  const y = overlay.y * height;
  const maxWidth = width * 0.86;
  const fontWeight = overlay.kind === 'datetime' ? 900 : 800;

  context.save();
  context.font = `${fontWeight} ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  if (overlay.style === 'badge') {
    const metrics = context.measureText(overlay.value);
    const horizontalPadding = fontSize * 0.55;
    const verticalPadding = fontSize * 0.32;
    const boxWidth = Math.min(maxWidth, metrics.width + horizontalPadding * 2);
    const boxHeight = fontSize + verticalPadding * 2;

    context.fillStyle = 'rgb(0 0 0 / 72%)';
    drawRoundedRect(
      context,
      x - boxWidth / 2,
      y - boxHeight / 2,
      boxWidth,
      boxHeight,
      fontSize * 0.32
    );
    context.fill();
    context.fillStyle = '#ffffff';
    context.fillText(overlay.value, x, y, maxWidth - horizontalPadding * 2);
  } else if (overlay.style === 'neon') {
    context.shadowColor = '#ff4f87';
    context.shadowBlur = Math.max(8, fontSize * 0.28);
    context.lineWidth = Math.max(2, fontSize * 0.08);
    context.strokeStyle = 'rgb(0 0 0 / 82%)';
    context.strokeText(overlay.value, x, y, maxWidth);
    context.fillStyle = '#ff7aa5';
    context.fillText(overlay.value, x, y, maxWidth);
  } else {
    context.lineJoin = 'round';
    context.lineWidth = Math.max(3, fontSize * 0.12);
    context.strokeStyle = 'rgb(0 0 0 / 82%)';
    context.strokeText(overlay.value, x, y, maxWidth);
    context.fillStyle = '#ffffff';
    context.fillText(overlay.value, x, y, maxWidth);
  }

  context.restore();
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - safeRadius,
    y + height
  );
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function toPixelRect(
  overlay: PhotoEditorPrivacyOverlay,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(overlay.x * width),
    y: Math.round(overlay.y * height),
    width: Math.max(1, Math.round(overlay.width * width)),
    height: Math.max(1, Math.round(overlay.height * height)),
  };
}

function normalizeCaptionStyle(value: unknown): PhotoEditorCaptionStyle {
  return value === 'badge' || value === 'neon' ? value : 'classic';
}

function normalizeId(value: unknown): string {
  const normalized = String(value ?? '').trim().slice(0, 120);
  return normalized || createPhotoEditorOverlayId();
}

function clampNumber(value: unknown, minimum: number, maximum: number): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, numericValue));
}
