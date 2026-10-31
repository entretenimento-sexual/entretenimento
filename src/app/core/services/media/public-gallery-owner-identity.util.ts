import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import {
  normalizePublicUserIdentity,
  type PublicUserIdentity,
} from 'src/app/core/domain/public-user-identity/public-user-identity.model';

/**
 * Compõe a identidade visível da mesma página de mídia recém-autorizada.
 * Não fornece autorização: fotos/vídeos continuam dependendo das Callables
 * de leitura e do acesso temporário ao ativo. Não persiste nem reutiliza
 * identidades de outras rotas/sessões.
 */
export function publicGalleryOwnerIdentityFromMedia(
  ownerUid: string,
  items: readonly (IPublicPhotoItem | IPublicVideoItem)[]
): PublicUserIdentity | null {
  const owner = ownerUid.trim();
  if (!owner) return null;

  for (const item of items) {
    if (
      item.ownerUid !== owner ||
      item.visibility !== 'PUBLIC' ||
      item.moderationStatus !== 'APPROVED'
    ) {
      continue;
    }

    const summary = 'owner' in item ? item.owner : null;
    const nickname = 'ownerNickname' in item
      ? item.ownerNickname
      : summary?.nickname;

    if (typeof nickname !== 'string' || !nickname.trim()) continue;

    return normalizePublicUserIdentity({
      nickname,
      avatarUrl: 'ownerPhotoURL' in item
        ? item.ownerPhotoURL
        : summary?.photoURL,
      identityCode: 'ownerGender' in item
        ? item.ownerGender
        : summary?.gender,
      orientation: 'ownerOrientation' in item
        ? item.ownerOrientation
        : summary?.orientation,
      city: 'ownerMunicipio' in item
        ? item.ownerMunicipio
        : summary?.municipio,
      state: 'ownerEstado' in item
        ? item.ownerEstado
        : summary?.estado,
    });
  }

  return null;
}

/** Evita que uma atualização de paginação reabra uma consulta ao proprietário. */
export function samePublicGalleryOwnerIdentity(
  left: PublicUserIdentity | null,
  right: PublicUserIdentity | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.nickname === right.nickname
    && left.avatarUrl === right.avatarUrl
    && left.identityCode === right.identityCode
    && left.orientation === right.orientation
    && left.city === right.city
    && left.state === right.state;
}
