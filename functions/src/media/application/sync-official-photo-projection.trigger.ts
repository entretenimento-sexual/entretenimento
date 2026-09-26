// functions/src/media/application/sync-official-photo-projection.trigger.ts
// -----------------------------------------------------------------------------
// OFFICIAL PHOTO PROJECTION
// -----------------------------------------------------------------------------
// Projeta em fotos públicas somente o fato de o PERFIL proprietário possuir
// associação oficial canônica, verificada e vigente.
//
// Fronteiras:
// - community_official_associations é a única fonte de verdade;
// - entitlement Business/Official não concede este selo;
// - boost/patrocínio não concede, remove ou altera este selo;
// - autoridade sobre organization/venue/event não transforma foto pessoal do
//   representante em Official Photo;
// - a projeção não participa de score, ranking ou cobrança.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import {
  normalizeCanonicalAuthorityResourceId,
} from '../../authority/canonical-resource-authority.model';
import {
  buildCommunityOfficialAssociationKey,
  sanitizeCommunityOfficialAssociationPublicProjection,
} from '../../community/community-official-association.model';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';

export interface OfficialPhotoProjection {
  readonly verified: true;
  readonly target: {
    readonly type: 'profile';
    readonly id: string;
  };
}

const PHOTO_BATCH_SIZE = 400;
const BACKFILL_PAGE_SIZE = 50;
const BACKFILL_STATE_PATH =
  'media_projection_maintenance/official_photo_association_backfill';

function normalizeProfileId(value: unknown): string | null {
  return normalizeCanonicalAuthorityResourceId(value);
}

function profileIdFromAssociation(raw: unknown): string | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const target = (source['target'] ?? {}) as Record<string, unknown>;

  if (target['type'] !== 'profile') return null;
  return normalizeProfileId(target['id']);
}

function buildOfficialPhotoProjection(
  rawAssociation: unknown,
  expectedProfileId: string
): OfficialPhotoProjection | null {
  const publicAssociation =
    sanitizeCommunityOfficialAssociationPublicProjection(rawAssociation);

  if (
    !publicAssociation
    || publicAssociation.target.type !== 'profile'
    || publicAssociation.target.id !== expectedProfileId
  ) {
    return null;
  }

  return Object.freeze({
    verified: true,
    target: Object.freeze({
      type: 'profile' as const,
      id: expectedProfileId,
    }),
  });
}

function officialPhotoProjectionMatches(
  raw: unknown,
  expected: OfficialPhotoProjection | null
): boolean {
  if (!expected) {
    return raw === null || raw === undefined;
  }

  const source = (raw ?? {}) as Record<string, unknown>;
  const target = (source['target'] ?? {}) as Record<string, unknown>;

  return (
    source['verified'] === true
    && target['type'] === 'profile'
    && target['id'] === expected.target.id
  );
}

async function resolveOwnerUidByProfileId(
  profileId: string
): Promise<string | null> {
  const snapshot = await db
    .collection('public_profiles')
    .where('profileId', '==', profileId)
    .limit(2)
    .get();

  if (snapshot.size > 1) {
    logger.error('official_photo_profile_identity_duplicate', {
      profileId,
      matches: snapshot.size,
    });
    return null;
  }

  const ownerUid = snapshot.docs[0]?.id?.trim() ?? '';
  return ownerUid || null;
}

async function resolveOfficialPhotoProjectionForOwner(
  ownerUid: string
): Promise<OfficialPhotoProjection | null> {
  const publicProfileRef = db.collection('public_profiles').doc(ownerUid);
  const publicProfileSnapshot = await publicProfileRef.get();

  if (!publicProfileSnapshot.exists) return null;

  const profileId = normalizeProfileId(
    publicProfileSnapshot.data()?.['profileId']
  );
  if (!profileId) return null;

  const associationKey = buildCommunityOfficialAssociationKey({
    type: 'profile',
    id: profileId,
  });
  if (!associationKey) return null;

  const associationSnapshot = await db
    .collection('community_official_associations')
    .doc(associationKey)
    .get();

  if (!associationSnapshot.exists) return null;

  return buildOfficialPhotoProjection(
    associationSnapshot.data(),
    profileId
  );
}

async function syncOwnerPublicPhotos(
  ownerUid: string,
  expected: OfficialPhotoProjection | null
): Promise<void> {
  const snapshot = await db
    .collection(`public_profiles/${ownerUid}/public_photos`)
    .get();

  const changed = snapshot.docs.filter(
    (document) =>
      !officialPhotoProjectionMatches(
        document.data()?.['officialPhoto'],
        expected
      )
  );

  for (let offset = 0; offset < changed.length; offset += PHOTO_BATCH_SIZE) {
    const batch = db.batch();

    changed
      .slice(offset, offset + PHOTO_BATCH_SIZE)
      .forEach((document) => {
        batch.set(
          document.ref,
          {
            officialPhoto: expected ?? FieldValue.delete(),
          },
          { merge: true }
        );
      });

    await batch.commit();
  }

  logger.info('official_photo_projection_owner_synced', {
    ownerUid,
    verified: expected?.verified === true,
    scanned: snapshot.size,
    changed: changed.length,
  });
}

export const syncOfficialPhotoProjectionFromPhoto = onDocumentWritten(
  {
    document: 'public_profiles/{ownerUid}/public_photos/{photoId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    if (!event.data?.after.exists) return;

    const ownerUid = String(event.params.ownerUid ?? '').trim();
    if (!ownerUid) return;

    const current = event.data.after.data() ?? {};
    const expected = await resolveOfficialPhotoProjectionForOwner(ownerUid);

    if (
      officialPhotoProjectionMatches(
        current['officialPhoto'],
        expected
      )
    ) {
      return;
    }

    await event.data.after.ref.set(
      {
        officialPhoto: expected ?? FieldValue.delete(),
      },
      { merge: true }
    );
  }
);

export const syncOfficialPhotoProjectionFromAssociation = onDocumentWritten(
  {
    document: 'community_official_associations/{associationKey}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const before = event.data?.before.exists
      ? event.data.before.data() ?? null
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data() ?? null
      : null;

    const profileIds = new Set(
      [
        profileIdFromAssociation(before),
        profileIdFromAssociation(after),
      ].filter((value): value is string => !!value)
    );

    for (const profileId of profileIds) {
      const ownerUid = await resolveOwnerUidByProfileId(profileId);
      if (!ownerUid) continue;

      const expected = buildOfficialPhotoProjection(after, profileId);
      await syncOwnerPublicPhotos(ownerUid, expected);
    }
  }
);


/**
 * Backfill incremental de rollout para associações já verificadas antes da
 * criação da projeção Official Photo.
 *
 * O job termina de forma persistente ao alcançar o fim do conjunto. Vínculos
 * criados/alterados depois disso são mantidos pelos triggers acima, evitando
 * um scan recorrente permanente da base.
 */
export const backfillExistingOfficialPhotoProjections = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
    maxInstances: 1,
  },
  async () => {
    const stateRef = db.doc(BACKFILL_STATE_PATH);
    const stateSnapshot = await stateRef.get();
    const state = stateSnapshot.exists ? stateSnapshot.data() ?? {} : {};

    if (state['completed'] === true) {
      return;
    }

    const cursorAssociationKey = String(
      state['cursorAssociationKey'] ?? ''
    ).trim();

    let query: FirebaseFirestore.Query = db
      .collection('community_official_associations')
      .where('status', '==', 'verified')
      .orderBy(FieldPath.documentId())
      .limit(BACKFILL_PAGE_SIZE);

    if (cursorAssociationKey) {
      query = query.startAfter(cursorAssociationKey);
    }

    const snapshot = await query.get();
    let profileAssociations = 0;
    let synchronizedOwners = 0;

    for (const document of snapshot.docs) {
      const association = document.data() ?? {};
      const profileId = profileIdFromAssociation(association);
      if (!profileId) continue;

      profileAssociations += 1;

      const ownerUid = await resolveOwnerUidByProfileId(profileId);
      if (!ownerUid) continue;

      const expected = buildOfficialPhotoProjection(
        association,
        profileId
      );
      if (!expected) continue;

      await syncOwnerPublicPhotos(ownerUid, expected);
      synchronizedOwners += 1;
    }

    const lastDocument = snapshot.docs.at(-1);
    const completed = snapshot.size < BACKFILL_PAGE_SIZE;

    await stateRef.set(
      {
        completed,
        cursorAssociationKey: completed
          ? null
          : lastDocument?.id ?? cursorAssociationKey,
        scanned: snapshot.size,
        profileAssociations,
        synchronizedOwners,
        updatedAt: Date.now(),
        ...(completed ? { completedAt: Date.now() } : {}),
      },
      { merge: true }
    );

    logger.info('official_photo_projection_backfill_page_completed', {
      scanned: snapshot.size,
      profileAssociations,
      synchronizedOwners,
      completed,
    });
  }
);
