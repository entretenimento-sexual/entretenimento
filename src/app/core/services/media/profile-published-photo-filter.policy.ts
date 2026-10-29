/**
 * A galeria de gestão apresenta publicações sociais, não uma biblioteca privada.
 * Documentos técnicos de upload podem existir enquanto a publicação é preparada,
 * mas não devem virar itens de galeria sem uma publicação ativa.
 */
export interface ProfilePhotoPublicationStatus {
  readonly ownerUid: string;
  readonly isPublished: boolean;
}

export function filterPublishedProfilePhotos<TPhoto extends { readonly id: string }>(
  photos: readonly TPhoto[],
  publications: Readonly<Record<string, ProfilePhotoPublicationStatus>>,
  ownerUid: string
): TPhoto[] {
  const owner = String(ownerUid ?? '').trim();

  if (!owner) {
    return [];
  }

  return photos.filter((photo) => {
    const photoId = String(photo.id ?? '').trim();
    const publication = publications[photoId];

    return !!photoId &&
      publication?.ownerUid === owner &&
      publication.isPublished === true;
  });
}

/**
 * As páginas já foram autorizadas pelo backend PUBLIC/FRIENDS.
 * O proprietário deve ser novamente conferido na composição visual,
 * sem depender da presença de documentos de uploads privados.
 */
export function filterOwnerPublishedPhotoPage<
  TPhoto extends { readonly id: string; readonly ownerUid: string }
>(photos: readonly TPhoto[], ownerUid: string): TPhoto[] {
  const owner = String(ownerUid ?? '').trim();
  if (!owner) return [];
  return photos.filter((photo) =>
    photo.ownerUid === owner && !!String(photo.id ?? '').trim()
  );
}
