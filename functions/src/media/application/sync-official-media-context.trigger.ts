// functions/src/media/application/sync-official-media-context.trigger.ts
// -----------------------------------------------------------------------------
// OFFICIAL MEDIA CONTEXT PROJECTION
// -----------------------------------------------------------------------------
// Materializa em mídia pública somente uma projeção derivada para UI.
//
// Autoridades reutilizadas:
// - Profile: users + profile_kyc_records;
// - Venue: official_space_creation_grants + venues;
// - Organization: organizations + KYB + representation;
// - Event: event_authority_records;
// - vínculo oficial: community_official_associations.
//
// A projeção nunca concede autoridade, não é editável pelo proprietário, não
// altera score/ranking e não participa de Promotion/Boost.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../../account_lifecycle/_shared';
import {
  buildEventAuthorityRecordId,
} from '../../authority/event-authority.policy';
import {
  readEventAuthorityRecord,
} from '../../authority/event-authority-record.service';
import {
  normalizeCanonicalAuthorityResourceId,
  type CanonicalAuthorityTargetType,
} from '../../authority/canonical-resource-authority.model';
import {
  buildCommunityOfficialAssociationKey,
  sanitizeCommunityOfficialAssociationPublicProjection,
} from '../../community/community-official-association.model';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue } from '../../firebaseApp';
import {
  buildOrganizationRepresentationId,
} from '../../organization/organization-representation.policy';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../../shared/security/callable-app-check';
import {
  buildOfficialMediaContextProjection,
  deriveOfficialMediaContextEntry,
  officialMediaContextMatches,
  type OfficialMediaContextEntry,
  type OfficialMediaContextProjection,
} from './official-media-context.policy';

const MEDIA_BATCH_SIZE = 400;
const BACKFILL_PAGE_SIZE = 50;
const BACKFILL_STATE_PATH =
  'media_projection_maintenance/official_media_context_backfill_v2';

function safeId(value: unknown): string | null {
  return normalizeCanonicalAuthorityResourceId(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function holderUidFromAssociation(raw: unknown): string | null {
  const source = asRecord(raw);
  const authority = asRecord(source['authority']);
  return safeId(authority['holderUid']);
}

function targetFromAssociation(raw: unknown): {
  type: CanonicalAuthorityTargetType;
  id: string;
} | null {
  return sanitizeCommunityOfficialAssociationPublicProjection(raw)?.target ?? null;
}

async function resolveAssociationEntry(
  ownerUid: string,
  rawAssociation: unknown
): Promise<OfficialMediaContextEntry | null> {
  const target = targetFromAssociation(rawAssociation);
  if (!target || holderUidFromAssociation(rawAssociation) !== ownerUid) {
    return null;
  }

  if (target.type === 'profile') {
    const [userSnapshot, kycSnapshot] = await Promise.all([
      db.collection('users').doc(ownerUid).get(),
      db.collection('profile_kyc_records').doc(ownerUid).get(),
    ]);

    return deriveOfficialMediaContextEntry({
      ownerUid,
      rawAssociation,
      rawUser: userSnapshot.exists ? userSnapshot.data() : null,
      rawProfileKyc: kycSnapshot.exists ? kycSnapshot.data() : null,
    });
  }

  if (target.type === 'venue') {
    const [venueSnapshot, grantSnapshot] = await Promise.all([
      db.collection('venues').doc(target.id).get(),
      db.collection('official_space_creation_grants').doc(ownerUid).get(),
    ]);

    return deriveOfficialMediaContextEntry({
      ownerUid,
      rawAssociation,
      rawTarget: venueSnapshot.exists ? venueSnapshot.data() : null,
      rawCommercialGrant: grantSnapshot.exists ? grantSnapshot.data() : null,
    });
  }

  if (target.type === 'organization') {
    const representationId = buildOrganizationRepresentationId(
      target.id,
      ownerUid
    );
    if (!representationId) return null;

    const [organizationSnapshot, kybSnapshot, representationSnapshot] =
      await Promise.all([
        db.collection('organizations').doc(target.id).get(),
        db.collection('organization_kyb_records').doc(target.id).get(),
        db.collection('organization_representations').doc(representationId).get(),
      ]);

    return deriveOfficialMediaContextEntry({
      ownerUid,
      rawAssociation,
      rawTarget: organizationSnapshot.exists
        ? organizationSnapshot.data()
        : null,
      rawOrganizationKyb: kybSnapshot.exists ? kybSnapshot.data() : null,
      rawOrganizationRepresentation: representationSnapshot.exists
        ? representationSnapshot.data()
        : null,
    });
  }

  const authorityRecordId = buildEventAuthorityRecordId(target.id, ownerUid);
  if (!authorityRecordId) return null;

  const rawEventAuthority = await readEventAuthorityRecord(
    target.id,
    ownerUid
  );

  return deriveOfficialMediaContextEntry({
    ownerUid,
    rawAssociation,
    rawEventAuthority,
  });
}

async function resolveOfficialMediaContextForOwner(
  ownerUid: string
): Promise<OfficialMediaContextProjection | null> {
  const normalizedOwnerUid = safeId(ownerUid);
  if (!normalizedOwnerUid) return null;

  const associationsSnapshot = await db
    .collection('community_official_associations')
    .where('authority.holderUid', '==', normalizedOwnerUid)
    .get();

  const entries = await Promise.all(
    associationsSnapshot.docs
      .filter((document) => document.data()?.['status'] === 'verified')
      .map((document) =>
        resolveAssociationEntry(normalizedOwnerUid, document.data() ?? {})
      )
  );

  return buildOfficialMediaContextProjection(entries);
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
  const normalizedOwnerUid = safeId(ownerUid);
  if (!normalizedOwnerUid) return;

  const resolved = expected === undefined
    ? await resolveOfficialMediaContextForOwner(normalizedOwnerUid)
    : expected;

  const [photos, videos] = await Promise.all([
    syncCollection(
      `public_profiles/${normalizedOwnerUid}/public_photos`,
      resolved
    ),
    syncCollection(
      `public_profiles/${normalizedOwnerUid}/public_videos`,
      resolved
    ),
  ]);

  logger.info('official_media_context_owner_synced', {
    ownerUid: normalizedOwnerUid,
    active: resolved !== null,
    contextCount: resolved?.contexts.length ?? 0,
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

async function syncOwnersForAssociationTarget(
  type: CanonicalAuthorityTargetType,
  targetId: string
): Promise<void> {
  const associationKey = buildCommunityOfficialAssociationKey({
    type,
    id: targetId,
  });
  if (!associationKey) return;

  const snapshot = await db
    .collection('community_official_associations')
    .doc(associationKey)
    .get();
  if (!snapshot.exists) return;

  const holderUid = holderUidFromAssociation(snapshot.data());
  if (holderUid) {
    await syncOwnerPublicMedia(holderUid);
  }
}

export const syncOfficialMediaContextFromPhoto = onDocumentWritten(
  {
    document: 'public_profiles/{ownerUid}/public_photos/{photoId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    if (!event.data?.after.exists) return;
    const ownerUid = safeId(event.params.ownerUid);
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
    const ownerUid = safeId(event.params.ownerUid);
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
    const owners = new Set(
      [
        holderUidFromAssociation(
          event.data?.before.exists ? event.data.before.data() : null
        ),
        holderUidFromAssociation(
          event.data?.after.exists ? event.data.after.data() : null
        ),
      ].filter((value): value is string => !!value)
    );

    for (const ownerUid of owners) {
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
    const ownerUid = safeId(event.params.ownerUid);
    if (ownerUid) await syncOwnerPublicMedia(ownerUid);
  }
);

export const syncOfficialMediaContextFromIdentity = onDocumentWritten(
  {
    document: 'users/{ownerUid}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const ownerUid = safeId(event.params.ownerUid);
    if (ownerUid) await syncOwnerPublicMedia(ownerUid);
  }
);

export const syncOfficialMediaContextFromCommercialAuthority =
  onDocumentWritten(
    {
      document: 'official_space_creation_grants/{ownerUid}',
      region: FUNCTIONS_REGION,
      retry: true,
    },
    async (event) => {
      const ownerUid = safeId(event.params.ownerUid);
      if (ownerUid) await syncOwnerPublicMedia(ownerUid);
    }
  );

export const syncOfficialMediaContextFromVenue = onDocumentWritten(
  {
    document: 'venues/{venueId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const venueId = safeId(event.params.venueId);
    if (venueId) await syncOwnersForAssociationTarget('venue', venueId);
  }
);

export const syncOfficialMediaContextFromOrganization = onDocumentWritten(
  {
    document: 'organizations/{organizationId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const organizationId = safeId(event.params.organizationId);
    if (organizationId) {
      await syncOwnersForAssociationTarget('organization', organizationId);
    }
  }
);

export const syncOfficialMediaContextFromOrganizationKyb = onDocumentWritten(
  {
    document: 'organization_kyb_records/{organizationId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const organizationId = safeId(event.params.organizationId);
    if (organizationId) {
      await syncOwnersForAssociationTarget('organization', organizationId);
    }
  }
);

export const syncOfficialMediaContextFromOrganizationRepresentation =
  onDocumentWritten(
    {
      document: 'organization_representations/{representationId}',
      region: FUNCTIONS_REGION,
      retry: true,
    },
    async (event) => {
      const owners = new Set(
        [
          safeId(
            event.data?.before.exists
              ? event.data.before.data()?.['holderUid']
              : null
          ),
          safeId(
            event.data?.after.exists
              ? event.data.after.data()?.['holderUid']
              : null
          ),
        ].filter((value): value is string => !!value)
      );

      for (const ownerUid of owners) {
        await syncOwnerPublicMedia(ownerUid);
      }
    }
  );

export const syncOfficialMediaContextFromEventAuthority = onDocumentWritten(
  {
    document: 'event_authority_records/{recordId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const owners = new Set(
      [
        safeId(
          event.data?.before.exists
            ? event.data.before.data()?.['holderUid']
            : null
        ),
        safeId(
          event.data?.after.exists
            ? event.data.after.data()?.['holderUid']
            : null
        ),
      ].filter((value): value is string => !!value)
    );

    for (const ownerUid of owners) {
      await syncOwnerPublicMedia(ownerUid);
    }
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
    officialAssociations: number;
    profileAssociations: number;
    targetCounts: Readonly<Record<CanonicalAuthorityTargetType, number>>;
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
        officialAssociations: 0,
        profileAssociations: 0,
        targetCounts: {
          profile: 0,
          organization: 0,
          venue: 0,
          event: 0,
        },
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
    const ownerUids = new Set<string>();
    let officialAssociations = 0;
    const targetCounts: Record<CanonicalAuthorityTargetType, number> = {
      profile: 0,
      organization: 0,
      venue: 0,
      event: 0,
    };

    for (const document of snapshot.docs) {
      const rawAssociation = document.data() ?? {};
      const target = targetFromAssociation(rawAssociation);
      const ownerUid = holderUidFromAssociation(rawAssociation);
      if (!target || !ownerUid) continue;

      officialAssociations += 1;
      targetCounts[target.type] += 1;
      ownerUids.add(ownerUid);
    }

    for (const ownerUid of ownerUids) {
      await syncOwnerPublicMedia(ownerUid);
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
        officialAssociations,
        profileAssociations: targetCounts.profile,
        targetCounts,
        synchronizedOwners: ownerUids.size,
        updatedAt: Date.now(),
        updatedBy: adminUid,
        ...(completed ? { completedAt: Date.now() } : {}),
      },
      { merge: true }
    );

    logger.info('official_media_context_backfill_page_completed', {
      scanned: snapshot.size,
      officialAssociations,
      profileAssociations: targetCounts.profile,
      targetCounts,
      synchronizedOwners: ownerUids.size,
      completed,
    });

    return {
      completed,
      scanned: snapshot.size,
      officialAssociations,
      profileAssociations: targetCounts.profile,
      targetCounts,
      synchronizedOwners: ownerUids.size,
    };
  }
);
