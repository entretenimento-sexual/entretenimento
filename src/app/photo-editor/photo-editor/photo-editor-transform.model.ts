import type { PhotoEditorNormalizedPoint } from './photo-editor-overlay.model';

export interface PhotoEditorCropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PhotoEditorCropOutputGeometry {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
}

export const PHOTO_EDITOR_MIN_CROP_SIZE = 0.08;

export const PHOTO_EDITOR_FULL_CROP_RECT: PhotoEditorCropRect = Object.freeze({
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});

export function normalizePhotoEditorCropRect(
  value: unknown
): PhotoEditorCropRect {
  if (!value || typeof value !== 'object') {
    return { ...PHOTO_EDITOR_FULL_CROP_RECT };
  }

  const source = value as Partial<PhotoEditorCropRect>;
  const x = clamp(Number(source.x ?? 0), 0, 1 - PHOTO_EDITOR_MIN_CROP_SIZE);
  const y = clamp(Number(source.y ?? 0), 0, 1 - PHOTO_EDITOR_MIN_CROP_SIZE);
  const width = clamp(
    Number(source.width ?? 1),
    PHOTO_EDITOR_MIN_CROP_SIZE,
    Math.max(PHOTO_EDITOR_MIN_CROP_SIZE, 1 - x)
  );
  const height = clamp(
    Number(source.height ?? 1),
    PHOTO_EDITOR_MIN_CROP_SIZE,
    Math.max(PHOTO_EDITOR_MIN_CROP_SIZE, 1 - y)
  );

  return { x, y, width, height };
}

export function createPhotoEditorCropRect(
  start: PhotoEditorNormalizedPoint,
  end: PhotoEditorNormalizedPoint
): PhotoEditorCropRect {
  return normalizePhotoEditorCropRect({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  });
}

export function isFullPhotoEditorCropRect(
  rect: PhotoEditorCropRect,
  epsilon = 0.0005
): boolean {
  const normalized = normalizePhotoEditorCropRect(rect);
  return (
    Math.abs(normalized.x) < epsilon &&
    Math.abs(normalized.y) < epsilon &&
    Math.abs(normalized.width - 1) < epsilon &&
    Math.abs(normalized.height - 1) < epsilon
  );
}

export function resolvePhotoEditorCropOutputGeometry(
  workingWidth: number,
  workingHeight: number,
  cropRect: PhotoEditorCropRect,
  maxOutputEdge: number
): PhotoEditorCropOutputGeometry {
  const safeWorkingWidth = positiveInteger(workingWidth);
  const safeWorkingHeight = positiveInteger(workingHeight);
  const safeMaxOutputEdge = positiveInteger(maxOutputEdge);
  const crop = normalizePhotoEditorCropRect(cropRect);

  const sourceX = clampInteger(
    Math.round(crop.x * safeWorkingWidth),
    0,
    safeWorkingWidth - 1
  );
  const sourceY = clampInteger(
    Math.round(crop.y * safeWorkingHeight),
    0,
    safeWorkingHeight - 1
  );
  const sourceWidth = clampInteger(
    Math.round(crop.width * safeWorkingWidth),
    1,
    safeWorkingWidth - sourceX
  );
  const sourceHeight = clampInteger(
    Math.round(crop.height * safeWorkingHeight),
    1,
    safeWorkingHeight - sourceY
  );
  const cropRatio = sourceWidth / sourceHeight;

  let outputWidth = safeMaxOutputEdge;
  let outputHeight = Math.max(1, Math.round(outputWidth / cropRatio));
  if (outputHeight > safeMaxOutputEdge) {
    outputHeight = safeMaxOutputEdge;
    outputWidth = Math.max(1, Math.round(outputHeight * cropRatio));
  }

  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
  };
}

function positiveInteger(value: number): number {
  return Math.max(1, Math.round(Number.isFinite(value) ? value : 1));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.round(clamp(value, minimum, Math.max(minimum, maximum)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
