import { createHash, randomBytes } from 'node:crypto';

export const VIDEO_RETENTION_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 128;

export function createVideoRetentionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function normalizeVideoRetentionToken(value: unknown): string {
  const token = String(value ?? '').trim();

  if (
    token.length < MIN_TOKEN_LENGTH ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    return '';
  }

  return token;
}

export function hashVideoRetentionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
