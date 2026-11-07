// Issue #236 — shared fail-closed protection for residual legacy public fields.
// No Firestore SDK, IO, timestamps, user identity, or client-provided authorization.
// A private recovery proof is NOT available; it cannot be inferred from a flag.
import { PRIVATE_DISCOVERY_INTEREST_FIELDS } from './public-profile-discovery-projection';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** An own key counts even when its value is null or undefined. */
export function hasLegacyPrivateDiscoveryFields(value: unknown): boolean {
  return record(value) && PRIVATE_DISCOVERY_INTEREST_FIELDS.some(
    field => Object.prototype.hasOwnProperty.call(value, field)
  );
}

/** The account deletion/purge lifecycle remains authoritative. */
export function isLegacyOwnerRemovalInProgress(value: unknown): boolean {
  if (!record(value)) return true;
  const status = String(value['accountStatus'] ?? 'active').trim().toLowerCase();
  return status === 'deleted' || status === 'deleting' ||
    status === 'pending_deletion' || status === 'purging' ||
    value['deletionRequestedAt'] != null ||
    value['deletedAt'] != null ||
    value['purgeStartedAt'] != null ||
    value['purgeLeaseOwner'] != null;
}

/**
 * Protect legacy documents from routine synchronization and visibility cleanup.
 * This is a HOLD, not a persistence proof. Account deletion still purges data.
 * Readers must independently deny legacy documents; holding does NOT publish.
 */
export function mustHoldLegacyPublicProfileMutation(
  owner: unknown,
  publicProfile: unknown
): boolean {
  return record(owner) &&
    !isLegacyOwnerRemovalInProgress(owner) &&
    hasLegacyPrivateDiscoveryFields(publicProfile);
}
