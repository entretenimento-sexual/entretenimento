import {
  evaluateCanonicalAgeEligibility,
} from '../../compliance/age-eligibility.policy';
import {
  evaluateCanonicalOwnerLifecycle,
} from './owner-lifecycle-exposure.policy';
import { db } from '../../firebaseApp';
import {
  evaluatePublicMediaSignedOwnerExposure,
  type PublicMediaOwnerExposureDecision,
} from './public-media-exposure.policy';

export interface PublicMediaOwnerExposureContext
  extends PublicMediaOwnerExposureDecision {
  readonly ownerUid: string;
}

function cleanOwnerUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
}

function normalizeOwnerUids(values: readonly string[]): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => cleanOwnerUid(value))
        .filter(Boolean)
    )
  );
}

async function resolveCanonicalOwnerExposure(
  ownerUids: readonly string[],
  blockedTargetUids: ReadonlySet<string>,
  nowMs: number
): Promise<ReadonlyMap<string, PublicMediaOwnerExposureContext>> {
  const owners = normalizeOwnerUids(ownerUids);

  if (!owners.length) {
    return new Map<string, PublicMediaOwnerExposureContext>();
  }

  const refs = owners.flatMap((ownerUid) => [
    db.doc(`users/${ownerUid}`),
    db.doc(`public_profiles/${ownerUid}`),
    db.doc(`age_eligibility_records/${ownerUid}`),
  ]);
  const snapshots = await db.getAll(...refs);
  const result = new Map<string, PublicMediaOwnerExposureContext>();

  owners.forEach((ownerUid, index) => {
    const userSnapshot = snapshots[index * 3];
    const profileSnapshot = snapshots[index * 3 + 1];
    const ageEligibilitySnapshot = snapshots[index * 3 + 2];
    const lifecycle = evaluateCanonicalOwnerLifecycle(
      userSnapshot?.exists === true ? userSnapshot.data() : null
    );
    const ownerAgeDecision = evaluateCanonicalAgeEligibility({
      uid: ownerUid,
      rawRecord:
        ageEligibilitySnapshot?.exists === true
          ? ageEligibilitySnapshot.data()
          : null,
      nowMs,
    });
    const decision = evaluatePublicMediaSignedOwnerExposure({
      publicProfile:
        profileSnapshot?.exists === true
          ? profileSnapshot.data() as Record<string, unknown>
          : null,
      canonicalOwnerLifecycleAllowed: lifecycle.allowed,
      viewerBlocked: blockedTargetUids.has(ownerUid),
      canonicalAgeAllowed: ownerAgeDecision.allowed,
      canonicalAgeExpiresAtMs:
        ownerAgeDecision.allowed
          ? ownerAgeDecision.expiresAtMs ?? null
          : null,
      nowMs,
    });

    result.set(ownerUid, { ownerUid, ...decision });
  });

  return result;
}

export async function resolvePublicMediaOwnerExposure(
  ownerUids: readonly string[],
  blockedTargetUids: ReadonlySet<string>,
  nowMs: number
): Promise<ReadonlyMap<string, PublicMediaOwnerExposureContext>> {
  return resolveCanonicalOwnerExposure(ownerUids, blockedTargetUids, nowMs);
}

export async function resolvePublicMediaSignedOwnerExposure(
  ownerUids: readonly string[],
  blockedTargetUids: ReadonlySet<string>,
  nowMs: number
): Promise<ReadonlyMap<string, PublicMediaOwnerExposureContext>> {
  return resolveCanonicalOwnerExposure(ownerUids, blockedTargetUids, nowMs);
}
