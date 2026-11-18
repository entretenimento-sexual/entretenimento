import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import sharp from 'sharp';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { getDefaultStorageBucket } from '../../firebaseApp';
import {
  AVATAR_IMAGE_MAX_BYTES,
  IMAGE_EDITOR_MAX_INTERACTIVE_PIXELS,
  IMAGE_EDITOR_PRESETS,
  IMAGE_INPUT_MIME_TYPES,
} from '../media-format.generated';
import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';

const STORAGE_FILE_NAME = /^(media-[0-9]+-[A-Za-z0-9-]+)\.(?:jpe?g|png|webp)$/;
const AVATAR_FORMATS: ReadonlySet<string> = new Set(IMAGE_INPUT_MIME_TYPES);
const DECODED_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);
const AVATAR_FINALIZE_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60 * 1000,
  burstMax: 12,
  sustainedWindowMs: 10 * 60 * 1000,
  sustainedMax: 48,
});

export function resolveAvatarPublicationPath(
  uid: string,
  storagePath: unknown
): string | null {
  if (!uid || uid.length > 128 || !/^[^/\x00-\x1f\x7f]+$/.test(uid)) return null;
  const prefix = `users/${uid}/uploads/avatar/`;
  if (typeof storagePath !== 'string' || !storagePath.startsWith(prefix)) return null;

  const match = STORAGE_FILE_NAME.exec(storagePath.slice(prefix.length));
  return match && match[0].length <= 128
    ? `users/${uid}/published/avatar/avatar-${match[1]}.webp`
    : null;
}

export async function encodeProfileAvatar(source: Buffer): Promise<Buffer> {
  if (!source.length || source.length > AVATAR_IMAGE_MAX_BYTES) {
    throw new HttpsError('invalid-argument', 'A foto de perfil excede o limite de 8 MB.');
  }

  try {
    const pipeline = sharp(source, {
      failOn: 'warning',
      limitInputPixels: IMAGE_EDITOR_MAX_INTERACTIVE_PIXELS,
    });
    const metadata = await pipeline.metadata();
    if (!metadata.format || !DECODED_FORMATS.has(metadata.format)) {
      throw new Error('Formato de imagem incompatível.');
    }

    const preset = IMAGE_EDITOR_PRESETS['avatar-square'];
    const edge = Math.min(preset.maxOutputEdge, 512);
    return await pipeline
      .rotate()
      .resize(edge, edge, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: Math.round(preset.lossyQuality * 100) })
      .toBuffer();
  } catch {
    throw new HttpsError('invalid-argument', 'Envie uma foto válida em JPG, PNG ou WebP.');
  }
}

function storageErrorCode(error: unknown): number {
  return Number((error as { code?: unknown } | null)?.code);
}

export const finalizeProfileAvatar = onCall<{ storagePath?: string }>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request): Promise<{ avatarReference: string }> => {
    assertPublicMediaCallableAppCheck(request.app);
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Entre na sua conta para atualizar a foto.');
    }

    const storagePath = request.data?.storagePath;
    const publishedPath = resolveAvatarPublicationPath(uid, storagePath);
    if (!storagePath || !publishedPath) {
      throw new HttpsError('invalid-argument', 'Selecione novamente a sua foto de perfil.');
    }

    await consumeBackendRateLimitQuota({
      action: 'profile-avatar-finalize',
      subject: uid,
      cost: 1,
      config: AVATAR_FINALIZE_RATE_LIMIT,
      message: 'Muitas atualizações de foto em pouco tempo. Tente novamente depois.',
    });
    const bucket = getDefaultStorageBucket();
    const source = bucket.file(storagePath);
    const published = bucket.file(publishedPath);
    const avatarReference =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(publishedPath)}`;

    const [exists] = await published.exists();
    if (!exists) {
      try {
        const [metadata] = await source.getMetadata();
        const size = Number(metadata.size);
        if (!Number.isFinite(size) || size <= 0 || size > AVATAR_IMAGE_MAX_BYTES ||
            !AVATAR_FORMATS.has(metadata.contentType ?? '')) {
          throw new HttpsError('invalid-argument', 'Envie uma foto em JPG, PNG ou WebP com até 8 MB.');
        }

        const [input] = await source.download();
        await published.save(await encodeProfileAvatar(input), {
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: 'image/webp',
            cacheControl: 'private, no-store',
            contentDisposition: 'inline',
          },
        });
      } catch (error) {
        // A mesma imagem é imutável. Repetições após uma corrida retornam a
        // referência já publicada, inclusive se o envio já tiver sido limpo.
        const code = storageErrorCode(error);
        if (code === 404) {
          const [alreadyPublished] = await published.exists();
          if (!alreadyPublished) {
            throw new HttpsError('not-found', 'O envio expirou. Selecione novamente a sua foto.');
          }
        } else if (code !== 412) {
          throw error;
        }
      }
    }

    await source.delete({ ignoreNotFound: true }).catch((error: unknown) => {
      logger.warn('Falha ao limpar envio temporário de avatar.', {
        code: storageErrorCode(error),
      });
    });
    return { avatarReference };
  }
);
