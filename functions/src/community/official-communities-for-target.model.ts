// functions/src/community/official-communities-for-target.model.ts
// -----------------------------------------------------------------------------
// OFFICIAL COMMUNITIES FOR TARGET REQUEST
// -----------------------------------------------------------------------------
// Contrato canônico para consultar projeções públicas de Comunidades oficialmente
// vinculadas a uma entidade. O cliente nunca envia organização patrocinadora,
// responsável, papel de autoridade ou qualquer evidência privada de verificação.
// -----------------------------------------------------------------------------

import {
  CommunityOfficialTarget,
  CommunityOfficialTargetType,
} from './community-official-association.model';
import { normalizePublicProfileId } from '../identity/public-profile-id';

export interface OfficialCommunitiesForTargetRequest {
  target?: unknown;
  limit?: unknown;
}

export interface NormalizedOfficialCommunitiesForTargetRequest {
  target: CommunityOfficialTarget;
  limit: number;
}

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 12;
const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeTargetType(value: unknown): CommunityOfficialTargetType | null {
  return value === 'profile'
    || value === 'organization'
    || value === 'venue'
    || value === 'event'
    ? value
    : null;
}

function normalizeGenericTargetId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeTarget(raw: unknown): CommunityOfficialTarget | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const type = normalizeTargetType(source['type']);
  if (!type) return null;

  const id = type === 'profile'
    ? normalizePublicProfileId(source['id'])
    : normalizeGenericTargetId(source['id']);

  return id ? { type, id } : null;
}

export function normalizeOfficialCommunitiesForTargetRequest(
  raw: OfficialCommunitiesForTargetRequest | null | undefined
): NormalizedOfficialCommunitiesForTargetRequest | null {
  const target = normalizeTarget(raw?.target);
  if (!target) return null;

  const parsedLimit = Math.trunc(Number(raw?.limit));
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  return { target, limit };
}
