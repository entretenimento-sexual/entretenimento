// functions/src/community/community-membership-audit.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP AUDIT CONTRACTS
// -----------------------------------------------------------------------------
// Mantém o payload de auditoria de aprovação/recusa consistente entre os
// diferentes papéis de gestão. Não contém dependência de Firestore para poder
// ser validado isoladamente.
// -----------------------------------------------------------------------------

import {
  CommunityMembershipRole,
  CommunityMembershipStatus,
} from './community-membership-request.policy';

type CommunityMembershipManagerRole = Extract<
  CommunityMembershipRole,
  'owner' | 'admin' | 'moderator'
>;

type CommunityMembershipReviewStatus = Extract<
  CommunityMembershipStatus,
  'active' | 'left'
>;

export interface CommunityMembershipReviewAuditInput {
  action: string | null;
  communityId: string;
  actorUid: string;
  actorRole: CommunityMembershipManagerRole;
  subjectUid: string;
  status: CommunityMembershipReviewStatus;
}

export interface CommunityMembershipReviewAuditPayload
  extends Omit<CommunityMembershipReviewAuditInput, 'action'> {
  action: string;
  role: 'member';
  createdAt: unknown;
  source: 'callable';
}

export function buildCommunityMembershipReviewAudit(
  input: CommunityMembershipReviewAuditInput,
  createdAt: unknown
): CommunityMembershipReviewAuditPayload {
  const action = String(input.action ?? '').trim();

  if (!action) {
    throw new Error('A decisão de revisão não informou uma ação de auditoria.');
  }

  return {
    ...input,
    action,
    role: 'member',
    createdAt,
    source: 'callable',
  };
}
