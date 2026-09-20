// src/app/community/data-access/official-community-create.model.ts
// -----------------------------------------------------------------------------
// OFFICIAL COMMUNITY CREATION - CLIENT CONTRACT
// -----------------------------------------------------------------------------
// O cliente escolhe somente o alvo e conteúdo editorial. Autoridade, sponsor,
// evidência, role oficial, ownerUid e capacidade nunca fazem parte do comando.
// -----------------------------------------------------------------------------

import {
  type CommunityOfficialTarget,
  normalizeCommunityOfficialTarget,
} from './community-official-target.policy';
import type {
  CommunityCreateJoinPolicy,
  CommunityCreateTheme,
} from './community-create.model';

export interface OfficialCommunityCreateCommand {
  requestId: string;
  target: CommunityOfficialTarget;
  name: string;
  theme: CommunityCreateTheme;
  description: string | null;
  rules: string;
  joinPolicy: CommunityCreateJoinPolicy;
  tagIds: readonly string[];
  declarationAccepted: true;
}

export interface OfficialCommunityCreateResult {
  communityId: string;
  associationKey: string;
  target: CommunityOfficialTarget;
  created: boolean;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,192}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeOfficialCommunityCreateResult(
  raw: unknown
): OfficialCommunityCreateResult | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const associationKey = normalizeSafeId(source['associationKey']);
  const target = normalizeCommunityOfficialTarget(source['target']);

  if (!communityId || !associationKey || !target) return null;

  return {
    communityId,
    associationKey,
    target,
    created: source['created'] === true,
  };
}
