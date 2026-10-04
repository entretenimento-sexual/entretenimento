import {
  evaluateCanonicalOwnerLifecycle,
} from './owner-lifecycle-exposure.policy';
import { db } from '../../firebaseApp';
import {
  evaluatePublicMediaOwnerExposure,
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
  ]);
  const snapshots = await db.getAll(...refs);
  const result = new Map<string, PublicMediaOwnerExposureContext>();

  owners.forEach((ownerUid, index) => {
    const offset = index * 2;
    const userSnapshot = snapshots[offset];
    const profileSnapshot = snapshots[offset + 1];
    const lifecycle = evaluateCanonicalOwnerLifecycle(
      userSnapshot?.exists === true ? userSnapshot.data() : null
    );

    const decision = evaluatePublicMediaOwnerExposure({
      publicProfile:
        profileSnapshot?.exists === true
          ? profileSnapshot.data() as Record<string, unknown>
          : null,
      canonicalOwnerLifecycleAllowed: lifecycle.allowed,
      viewerBlocked: blockedTargetUids.has(ownerUid),
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
  return resolveCanonicalOwnerExposure(
    ownerUids,
    blockedTargetUids,
    nowMs
  );
}

/**
 * Alias transitório para consumidores de URL assinada. A resolução é a mesma:
 * lifecycle público + bloqueio bilateral, sem consulta etária em Media.
 */
export async function resolvePublicMediaSignedOwnerExposure(
  ownerUids: readonly string[],
  blockedTargetUids: ReadonlySet<string>,
  nowMs: number
): Promise<ReadonlyMap<string, PublicMediaOwnerExposureContext>> {
  return resolveCanonicalOwnerExposure(
    ownerUids,
    blockedTargetUids,
    nowMs
  );
}
