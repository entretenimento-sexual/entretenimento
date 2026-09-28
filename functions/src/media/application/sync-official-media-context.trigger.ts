// functions/src/media/application/sync-official-media-context.trigger.ts
// -----------------------------------------------------------------------------
// OFFICIAL MEDIA CONTEXT PROJECTION
// -----------------------------------------------------------------------------
// Materializa em mídia pública apenas um contexto derivado para UI.
//
// Autoridades:
// - users/{uid}.profileId: identidade pública canônica do perfil;
// - profile_kyc_records/{uid}: identidade verificada vigente;
// - community_official_associations/{profile:profileId}: associação oficial.
//
// A projeção abaixo nunca concede autoridade, não é editável pelo proprietário,
// não altera score/ranking e é totalmente independente de Promotion/Boost.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../../account_lifecycle/_shared';
import {
  normalizeCanonicalAuthorityResourceId,
} from '../../authority/canonical-resource-authority.model';
import {
  buildCommunityOfficialAssociationKey,
} from '../../community/community-official-association.model';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../../shared/security/callable-app-check';
import {
  deriveOfficialMediaContext,
  officialMediaContextMatches,
  type OfficialMediaContextProjection,
} from './official-media-context.policy';

const MEDIA_BATCH_SIZE = 400;
const BACKFILL_PAGE_SIZE = 50;
const BACKFILL_STATE_PATH =
  'media_projection_maintenance/official_media_context_backfill';

function normalizeProfileId(value: unknown): string | null {
  return normalizeCanonicalAuthorityResourceId(value);
}

function profileIdFromAssociation(raw: unknown): string | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const target = (source['target'] ?? {}) as Record<string, unknown>;

  if (target['type'] !== 'profile') return null;
  return normalizeProfileId(target['id']);
}

async function resolveOwnerUidByProfileId(
  profileId: string
): Promise<string | null> {
  const snapshot = await db
    .collection('users')
    .where('profileId', '==', profileId)
    .limit(2)
    .get();

  if (snapshot.size > 1) {
    logger.error('official_media_profile_identity_duplicate', {
      profileId,
      matches: snapshot.size,
    });
    return null;
  }

  const ownerUid = snapshot.docs[0]?.id?.trim() ?? '';
  return ownerUid || null;
}

async function resolveOfficialMediaContextForOwner(
  ownerUid: string
): Promise<OfficialMediaContextProjection | null> {
  const [userSnapshot, kycSnapshot] = await Promise.all([
    db.collection('users').doc(ownerUid).get(),
    db.collection('profile_kyc_records').doc(ownerUid).get(),
  ]);

  if (!userSnapshot.exists) return null;

  const user = userSnapshot.data() ?? {};
  const profileId = normalizeProfileId(user['profileId']);
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

  return deriveOfficialMediaContext({
    ownerUid,
    rawUser: user,
    rawProfileKyc: kycSnapshot.exists ? kycSnapshot.data() : null,
    rawAssociation: associationSnapshot.exists
      ? associationSnapshot.data()
      : null,
  });
}

async function syncCollection(
  collectionPath: string,
  expected: OfficialMediaContextProjection | null
): Promise<{ scanned: number; changed: number }> {
  const snapshot = await db.collection(collectionPath).get();
  const changed = snapshot.docs.filter((document) => {
    const data = document.data() ?? {};

    return !officialMediaContextMatches(
      data['officialMediaContext'],
      expected
    ) || data['officialPhoto'] !== undefined;
  });

  for (let offset = 0; offset < changed.length; offset += MEDIA_BATCH_SIZE) {
    const batch = db.batch();

    changed
      .slice(offset, offset + MEDIA_BATCH_SIZE)
      .forEach((document) => {
        batch.set(
          document.ref,
          {
            officialMediaContext: expected ?? FieldValue.delete(),
            // Migração: o campo antigo não pode coexistir como estado paralelo.
            officialPhoto: FieldValue.delete(),
          },
          { merge: true }
        );
      });

    await batch.commit();
  }

  return {
    scanned: snapshot.size,
    changed: changed.length,
  };
}

async function syncOwnerPublicMedia(
  ownerUid: string,
  expected?: OfficialMediaContextProjection | null
): Promise<void> {
  const resolved = expected === undefined
    ? await resolveOfficialMediaContextForOwner(ownerUid)
    : expected;

  const [photos, videos] = await Promise.all([
    syncCollection(
      `public_profiles/${ownerUid}/public_photos`,
      resolved
    ),
    syncCollection(
      `public_profiles/${ownerUid}/public_videos`,
      resolved
    ),
  ]);

  logger.info('official_media_context_owner_synced', {
    ownerUid,
    active: resolved !== null,
    photoScanned: photos.scanned,
    photoChanged: photos.changed,
    videoScanned: videos.scanned,
    videoChanged: videos.changed,
  });
}

async function reconcileMediaDocument(
  ownerUid: string,
  data: Record<string, unknown>,
  ref: FirebaseFirestore.DocumentReference
): Promise<void> {
  const expected = await resolveOfficialMediaContextForOwner(ownerUid);

  if (
    officialMediaContextMatches(data['officialMediaContext'], expected)
    && data['officialPhoto'] === undefined
  ) {
    return;
  }

  await ref.set(
    {
      officialMediaContext: expected ?? FieldValue.delete(),
      officialPhoto: FieldValue.delete(),
    },
    { merge: true }
  );
}

export const syncOfficialMediaContextFromPhoto = onDocumentWritten(
  {
    document: 'public_profiles/{ownerUid}/public_photos/{photoId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    if (!event.data?.after.exists) return;

    const ownerUid = String(event.params.ownerUid ?? '').trim();
    if (!ownerUid) return;

    await reconcileMediaDocument(
      ownerUid,
      event.data.after.data() ?? {},
      event.data.after.ref
    );
  }
);

export const syncOfficialMediaContextFromVideo = onDocumentWritten(
  {
    document: 'public_profiles/{ownerUid}/public_videos/{videoId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    if (!event.data?.after.exists) return;

    const ownerUid = String(event.params.ownerUid ?? '').trim();
    if (!ownerUid) return;

    await reconcileMediaDocument(
      ownerUid,
      event.data.after.data() ?? {},
      event.data.after.ref
    );
  }
);

export const syncOfficialMediaContextFromAssociation = onDocumentWritten(
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
      await syncOwnerPublicMedia(ownerUid);
    }
  }
);

export const syncOfficialMediaContextFromProfileKyc = onDocumentWritten(
  {
    document: 'profile_kyc_records/{ownerUid}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const ownerUid = String(event.params.ownerUid ?? '').trim();
    if (!ownerUid) return;

    await syncOwnerPublicMedia(ownerUid);
  }
);

export const syncOfficialMediaContextFromIdentity = onDocumentWritten(
  {
    document: 'users/{ownerUid}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const beforeProfileId = normalizeProfileId(
      event.data?.before.exists
        ? event.data.before.data()?.['profileId']
        : null
    );
    const afterProfileId = normalizeProfileId(
      event.data?.after.exists
        ? event.data.after.data()?.['profileId']
        : null
    );

    if (beforeProfileId === afterProfileId) return;

    const ownerUid = String(event.params.ownerUid ?? '').trim();
    if (!ownerUid) return;

    await syncOwnerPublicMedia(ownerUid);
  }
);

export const backfillExistingOfficialMediaContexts = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<{
    completed: boolean;
    scanned: number;
    profileAssociations: number;
    synchronizedOwners: number;
  }> => {
    assertCallableAppCheck(request.app);

    const adminUid = String(request.auth?.uid ?? '').trim();
    const token = (request.auth?.token ?? {}) as Record<string, unknown>;
    const roles = Array.isArray(token['roles']) ? token['roles'] : [];
    const isAdmin =
      token['admin'] === true
      || token['role'] === 'admin'
      || roles.includes('admin');

    if (!adminUid) {
      throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
    }

    if (!isAdmin) {
      throw new HttpsError(
        'permission-denied',
        'Apenas administradores podem reconciliar Official Media Context.'
      );
    }

    assertRecentAuthentication(
      request.auth?.token as Record<string, unknown> | undefined
    );

    const stateRef = db.doc(BACKFILL_STATE_PATH);
    const stateSnapshot = await stateRef.get();
    const state = stateSnapshot.exists ? stateSnapshot.data() ?? {} : {};

    if (state['completed'] === true) {
      return {
        completed: true,
        scanned: 0,
        profileAssociations: 0,
        synchronizedOwners: 0,
      };
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
      const profileId = profileIdFromAssociation(document.data() ?? {});
      if (!profileId) continue;

      profileAssociations += 1;

      const ownerUid = await resolveOwnerUidByProfileId(profileId);
      if (!ownerUid) continue;

      await syncOwnerPublicMedia(ownerUid);
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
        updatedBy: adminUid,
        ...(completed ? { completedAt: Date.now() } : {}),
      },
      { merge: true }
    );

    logger.info('official_media_context_backfill_page_completed', {
      scanned: snapshot.size,
      profileAssociations,
      synchronizedOwners,
      completed,
    });

    return {
      completed,
      scanned: snapshot.size,
      profileAssociations,
      synchronizedOwners,
    };
  }
);
