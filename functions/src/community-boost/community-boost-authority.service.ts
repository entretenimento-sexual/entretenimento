// functions/src/community-boost/community-boost-authority.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST AUTHORITY SERVICE
// -----------------------------------------------------------------------------
// Revalida authority antes de billing e encerra campanhas abertas quando a
// relação anunciante × Comunidade deixa de ser válida.
// -----------------------------------------------------------------------------

import type { Transaction } from 'firebase-admin/firestore';

import {
  assertInteractionAccessData,
} from '../account_lifecycle/interaction-access.policy';
import { db } from '../firebaseApp';
import {
  COMMUNITY_BOOST_AUTHORITY_SNAPSHOT_VERSION,
  evaluateCommunityBoostAuthority,
  type CommunityBoostAuthorityDecision,
  type CommunityBoostAuthorityRole,
  type CommunityBoostAuthoritySnapshot,
} from './community-boost-authority.policy';
import {
  normalizeCommunityBoostCampaign,
  type CommunityBoostCampaign,
} from './community-boost.policy';

export type CommunityBoostStopReason =
  | 'community_ownership_transferred'
  | 'community_archived'
  | 'community_lifecycle_archived'
  | 'authority_anchor_missing'
  | 'community_unavailable'
  | 'community_ownership_changed'
  | 'advertiser_account_ineligible'
  | 'advertiser_authority_lost';

export interface CommunityBoostStopResult {
  readonly campaignId: string;
  readonly advertiserUid: string;
  readonly previousStatus: 'active' | 'paused';
  readonly reason: CommunityBoostStopReason;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function finiteEpochOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(normalized)
    ? normalized
    : null;
}

function normalizeAuthorityRole(
  value: unknown
): CommunityBoostAuthorityRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'platform_admin'
    ? value
    : null;
}

function authoritySnapshot(
  campaign: Readonly<CommunityBoostCampaign>
): Readonly<CommunityBoostAuthoritySnapshot> | null {
  if (
    campaign.authoritySnapshotVersion
      !== COMMUNITY_BOOST_AUTHORITY_SNAPSHOT_VERSION
    || !campaign.communityOwnerUidSnapshot
    || !campaign.authorityRoleSnapshot
  ) {
    return null;
  }

  return Object.freeze({
    version: COMMUNITY_BOOST_AUTHORITY_SNAPSHOT_VERSION,
    advertiserUid: campaign.advertiserUid,
    communityOwnerUid: campaign.communityOwnerUidSnapshot,
    communityOwnerTransferredAt:
      campaign.communityOwnerTransferredAtSnapshot,
    role: campaign.authorityRoleSnapshot,
  });
}

function advertiserInteractionEligible(input: {
  readonly rawUser: unknown;
  readonly rawAgeEligibility: unknown;
  readonly advertiserUid: string;
}): boolean {
  try {
    assertInteractionAccessData(
      input.rawUser as Parameters<typeof assertInteractionAccessData>[0],
      input.rawAgeEligibility,
      input.advertiserUid
    );
    return true;
  } catch {
    return false;
  }
}

export async function evaluateCommunityBoostCampaignAuthorityInTransaction(
  transaction: Transaction,
  campaign: Readonly<CommunityBoostCampaign>
): Promise<Readonly<CommunityBoostAuthorityDecision>> {
  const communityRef = db
    .collection('communities')
    .doc(campaign.communityId);
  const membershipRef = communityRef
    .collection('members')
    .doc(campaign.advertiserUid);
  const advertiserUserRef = db
    .collection('users')
    .doc(campaign.advertiserUid);
  const ageEligibilityRef = db
    .collection('age_eligibility_records')
    .doc(campaign.advertiserUid);

  const [
    communitySnapshot,
    membershipSnapshot,
    advertiserUserSnapshot,
    ageEligibilitySnapshot,
  ] = await Promise.all([
    transaction.get(communityRef),
    transaction.get(membershipRef),
    transaction.get(advertiserUserRef),
    transaction.get(ageEligibilityRef),
  ]);

  const community = communitySnapshot.exists
    ? asRecord(communitySnapshot.data())
    : {};
  const moderation = asRecord(community['moderation']);
  const membership = membershipSnapshot.exists
    ? asRecord(membershipSnapshot.data())
    : {};
  const advertiserUser = advertiserUserSnapshot.exists
    ? asRecord(advertiserUserSnapshot.data())
    : {};
  const currentOwnerUid = cleanId(community['ownerUid']);
  const currentTransferredAt = finiteEpochOrNull(
    community['ownerTransferredAt']
  );
  const currentMembershipRole = normalizeAuthorityRole(
    membership['role']
  );

  return evaluateCommunityBoostAuthority({
    snapshot: authoritySnapshot(campaign),
    current: {
      advertiserUid: campaign.advertiserUid,
      advertiserEligible: advertiserInteractionEligible({
        rawUser: advertiserUserSnapshot.exists
          ? advertiserUserSnapshot.data()
          : null,
        rawAgeEligibility: ageEligibilitySnapshot.exists
          ? ageEligibilitySnapshot.data()
          : null,
        advertiserUid: campaign.advertiserUid,
      }),
      advertiserPlatformAdmin: advertiserUser['role'] === 'admin',
      communityStatus: community['status'],
      communityModerationState: moderation['state'],
      communityOwnerUid: currentOwnerUid,
      communityOwnerTransferredAt: currentTransferredAt,
      membershipStatus: membership['status'],
      membershipRole: currentMembershipRole,
    },
  });
}

export async function stopOpenCommunityBoostForCommunityInTransaction(input: {
  readonly transaction: Transaction;
  readonly communityId: string;
  readonly reason:
    | 'community_ownership_transferred'
    | 'community_archived'
    | 'community_lifecycle_archived';
  readonly now: number;
  readonly actorUid: string;
}): Promise<Readonly<CommunityBoostStopResult> | null> {
  const activeSlotRef = db
    .collection('community_boost_active_slots')
    .doc(input.communityId);
  const activeSlotSnapshot = await input.transaction.get(activeSlotRef);

  if (!activeSlotSnapshot.exists) return null;

  const activeSlot = activeSlotSnapshot.data() ?? {};
  const campaignId = cleanId(activeSlot['campaignId']);
  if (!campaignId) return null;

  const campaignRef = db
    .collection('community_boost_campaigns')
    .doc(campaignId);
  const campaignSnapshot = await input.transaction.get(campaignRef);
  const campaign = campaignSnapshot.exists
    ? normalizeCommunityBoostCampaign(campaignSnapshot.data())
    : null;

  if (
    !campaign
    || campaign.communityId !== input.communityId
    || (
      campaign.status !== 'active'
      && campaign.status !== 'paused'
    )
  ) {
    return null;
  }

  return stopCampaignInTransaction({
    transaction: input.transaction,
    campaign,
    activeSlotRef,
    activeSlotCampaignId: campaignId,
    reason: input.reason,
    now: input.now,
    actorUid: input.actorUid,
  });
}

export async function stopCommunityBoostForAuthorityLossInTransaction(input: {
  readonly transaction: Transaction;
  readonly campaign: Readonly<CommunityBoostCampaign>;
  readonly decision: Readonly<CommunityBoostAuthorityDecision>;
  readonly now: number;
}): Promise<Readonly<CommunityBoostStopResult> | null> {
  if (input.decision.allowed) return null;

  const activeSlotRef = db
    .collection('community_boost_active_slots')
    .doc(input.campaign.communityId);
  const activeSlotSnapshot = await input.transaction.get(activeSlotRef);
  const activeSlotCampaignId = activeSlotSnapshot.exists
    ? cleanId(activeSlotSnapshot.data()?.['campaignId'])
    : null;

  return stopCampaignInTransaction({
    transaction: input.transaction,
    campaign: input.campaign,
    activeSlotRef,
    activeSlotCampaignId,
    reason: input.decision.denialReason,
    now: input.now,
    actorUid: 'system',
  });
}

function stopCampaignInTransaction(input: {
  readonly transaction: Transaction;
  readonly campaign: Readonly<CommunityBoostCampaign>;
  readonly activeSlotRef: FirebaseFirestore.DocumentReference;
  readonly activeSlotCampaignId: string | null;
  readonly reason: CommunityBoostStopReason;
  readonly now: number;
  readonly actorUid: string;
}): Readonly<CommunityBoostStopResult> | null {
  if (
    input.campaign.status !== 'active'
    && input.campaign.status !== 'paused'
  ) {
    return null;
  }

  const campaignRef = db
    .collection('community_boost_campaigns')
    .doc(input.campaign.campaignId);

  input.transaction.update(campaignRef, {
    status: 'canceled',
    stoppedAt: input.now,
    stoppedReason: input.reason,
    updatedAt: input.now,
  });

  if (input.activeSlotCampaignId === input.campaign.campaignId) {
    input.transaction.delete(input.activeSlotRef);
  }

  input.transaction.create(
    db.collection('community_boost_audit').doc(),
    {
      action: 'community_boost_campaign_stopped_by_authority',
      campaignId: input.campaign.campaignId,
      communityId: input.campaign.communityId,
      advertiserUid: input.campaign.advertiserUid,
      actorUid: input.actorUid,
      previousStatus: input.campaign.status,
      nextStatus: 'canceled',
      reason: input.reason,
      ledgerOwnershipTransferred: false,
      createdAt: input.now,
    }
  );

  return Object.freeze({
    campaignId: input.campaign.campaignId,
    advertiserUid: input.campaign.advertiserUid,
    previousStatus: input.campaign.status,
    reason: input.reason,
  });
}
