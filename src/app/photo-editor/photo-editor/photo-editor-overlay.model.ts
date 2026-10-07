// src/app/photo-editor/photo-editor/photo-editor-overlay.model.ts
// Camada serializável e renderizável de anotações do editor nativo.
// As coordenadas são normalizadas para manter o mesmo resultado na prévia e exportação.

export type PhotoEditorTool =
  | 'move'
  | 'crop'
  | 'adjust'
  | 'blur'
  | 'pixelate'
  | 'bar'
  | 'emoji'
  | 'text'
  | 'datetime';

export type PhotoEditorCaptionStyle = 'classic' | 'badge' | 'neon';
export type PhotoEditorPrivacyRegionShape = 'rectangle' | 'ellipse';
export type PhotoEditorPrivacyShape = PhotoEditorPrivacyRegionShape | 'brush';

export type PhotoEditorFontFamily =
  | 'system'
  | 'serif'
  | 'condensed'
  | 'rounded'
  | 'handwritten'
  | 'mono';

export type PhotoEditorDateTimeFormat =
  | 'instagram'
  | 'numeric'
  | 'long'
  | 'today';

export interface PhotoEditorDateTimeMeta {
  date: string;
  time: string;
  format: PhotoEditorDateTimeFormat;
  includeYear: boolean;
}

export interface PhotoEditorNormalizedPoint {
  x: number;
  y: number;
}

interface PhotoEditorOverlayBase {
  id: string;
  x: number;
  y: number;
}

interface PhotoEditorEffectPrivacyOverlayBase extends PhotoEditorOverlayBase {
  kind: 'blur' | 'pixelate';
  width: number;
  height: number;
  strength: number;
}

export interface PhotoEditorRegionPrivacyOverlay
  extends PhotoEditorEffectPrivacyOverlayBase {
  shape: PhotoEditorPrivacyRegionShape;
}

export interface PhotoEditorBrushPrivacyOverlay
  extends PhotoEditorEffectPrivacyOverlayBase {
  shape: 'brush';
  radiusX: number;
  radiusY: number;
  points: PhotoEditorNormalizedPoint[];
}

export type PhotoEditorEffectPrivacyOverlay =
  | PhotoEditorRegionPrivacyOverlay
  | PhotoEditorBrushPrivacyOverlay;

export interface PhotoEditorBarPrivacyOverlay extends PhotoEditorOverlayBase {
  kind: 'bar';
  width: number;
  height: number;
  opacity: number;
}

export type PhotoEditorPrivacyOverlay =
  | PhotoEditorEffectPrivacyOverlay
  | PhotoEditorBarPrivacyOverlay;

export interface PhotoEditorDecorationOverlay extends PhotoEditorOverlayBase {
  kind: 'emoji' | 'text' | 'datetime';
  size: number;
  value: string;
  style: PhotoEditorCaptionStyle;
  fontFamily: PhotoEditorFontFamily;
  dateTimeMeta?: PhotoEditorDateTimeMeta;
}

export type PhotoEditorOverlay =
  | PhotoEditorPrivacyOverlay
  | PhotoEditorDecorationOverlay;

export interface PhotoEditorDraftPrivacyRegion {
  kind: PhotoEditorTool;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  strength: number;
  opacity?: number;
  shape?: PhotoEditorPrivacyRegionShape;
}

export interface PhotoEditorOverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhotoEditorOverlayRenderOptions {
  context: CanvasRenderingContext2D;
  baseCanvas: HTMLCanvasElement;
  width: number;
  height: number;
  overlays: readonly PhotoEditorOverlay[];
  draftRegion?: PhotoEditorDraftPrivacyRegion | null;
  selectedOverlayId?: string | null;
  createCanvas: () => HTMLCanvasElement;
  preview?: boolean;
}

const MAX_OVERLAYS = 60;
const MAX_BRUSH_POINTS = 512;
export const PHOTO_EDITOR_PHOTO_EDITOR_MIN_PRIVACY_SIZE = 0.012;
const MIN_BRUSH_RADIUS = 0.004;
const MAX_BRUSH_RADIUS = 0.25;
const SELECTION_PADDING_PX = 10;

export function clonePhotoEditorOverlays(
  overlays: readonly PhotoEditorOverlay[]
): PhotoEditorOverlay[] {
  return overlays.map((overlay) => {
    if (overlay.kind === 'datetime' && overlay.dateTimeMeta) {
      return {
        ...overlay,
        dateTimeMeta: { ...overlay.dateTimeMeta },
      };
    }
    if (
      (overlay.kind === 'blur' || overlay.kind === 'pixelate') &&
      overlay.shape === 'brush'
    ) {
      return {
        ...overlay,
        points: overlay.points.map((point) => ({ ...point })),
      };
    }

    return { ...overlay };
  });
}

export function normalizePhotoEditorOverlays(
  value: unknown
): PhotoEditorOverlay[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: PhotoEditorOverlay[] = [];

  for (const candidate of value.slice(0, MAX_OVERLAYS)) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const source = candidate as Record<string, unknown>;
    const kind = source['kind'];
    const id = normalizeId(source['id']);

    if (kind === 'blur' || kind === 'pixelate') {
      const shape = normalizePrivacyShape(source['shape']);
      if (shape === 'brush') {
        const points = normalizeBrushPoints(source['points']);
        if (points.length === 0) {
          continue;
        }
        const radiusX = clampNumber(
          source['radiusX'],
          MIN_BRUSH_RADIUS,
          MAX_BRUSH_RADIUS
        );
        const radiusY = clampNumber(
          source['radiusY'],
          MIN_BRUSH_RADIUS,
          MAX_BRUSH_RADIUS
        );
        const bounds = resolveBrushBounds(points, radiusX, radiusY);
        normalized.push({
          id,
          kind,
          shape,
          ...bounds,
          radiusX,
          radiusY,
          points,
          strength: clampNumber(source['strength'], 0.008, 0.08),
        });
        continue;
      }

      const x = clampNumber(source['x'], 0, 1);
      const y = clampNumber(source['y'], 0, 1);
      const width = clampNumber(
        source['width'],
        PHOTO_EDITOR_MIN_PRIVACY_SIZE,
        Math.max(PHOTO_EDITOR_MIN_PRIVACY_SIZE, 1 - x)
      );
      const height = clampNumber(
        source['height'],
        PHOTO_EDITOR_MIN_PRIVACY_SIZE,
        Math.max(PHOTO_EDITOR_MIN_PRIVACY_SIZE, 1 - y)
      );
      normalized.push({
        id,
        kind,
        x,
        y,
        width,
        height,
        strength: clampNumber(source['strength'], 0.008, 0.08),
        shape,
      });
      continue;
    }

    if (kind === 'bar') {
      const x = clampNumber(source['x'], 0, 1);
      const y = clampNumber(source['y'], 0, 1);
      normalized.push({
        id,
        kind,
        x,
        y,
        width: clampNumber(
          source['width'],
          PHOTO_EDITOR_MIN_PRIVACY_SIZE,
          Math.max(PHOTO_EDITOR_MIN_PRIVACY_SIZE, 1 - x)
        ),
        height: clampNumber(
          source['height'],
          PHOTO_EDITOR_MIN_PRIVACY_SIZE,
          Math.max(PHOTO_EDITOR_MIN_PRIVACY_SIZE, 1 - y)
        ),
        opacity: clampNumber(source['opacity'], 0.25, 1),
      });
      continue;
    }

    if (kind === 'emoji' || kind === 'text' || kind === 'datetime') {
      const dateTimeMeta =
        kind === 'datetime'
          ? normalizePhotoEditorDateTimeMeta(source['dateTimeMeta'])
          : undefined;
      const valueText =
        kind === 'datetime' && dateTimeMeta
          ? formatPhotoEditorDateTime(dateTimeMeta)
          : String(source['value'] ?? '').trim().slice(0, 80);

      if (!valueText) {
        continue;
      }

      normalized.push({
        id,
        kind,
        x: clampNumber(source['x'], 0, 1),
        y: clampNumber(source['y'], 0, 1),
        size: clampNumber(source['size'], 0.035, 0.28),
        value: valueText,
        style: normalizeCaptionStyle(source['style']),
        fontFamily: normalizeFontFamily(source['fontFamily']),
        ...(dateTimeMeta ? { dateTimeMeta } : {}),
      });
    }
  }

  return normalized;
}

export function privacyRegionFromDraft(
  draft: PhotoEditorDraftPrivacyRegion
): PhotoEditorPrivacyOverlay | null {
  if (!isPrivacyKind(draft.kind)) {
    return null;
  }

  const x = Math.min(draft.startX, draft.endX);
  const y = Math.min(draft.startY, draft.endY);
  const width = Math.abs(draft.endX - draft.startX);
  const height = Math.abs(draft.endY - draft.startY);

  if (width < PHOTO_EDITOR_MIN_PRIVACY_SIZE || height < PHOTO_EDITOR_MIN_PRIVACY_SIZE) {
    return null;
  }

  const base = {
    id: createPhotoEditorOverlayId(),
    x: clampNumber(x, 0, 1),
    y: clampNumber(y, 0, 1),
    width: clampNumber(width, PHOTO_EDITOR_MIN_PRIVACY_SIZE, Math.max(PHOTO_EDITOR_MIN_PRIVACY_SIZE, 1 - x)),
    height: clampNumber(
      height,
      PHOTO_EDITOR_MIN_PRIVACY_SIZE,
      Math.max(PHOTO_EDITOR_MIN_PRIVACY_SIZE, 1 - y)
    ),
  };

  return draft.kind === 'bar'
    ? {
        ...base,
        kind: 'bar',
        opacity: clampNumber(draft.opacity, 0.25, 1),
      }
    : {
        ...base,
        kind: draft.kind,
        strength: clampNumber(draft.strength, 0.008, 0.08),
        shape: normalizePrivacyRegionShape(draft.shape),
      };
}

export function createPhotoEditorOverlayId(): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `overlay-${Date.now()}-${randomPart}`;
}

export function createPhotoEditorDateTimeMeta(
  date = new Date()
): PhotoEditorDateTimeMeta {
  return {
    date: toLocalDateInputValue(date),
    time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
    format: 'instagram',
    includeYear: false,
  };
}

export function formatPhotoEditorDateTime(
  meta: PhotoEditorDateTimeMeta,
  referenceDate = new Date()
): string {
  const normalized = normalizePhotoEditorDateTimeMeta(meta);
  if (!normalized) {
    return '';
  }

  const parsedDate = parseLocalDate(normalized.date);
  const time = normalizeTime(normalized.time);
  const day = pad2(parsedDate.getDate());
  const monthNumber = pad2(parsedDate.getMonth() + 1);
  const year = parsedDate.getFullYear();
  const monthShort = new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
  })
    .format(parsedDate)
    .replace('.', '')
    .toUpperCase();

  if (normalized.format === 'numeric') {
    const datePart = normalized.includeYear
      ? `${day}/${monthNumber}/${year}`
      : `${day}/${monthNumber}`;
    return `${datePart} • ${time}`;
  }

  if (normalized.format === 'long') {
    const datePart = normalized.includeYear
      ? `${day} ${monthShort} ${year}`
      : `${day} ${monthShort}`;
    return `${datePart} • ${time}`;
  }

  if (
    normalized.format === 'today' &&
    isSameLocalDate(parsedDate, referenceDate)
  ) {
    return `HOJE • ${time}`;
  }

  const instagramDate = normalized.includeYear
    ? `${day} ${monthShort} ${year}`
    : `${day} ${monthShort}`;
  return `${instagramDate} • ${time}`;
}

export function getPhotoEditorOverlayBounds(
  overlay: PhotoEditorOverlay,
  width: number,
  height: number,
  context: CanvasRenderingContext2D
): PhotoEditorOverlayBounds {
  if (isPrivacyOverlay(overlay)) {
    return toPixelRect(overlay, width, height);
  }

  return getDecorationOverlayBounds(overlay, width, height, context);
}

export function hitTestPhotoEditorOverlay(
  overlays: readonly PhotoEditorOverlay[],
  point: PhotoEditorNormalizedPoint,
  width: number,
  height: number,
  context: CanvasRenderingContext2D
): PhotoEditorOverlay | null {
  const pixelX = point.x * width;
  const pixelY = point.y * height;

  for (let index = overlays.length - 1; index >= 0; index -= 1) {
    const overlay = overlays[index];
    const bounds = getPhotoEditorOverlayBounds(
      overlay,
      width,
      height,
      context
    );

    const insideBounds =
      pixelX >= bounds.x - SELECTION_PADDING_PX &&
      pixelX <= bounds.x + bounds.width + SELECTION_PADDING_PX &&
      pixelY >= bounds.y - SELECTION_PADDING_PX &&
      pixelY <= bounds.y + bounds.height + SELECTION_PADDING_PX;

    if (!insideBounds) {
      continue;
    }

    if (overlay.kind === 'blur' || overlay.kind === 'pixelate') {
      if (overlay.shape === 'ellipse') {
        const radiusX = Math.max(1, bounds.width / 2 + SELECTION_PADDING_PX);
        const radiusY = Math.max(1, bounds.height / 2 + SELECTION_PADDING_PX);
        const centerX = bounds.x + bounds.width / 2;
        const centerY = bounds.y + bounds.height / 2;
        const normalizedX = (pixelX - centerX) / radiusX;
        const normalizedY = (pixelY - centerY) / radiusY;
        if (normalizedX * normalizedX + normalizedY * normalizedY > 1) {
          continue;
        }
      } else if (overlay.shape === 'brush') {
        const hitBrush = overlay.points.some((brushPoint) => {
          const radiusX = Math.max(
            1,
            overlay.radiusX * width + SELECTION_PADDING_PX
          );
          const radiusY = Math.max(
            1,
            overlay.radiusY * height + SELECTION_PADDING_PX
          );
          const normalizedX = (pixelX - brushPoint.x * width) / radiusX;
          const normalizedY = (pixelY - brushPoint.y * height) / radiusY;
          return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
        });
        if (!hitBrush) {
          continue;
        }
      }
    }

    return overlay;
  }

  return null;
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
    selectedOverlayId,
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
    } else if (overlay.kind === 'bar') {
      drawBarOverlay(context, overlay, width, height);
    }
  }

  if (draftRegion) {
    const draftOverlay = privacyRegionFromDraft(draftRegion);
    if (draftOverlay) {
      if (draftOverlay.kind === 'blur') {
        drawBlurOverlay(context, baseCanvas, draftOverlay, width, height);
      } else if (draftOverlay.kind === 'pixelate') {
        drawPixelateOverlay(
          context,
          baseCanvas,
          draftOverlay,
          width,
          height,
          createCanvas
        );
      } else if (draftOverlay.kind === 'bar') {
        drawBarOverlay(context, draftOverlay, width, height);
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

  if (preview && selectedOverlayId) {
    const selected = overlays.find(
      (overlay) => overlay.id === selectedOverlayId
    );
    if (selected) {
      drawSelection(context, selected, width, height);
    }
  }
}

function getDecorationOverlayBounds(
  overlay: PhotoEditorDecorationOverlay,
  width: number,
  height: number,
  context: CanvasRenderingContext2D
): PhotoEditorOverlayBounds {
  const size = Math.max(18, Math.min(width, height) * overlay.size);
  const x = overlay.x * width;
  const y = overlay.y * height;

  if (overlay.kind === 'emoji') {
    return {
      x: x - size * 0.58,
      y: y - size * 0.58,
      width: size * 1.16,
      height: size * 1.16,
    };
  }

  context.save();
  context.font = resolveCaptionFont(overlay, size);
  const measuredWidth = Math.min(
    width * 0.86,
    context.measureText(overlay.value).width
  );
  context.restore();

  const horizontalPadding =
    overlay.style === 'badge' ? size * 0.55 : size * 0.18;
  const verticalPadding =
    overlay.style === 'badge' ? size * 0.32 : size * 0.16;
  const boxWidth = measuredWidth + horizontalPadding * 2;
  const boxHeight = size + verticalPadding * 2;

  return {
    x: x - boxWidth / 2,
    y: y - boxHeight / 2,
    width: boxWidth,
    height: boxHeight,
  };
}

function drawBlurOverlay(
  context: CanvasRenderingContext2D,
  baseCanvas: HTMLCanvasElement,
  overlay: PhotoEditorEffectPrivacyOverlay,
  width: number,
  height: number
): void {
  const rect = toPixelRect(overlay, width, height);
  const blurRadius = Math.max(
    6,
    Math.round(Math.min(width, height) * overlay.strength)
  );

  context.save();
  applyPrivacyClip(context, overlay, rect, width, height);
  context.clip();
  context.filter = `blur(${blurRadius}px)`;
  context.drawImage(baseCanvas, 0, 0, width, height);
  context.filter = 'none';
  context.restore();
}

function drawPixelateOverlay(
  context: CanvasRenderingContext2D,
  baseCanvas: HTMLCanvasElement,
  overlay: PhotoEditorEffectPrivacyOverlay,
  width: number,
  height: number,
  createCanvas: () => HTMLCanvasElement
): void {
  const rect = toPixelRect(overlay, width, height);
  const blockSize = Math.max(
    6,
    Math.round(Math.min(width, height) * overlay.strength)
  );
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
  applyPrivacyClip(context, overlay, rect, width, height);
  context.clip();
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

function drawBarOverlay(
  context: CanvasRenderingContext2D,
  overlay: PhotoEditorBarPrivacyOverlay,
  width: number,
  height: number
): void {
  const rect = toPixelRect(overlay, width, height);
  context.save();
  context.fillStyle = `rgb(0 0 0 / ${overlay.opacity})`;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
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
  if (overlay.kind === 'blur' || overlay.kind === 'pixelate') {
    if (overlay.shape === 'ellipse') {
      traceEllipse(context, rect);
      context.stroke();
    } else if (overlay.shape === 'brush') {
      traceBrushMask(context, overlay, width, height);
      context.stroke();
    } else {
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  } else {
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }
  context.restore();
}

function applyPrivacyClip(
  context: CanvasRenderingContext2D,
  overlay: PhotoEditorEffectPrivacyOverlay,
  rect: PhotoEditorOverlayBounds,
  width: number,
  height: number
): void {
  context.beginPath();
  if (overlay.shape === 'ellipse') {
    traceEllipse(context, rect);
    return;
  }
  if (overlay.shape === 'brush') {
    traceBrushMask(context, overlay, width, height);
    return;
  }
  context.rect(rect.x, rect.y, rect.width, rect.height);
}

function traceEllipse(
  context: CanvasRenderingContext2D,
  rect: PhotoEditorOverlayBounds
): void {
  context.ellipse(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
    rect.width / 2,
    rect.height / 2,
    0,
    0,
    Math.PI * 2
  );
}

function traceBrushMask(
  context: CanvasRenderingContext2D,
  overlay: PhotoEditorBrushPrivacyOverlay,
  width: number,
  height: number
): void {
  context.beginPath();
  for (const point of overlay.points) {
    context.moveTo(point.x * width + overlay.radiusX * width, point.y * height);
    context.ellipse(
      point.x * width,
      point.y * height,
      Math.max(1, overlay.radiusX * width),
      Math.max(1, overlay.radiusY * height),
      0,
      0,
      Math.PI * 2
    );
  }
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

  context.save();
  context.font = resolveCaptionFont(overlay, fontSize);
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  if (overlay.style === 'badge') {
    const metrics = context.measureText(overlay.value);
    const horizontalPadding = fontSize * 0.55;
    const verticalPadding = fontSize * 0.32;
    const boxWidth = Math.min(
      maxWidth,
      metrics.width + horizontalPadding * 2
    );
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
    context.fillText(
      overlay.value,
      x,
      y,
      maxWidth - horizontalPadding * 2
    );
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

function drawSelection(
  context: CanvasRenderingContext2D,
  overlay: PhotoEditorOverlay,
  width: number,
  height: number
): void {
  const bounds = getPhotoEditorOverlayBounds(overlay, width, height, context);
  const padding = Math.max(5, Math.min(width, height) * 0.008);
  const handleRadius = Math.max(4, Math.min(width, height) * 0.007);

  context.save();
  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(1.5, Math.min(width, height) * 0.003);
  context.setLineDash([7, 5]);
  if (overlay.kind === 'blur' || overlay.kind === 'pixelate') {
    if (overlay.shape === 'ellipse') {
      traceEllipse(context, {
        x: bounds.x - padding,
        y: bounds.y - padding,
        width: bounds.width + padding * 2,
        height: bounds.height + padding * 2,
      });
      context.stroke();
    } else if (overlay.shape === 'brush') {
      traceBrushMask(context, overlay, width, height);
      context.stroke();
    } else {
      context.strokeRect(
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2
      );
    }
  } else {
    context.strokeRect(
      bounds.x - padding,
      bounds.y - padding,
      bounds.width + padding * 2,
      bounds.height + padding * 2
    );
  }
  context.setLineDash([]);

  const showResizeHandles =
    overlay.kind === 'bar' ||
    ((overlay.kind === 'blur' || overlay.kind === 'pixelate') &&
      overlay.shape !== 'brush');

  if (showResizeHandles) {
    context.fillStyle = '#ff7070';
    for (const [x, y] of [
      [bounds.x - padding, bounds.y - padding],
      [bounds.x + bounds.width + padding, bounds.y - padding],
      [bounds.x - padding, bounds.y + bounds.height + padding],
      [bounds.x + bounds.width + padding, bounds.y + bounds.height + padding],
    ] as const) {
      context.beginPath();
      context.arc(x, y, handleRadius, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.restore();
}

function resolveCaptionFont(
  overlay: PhotoEditorDecorationOverlay,
  fontSize: number
): string {
  const weight = overlay.kind === 'datetime' ? 900 : 800;
  return `${weight} ${fontSize}px ${resolvePhotoEditorFontStack(
    overlay.fontFamily
  )}`;
}

export function resolvePhotoEditorFontStack(
  fontFamily: PhotoEditorFontFamily
): string {
  switch (fontFamily) {
    case 'serif':
      return 'Georgia, "Times New Roman", serif';
    case 'condensed':
      return 'Impact, "Arial Narrow", sans-serif';
    case 'rounded':
      return '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif';
    case 'handwritten':
      return '"Segoe Print", "Comic Sans MS", cursive';
    case 'mono':
      return 'ui-monospace, "SFMono-Regular", Consolas, monospace';
    default:
      return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  }
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
): PhotoEditorOverlayBounds {
  return {
    x: Math.round(overlay.x * width),
    y: Math.round(overlay.y * height),
    width: Math.max(1, Math.round(overlay.width * width)),
    height: Math.max(1, Math.round(overlay.height * height)),
  };
}

function normalizePhotoEditorDateTimeMeta(
  value: unknown
): PhotoEditorDateTimeMeta | null {
  const fallback = createPhotoEditorDateTimeMeta();
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const source = value as Partial<PhotoEditorDateTimeMeta>;
  return {
    date: isValidDateInput(source.date) ? source.date : fallback.date,
    time: normalizeTime(source.time),
    format: normalizeDateTimeFormat(source.format),
    includeYear: source.includeYear === true,
  };
}

function normalizeCaptionStyle(value: unknown): PhotoEditorCaptionStyle {
  return value === 'badge' || value === 'neon' ? value : 'classic';
}

function normalizeFontFamily(value: unknown): PhotoEditorFontFamily {
  return value === 'serif' ||
    value === 'condensed' ||
    value === 'rounded' ||
    value === 'handwritten' ||
    value === 'mono'
    ? value
    : 'system';
}

function normalizeDateTimeFormat(value: unknown): PhotoEditorDateTimeFormat {
  return value === 'numeric' || value === 'long' || value === 'today'
    ? value
    : 'instagram';
}

function normalizePrivacyShape(value: unknown): PhotoEditorPrivacyShape {
  if (value === 'brush') return 'brush';
  return normalizePrivacyRegionShape(value);
}

function normalizePrivacyRegionShape(
  value: unknown
): PhotoEditorPrivacyRegionShape {
  return value === 'ellipse' ? 'ellipse' : 'rectangle';
}

function normalizeBrushPoints(value: unknown): PhotoEditorNormalizedPoint[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_BRUSH_POINTS).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const point = candidate as Partial<PhotoEditorNormalizedPoint>;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [
      {
        x: clampNumber(x, 0, 1),
        y: clampNumber(y, 0, 1),
      },
    ];
  });
}

function resolveBrushBounds(
  points: readonly PhotoEditorNormalizedPoint[],
  radiusX: number,
  radiusY: number
): PhotoEditorOverlayBounds {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const x = clampNumber(minX - radiusX, 0, 1);
  const y = clampNumber(minY - radiusY, 0, 1);
  const right = clampNumber(maxX + radiusX, 0, 1);
  const bottom = clampNumber(maxY + radiusY, 0, 1);

  return {
    x,
    y,
    width: Math.max(PHOTO_EDITOR_MIN_PRIVACY_SIZE, right - x),
    height: Math.max(PHOTO_EDITOR_MIN_PRIVACY_SIZE, bottom - y),
  };
}

function normalizeId(value: unknown): string {
  const normalized = String(value ?? '').trim().slice(0, 120);
  return normalized || createPhotoEditorOverlayId();
}

function normalizeTime(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)
    ? normalized
    : '12:00';
}

function isValidDateInput(value: unknown): value is string {
  const normalized = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return false;
  }

  const parsed = parseLocalDate(normalized);
  return (
    !Number.isNaN(parsed.getTime()) &&
    toLocalDateInputValue(parsed) === normalized
  );
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, Math.max(0, month - 1), day, 12, 0, 0, 0);
}

function toLocalDateInputValue(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(
    value.getDate()
  )}`;
}

function isSameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isPrivacyOverlay(
  overlay: PhotoEditorOverlay
): overlay is PhotoEditorPrivacyOverlay {
  return isPrivacyKind(overlay.kind);
}

function isPrivacyKind(
  kind: PhotoEditorTool
): kind is PhotoEditorPrivacyOverlay['kind'] {
  return kind === 'blur' || kind === 'pixelate' || kind === 'bar';
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function clampNumber(value: unknown, minimum: number, maximum: number): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, numericValue));
}
