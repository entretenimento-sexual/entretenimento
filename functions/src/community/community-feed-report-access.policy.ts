// -----------------------------------------------------------------------------
// COMMUNITY FEED REPORT ACCESS POLICY
// -----------------------------------------------------------------------------
// Reproduz o acesso de leitura usado pelo viewer context, mas recebe snapshots
// canônicos já lidos pela transação que criará a denúncia. O estado
// scheduled_for_deletion é um fence terminal: nenhuma nova evidência de
// moderação pode nascer depois que a Comunidade entrou nesse estado.
// -----------------------------------------------------------------------------

import {
  resolveCommunityViewerMode,
  sanitizeCommunityDocument,
  sanitizeCommunityPreviewDetails,
} from './community-preview.model';

export interface CommunityFeedReportAccessDecision {
  allowed: boolean;
  memberContentAccess: boolean;
  authenticatedPreviewAccess: boolean;
  denialReason: 'scheduled_for_deletion' | 'access_denied' | null;
}

function denied(
  denialReason: Exclude<CommunityFeedReportAccessDecision['denialReason'], null>
): CommunityFeedReportAccessDecision {
  return {
    allowed: false,
    memberContentAccess: false,
    authenticatedPreviewAccess: false,
    denialReason,
  };
}

export function evaluateCommunityFeedReportAccess(
  communityId: string,
  rawCommunity: unknown,
  rawMembership: unknown
): CommunityFeedReportAccessDecision {
  const raw = (rawCommunity ?? {}) as Record<string, unknown>;

  if (raw['status'] === 'scheduled_for_deletion') {
    return denied('scheduled_for_deletion');
  }

  const moderation = (raw['moderation'] ?? {}) as Record<string, unknown>;
  const access = (raw['access'] ?? {}) as Record<string, unknown>;
  const viewer = resolveCommunityViewerMode(rawMembership);
  const community = sanitizeCommunityDocument(communityId, rawCommunity);
  const previewDetails = sanitizeCommunityPreviewDetails(rawCommunity);
  const moderationActive = moderation['state'] === 'active';
  const operational = raw['status'] === 'active' && moderationActive;
  const authenticatedPreviewAccess =
    operational
    && raw['visibility'] === 'public_preview'
    && access['preview'] === 'authenticated';
  const linkedViewer = viewer.active || viewer.mode === 'pending';

  if (
    viewer.blocked
    || !community
    || !previewDetails
    || (!authenticatedPreviewAccess && !linkedViewer)
  ) {
    return denied('access_denied');
  }

  return {
    allowed: true,
    memberContentAccess: viewer.active,
    authenticatedPreviewAccess,
    denialReason: null,
  };
}
