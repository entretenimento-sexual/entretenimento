// functions/src/community-boost/community-boost-authority.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST × OWNERSHIP AUTHORITY
// -----------------------------------------------------------------------------
// A campanha pertence economicamente ao anunciante que a abriu. A autoridade
// operacional sobre a Comunidade é um snapshot separado e precisa continuar
// válida antes de qualquer novo placement faturável.
//
// Invariantes:
// - transferência/arquivamento nunca migram dívida, budget ou ledger;
// - advertiserUid é imutável durante a vida da campanha;
// - qualquer mudança do owner canônico invalida a campanha antiga;
// - perda de autoridade/eligibilidade do anunciante bloqueia nova cobrança;
// - campanhas legadas sem snapshot explícito falham fechadas.
// -----------------------------------------------------------------------------

export const COMMUNITY_BOOST_AUTHORITY_SNAPSHOT_VERSION = 1 as const;

export type CommunityBoostAuthorityRole =
  | 'owner'
  | 'admin'
  | 'platform_admin';

export type CommunityBoostAuthorityDenialReason =
  | 'authority_anchor_missing'
  | 'community_unavailable'
  | 'community_ownership_changed'
  | 'advertiser_account_ineligible'
  | 'advertiser_authority_lost';

export interface CommunityBoostAuthoritySnapshot {
  readonly version: typeof COMMUNITY_BOOST_AUTHORITY_SNAPSHOT_VERSION;
  readonly advertiserUid: string;
  readonly communityOwnerUid: string;
  readonly communityOwnerTransferredAt: number | null;
  readonly role: CommunityBoostAuthorityRole;
}

export interface CommunityBoostAuthorityCurrentState {
  readonly advertiserUid: string;
  readonly advertiserEligible: boolean;
  readonly advertiserPlatformAdmin: boolean;
  readonly communityStatus: unknown;
  readonly communityModerationState: unknown;
  readonly communityOwnerUid: string | null;
  readonly communityOwnerTransferredAt: number | null;
  readonly membershipStatus: unknown;
  readonly membershipRole: unknown;
}

export type CommunityBoostAuthorityDecision =
  | Readonly<{ allowed: true; denialReason: null }>
  | Readonly<{
      allowed: false;
      denialReason: CommunityBoostAuthorityDenialReason;
    }>;

export function evaluateCommunityBoostAuthority(input: {
  readonly snapshot: Readonly<CommunityBoostAuthoritySnapshot> | null;
  readonly current: Readonly<CommunityBoostAuthorityCurrentState>;
}): CommunityBoostAuthorityDecision {
  const { snapshot, current } = input;

  if (
    !snapshot
    || snapshot.version !== COMMUNITY_BOOST_AUTHORITY_SNAPSHOT_VERSION
    || !snapshot.advertiserUid
    || !snapshot.communityOwnerUid
  ) {
    return denied('authority_anchor_missing');
  }

  if (
    current.communityStatus !== 'active'
    || current.communityModerationState !== 'active'
  ) {
    return denied('community_unavailable');
  }

  if (
    current.communityOwnerUid !== snapshot.communityOwnerUid
    || current.communityOwnerTransferredAt
      !== snapshot.communityOwnerTransferredAt
  ) {
    return denied('community_ownership_changed');
  }

  if (
    current.advertiserUid !== snapshot.advertiserUid
    || !current.advertiserEligible
  ) {
    return denied('advertiser_account_ineligible');
  }

  if (snapshot.role === 'platform_admin') {
    return current.advertiserPlatformAdmin
      ? allowed()
      : denied('advertiser_authority_lost');
  }

  if (
    current.membershipStatus !== 'active'
    || (
      current.membershipRole !== 'owner'
      && current.membershipRole !== 'admin'
    )
  ) {
    return denied('advertiser_authority_lost');
  }

  if (
    snapshot.role === 'owner'
    && (
      current.membershipRole !== 'owner'
      || current.communityOwnerUid !== snapshot.advertiserUid
    )
  ) {
    return denied('advertiser_authority_lost');
  }

  if (
    snapshot.role === 'admin'
    && current.membershipRole !== 'admin'
  ) {
    return denied('advertiser_authority_lost');
  }

  return allowed();
}

function allowed(): CommunityBoostAuthorityDecision {
  return { allowed: true, denialReason: null };
}

function denied(
  denialReason: CommunityBoostAuthorityDenialReason
): CommunityBoostAuthorityDecision {
  return { allowed: false, denialReason };
}
