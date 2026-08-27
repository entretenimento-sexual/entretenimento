// functions/src/media/application/published-media-reference.model.ts
// -----------------------------------------------------------------------------
// PUBLISHED MEDIA REFERENCE
// -----------------------------------------------------------------------------
// Contrato canônico interno para superfícies sociais referenciarem assets já
// preparados pela camada de mídia. A referência nunca concede acesso por si só:
// a superfície ainda autoriza o viewer e emite URL/playback temporário no backend.
//
// `SURFACE_OWNED` significa que o asset físico foi criado exclusivamente para a
// publicação que guarda esta referência e pode acompanhar seu lifecycle. Mídia
// pública reutilizável entre superfícies deve usar referência lógica (owner/id),
// sem transferir ao consumidor a responsabilidade de apagar o arquivo físico.
// -----------------------------------------------------------------------------

import { normalizeOwnedPublishedPhotoPath } from './photo-storage-path';
import {
  normalizeOwnedPublishedVideoPath,
  normalizeOwnedPublishedVideoPosterPath,
} from './video-storage-path';

export type PublishedMediaType = 'PHOTO' | 'VIDEO';
export type PublishedMediaAssetAccess = 'SIGNED_URL';
export type PublishedMediaAssetLifecycle = 'SURFACE_OWNED';

interface PublishedMediaReferenceBase {
  readonly mediaId: string;
  readonly ownerUid: string;
  readonly assetAccess: PublishedMediaAssetAccess;
  readonly assetLifecycle: PublishedMediaAssetLifecycle;
  readonly storagePath: string;
  readonly alt: string;
}

export interface PublishedPhotoReference extends PublishedMediaReferenceBase {
  readonly mediaType: 'PHOTO';
}

export interface PublishedVideoReference extends PublishedMediaReferenceBase {
  readonly mediaType: 'VIDEO';
  readonly posterStoragePath: string | null;
  readonly mimeType: 'video/mp4' | 'video/webm';
  readonly durationMs: number;
}

export type PublishedMediaReference =
  | PublishedPhotoReference
  | PublishedVideoReference;

export interface BuildPublishedPhotoReferenceInput {
  ownerUid: unknown;
  mediaId: unknown;
  storagePath: unknown;
  alt?: unknown;
}

export interface BuildPublishedVideoReferenceInput {
  ownerUid: unknown;
  mediaId: unknown;
  storagePath: unknown;
  posterStoragePath?: unknown;
  mimeType: unknown;
  durationMs: unknown;
  alt?: unknown;
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();

  if (
    !normalized
    || normalized.length > 128
    || normalized.includes('/')
    || /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function normalizeAlt(value: unknown, fallback: string): string {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);

  return normalized || fallback;
}

function normalizeDurationMs(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeVideoMimeType(value: unknown): 'video/mp4' | 'video/webm' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'video/mp4' || normalized === 'video/webm'
    ? normalized
    : null;
}

function normalizePublishedVideoPosterPath(
  ownerUid: string | null,
  mediaId: string | null,
  value: unknown
): string | null {
  if (value == null) return null;
  if (!ownerUid || !mediaId) return null;

  return normalizeOwnedPublishedVideoPosterPath(ownerUid, mediaId, value);
}

function hasSurfaceOwnedLifecycle(source: Record<string, unknown>): boolean {
  return source['assetLifecycle'] === 'SURFACE_OWNED';
}

export function buildPublishedPhotoReference(
  input: Readonly<BuildPublishedPhotoReferenceInput>
): PublishedPhotoReference {
  const ownerUid = normalizeId(input.ownerUid);
  const mediaId = normalizeId(input.mediaId);
  const storagePath = ownerUid && mediaId
    ? normalizeOwnedPublishedPhotoPath(ownerUid, mediaId, input.storagePath)
    : null;

  if (!ownerUid || !mediaId || !storagePath) {
    throw new Error('Referência canônica de foto publicada inválida.');
  }

  return {
    mediaType: 'PHOTO',
    mediaId,
    ownerUid,
    assetAccess: 'SIGNED_URL',
    assetLifecycle: 'SURFACE_OWNED',
    storagePath,
    alt: normalizeAlt(input.alt, 'Foto publicada'),
  };
}

export function buildPublishedVideoReference(
  input: Readonly<BuildPublishedVideoReferenceInput>
): PublishedVideoReference {
  const ownerUid = normalizeId(input.ownerUid);
  const mediaId = normalizeId(input.mediaId);
  const storagePath = ownerUid && mediaId
    ? normalizeOwnedPublishedVideoPath(ownerUid, mediaId, input.storagePath)
    : null;
  const posterStoragePath = normalizePublishedVideoPosterPath(
    ownerUid,
    mediaId,
    input.posterStoragePath
  );
  const mimeType = normalizeVideoMimeType(input.mimeType);
  const durationMs = normalizeDurationMs(input.durationMs);

  if (
    !ownerUid
    || !mediaId
    || !storagePath
    || (input.posterStoragePath != null && !posterStoragePath)
    || !mimeType
    || durationMs === null
  ) {
    throw new Error('Referência canônica de vídeo publicado inválida.');
  }

  return {
    mediaType: 'VIDEO',
    mediaId,
    ownerUid,
    assetAccess: 'SIGNED_URL',
    assetLifecycle: 'SURFACE_OWNED',
    storagePath,
    posterStoragePath,
    mimeType,
    durationMs,
    alt: normalizeAlt(input.alt, 'Vídeo publicado'),
  };
}

export function normalizePublishedMediaReference(
  raw: unknown
): PublishedMediaReference | null {
  const source = (raw ?? {}) as Record<string, unknown>;

  if (
    source['assetAccess'] !== 'SIGNED_URL'
    || !hasSurfaceOwnedLifecycle(source)
  ) {
    return null;
  }

  try {
    if (source['mediaType'] === 'PHOTO') {
      return buildPublishedPhotoReference({
        ownerUid: source['ownerUid'],
        mediaId: source['mediaId'],
        storagePath: source['storagePath'],
        alt: source['alt'],
      });
    }

    if (source['mediaType'] === 'VIDEO') {
      return buildPublishedVideoReference({
        ownerUid: source['ownerUid'],
        mediaId: source['mediaId'],
        storagePath: source['storagePath'],
        posterStoragePath: source['posterStoragePath'],
        mimeType: source['mimeType'],
        durationMs: source['durationMs'],
        alt: source['alt'],
      });
    }
  } catch {
    return null;
  }

  return null;
}
