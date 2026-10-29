import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPhotoPublicationConfig } from 'src/app/core/interfaces/media/i-photo-publication-config';
import { filterOwnerPublishedPhotoPage } from './profile-published-photo-filter.policy';

/**
 * Cards da galeria própria derivados exclusivamente da página autorizada e
 * da configuração canônica de publicação. Nunca lê uploads ou arquivos privados.
 */
export type IOwnerPublishedPhotoCard = IPublicPhotoItem & {
  readonly publication: IPhotoPublicationConfig;
  /** Data organizacional privada do proprietário. Ausência usa createdAt. */
  readonly displayDate?: number | null;
};

export function mapOwnerPublishedPhotoCards(
  ownerUid: string,
  authorizedItems: readonly IPublicPhotoItem[],
  publicationConfigs: Readonly<Record<string, IPhotoPublicationConfig>>,
  buildDefaultConfig: (ownerUid: string, photoId: string) => IPhotoPublicationConfig
): IOwnerPublishedPhotoCard[] {
  const owner = String(ownerUid ?? '').trim();
  if (!owner) return [];

  const seen = new Set<string>();
  const cards: IOwnerPublishedPhotoCard[] = [];
  for (const photo of filterOwnerPublishedPhotoPage(authorizedItems, owner)) {
    const photoId = String(photo.id ?? '').trim();
    if (!photoId || photo.ownerUid !== owner || seen.has(photoId)) continue;
    seen.add(photoId);

    const stored = publicationConfigs[photoId];
    // Uma despublicação canônica explícita prevalece sobre a página antiga.
    if (stored?.ownerUid === owner && stored.photoId === photoId &&
        stored.isPublished === false) continue;
    const publication = stored?.ownerUid === owner &&
      stored.photoId === photoId && stored.isPublished === true
      ? stored
      : {
          ...buildDefaultConfig(owner, photoId),
          isPublished: true,
          visibility: photo.visibility,
          moderationStatus: photo.moderationStatus ?? 'APPROVED',
          isCover: photo.isCover === true,
          orderIndex: photo.orderIndex,
          publishedAt: photo.publishedAt,
        };

    cards.push({
      ...photo,
      publication,
      // null é uma limpeza explícita: não ressuscita valores legados.
      displayDate: publication.displayDate,
    });
  }
  return cards;
}
