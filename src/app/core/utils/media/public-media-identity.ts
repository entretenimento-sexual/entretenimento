export type TPublicMediaIdentityType = 'PHOTO' | 'VIDEO';

export function buildPublicMediaIdentity(
  mediaType: TPublicMediaIdentityType,
  ownerUid: unknown,
  mediaId: unknown
): string {
  const owner = String(ownerUid ?? '').trim();
  const id = String(mediaId ?? '').trim();

  return owner && id
    ? JSON.stringify([mediaType, owner, id])
    : '';
}
