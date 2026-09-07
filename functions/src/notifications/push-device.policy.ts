import { createHash } from 'node:crypto';

export const MAX_PUSH_DEVICES_PER_USER = 10;
export const MIN_PUSH_TOKEN_LENGTH = 20;
export const MAX_PUSH_TOKEN_LENGTH = 4096;

export type PushDevicePlatform = 'web' | 'ios' | 'android';

export function normalizePushToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const token = value.trim();
  if (
    token.length < MIN_PUSH_TOKEN_LENGTH ||
    token.length > MAX_PUSH_TOKEN_LENGTH
  ) {
    return null;
  }

  return token;
}

export function resolvePushDevicePlatform(
  value: unknown
): PushDevicePlatform | null {
  const platform = String(value ?? '').trim().toLowerCase();

  switch (platform) {
    case 'web':
    case 'ios':
    case 'android':
      return platform;
    default:
      return null;
  }
}

export function buildPushTokenDocumentId(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
