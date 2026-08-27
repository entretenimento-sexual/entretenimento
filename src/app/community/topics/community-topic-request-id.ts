export type CommunityTopicRequestKind = 'topic' | 'reply' | 'moderation';

let fallbackRequestSequence = 0;

export function createCommunityTopicRequestId(
  prefix: CommunityTopicRequestKind
): string {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}:${cryptoApi.randomUUID()}`;
  }

  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    const value = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    return `${prefix}:${value}`;
  }

  fallbackRequestSequence += 1;
  return `${prefix}:${Date.now().toString(36)}:${fallbackRequestSequence.toString(36)}`;
}
