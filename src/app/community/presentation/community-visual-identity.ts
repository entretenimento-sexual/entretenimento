import type { CommunityPreviewCard } from '../data-access/community-preview.model';

type CommunityVisualIdentity = Pick<
  CommunityPreviewCard,
  'communityId' | 'name' | 'source'
>;

export function communityInitials(item: CommunityVisualIdentity): string {
  const words = String(item.name ?? '')
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);

  if (words.length === 0) {
    return item.source.type === 'venue' ? 'L' : 'C';
  }

  const initials = words.length === 1
    ? words[0].slice(0, 2)
    : `${words[0][0]}${words[words.length - 1][0]}`;

  return initials.toLocaleUpperCase('pt-BR').slice(0, 2);
}

export function communityVisualVariant(item: CommunityVisualIdentity): number {
  const identity = String(item.communityId ?? '');
  let hash = 2_166_136_261;

  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0) % 6;
}
