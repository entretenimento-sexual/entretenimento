import {
  evaluateCanonicalAgeEligibility,
} from '../../compliance/age-eligibility.policy';
import {
  evaluateCanonicalOwnerLifecycle,
} from './owner-lifecycle-exposure.policy';
import { db } from '../../firebaseApp';
import {
  evaluatePublicMediaOwnerExposure,
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
  nowMs: number,
  requireCanonicalAge: boolean
): Promise<ReadonlyMap<string, PublicMediaOwnerExposureContext>> {
  const owners = normalizeOwnerUids(ownerUids);

  if (!owners.length) {
    return new Map<string, PublicMediaOwnerExposureContext>();
  }

  const refs = owners.flatMap((ownerUid) => {
    const baseRefs = [
      db.doc(`users/${ownerUid}`),
      db.doc(`public_profiles/${ownerUid}`),
    ];

    return requireCanonicalAge
      ? [
        ...baseRefs,
        db.doc(`age_eligibility_records/${ownerUid}`),
      ]
      : baseRefs;
  });
  const snapshots = await db.getAll(...refs);
  const result = new Map<string, PublicMediaOwnerExposureContext>();
  const stride = requireCanonicalAge ? 3 : 2;

  owners.forEach((ownerUid, index) => {
    const offset = index * stride;
    const userSnapshot = snapshots[offset];
    const profileSnapshot = snapshots[offset + 1];
    const lifecycle = evaluateCanonicalOwnerLifecycle(
      userSnapshot?.exists === true ? userSnapshot.data() : null
    );
    const baseInput = {
      publicProfile:
        profileSnapshot?.exists === true
          ? profileSnapshot.data() as Record<string, unknown>
          : null,
      canonicalOwnerLifecycleAllowed: lifecycle.allowed,
      viewerBlocked: blockedTargetUids.has(ownerUid),
      nowMs,
    };
    const decision = requireCanonicalAge
      ? (() => {
        const ageEligibilitySnapshot = snapshots[offset + 2];
        const ownerAgeDecision = evaluateCanonicalAgeEligibility({
          uid: ownerUid,
          rawRecord:
            ageEligibilitySnapshot?.exists === true
              ? ageEligibilitySnapshot.data()
              : null,
          nowMs,
        });

        return evaluatePublicMediaSignedOwnerExposure({
          ...baseInput,
          canonicalAgeAllowed: ownerAgeDecision.allowed,
          canonicalAgeExpiresAtMs: ownerAgeDecision.allowed
            ? ownerAgeDecision.expiresAtMs ?? null
            : null,
        });
      })()
      : evaluatePublicMediaOwnerExposure(baseInput);

    result.set(ownerUid, { ownerUid, ...decision });
  });

  return result;
}

export async function resolvePublicMediaOwnerExposure(
  ownerUids: readonly string[],
  blockedTargetUids: ReadonlySet<string>,
  nowMs: number
): Promise<ReadonlyMap<string, PublicMediaOwnerExposureContext>> {
  return resolveCanonicalOwnerExposure(
    ownerUids,
    blockedTargetUids,
    nowMs,
    false
  );
}

export async function resolvePublicMediaSignedOwnerExposure(
  ownerUids: readonly string[],
  blockedTargetUids: ReadonlySet<string>,
  nowMs: number
): Promise<ReadonlyMap<string, PublicMediaOwnerExposureContext>> {
  return resolveCanonicalOwnerExposure(
    ownerUids,
    blockedTargetUids,
    nowMs,
    true
  );
}
