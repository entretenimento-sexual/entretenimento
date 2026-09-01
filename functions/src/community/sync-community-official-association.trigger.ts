// functions/src/community/sync-community-official-association.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY OFFICIAL ASSOCIATION
// -----------------------------------------------------------------------------
// Mantém somente a projeção pública mínima da associação oficial no índice de
// Discovery. A coleção community_official_associations continua sendo a única
// fonte de verdade de verificação, autoridade, organização e auditoria.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { db, FieldValue } from '../firebaseApp';
import {
  normalizeCommunityOfficialAssociationKey,
  sanitizeCommunityOfficialAssociationPublicProjection,
} from './community-official-association.model';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export const syncCommunityOfficialAssociation = onDocumentWritten(
  'community_official_associations/{associationKey}',
  async (event) => {
    const associationKey = normalizeCommunityOfficialAssociationKey(
      event.params.associationKey
    );
    if (!associationKey) return;

    const after = event.data?.after.exists
      ? (event.data.after.data() ?? {}) as Record<string, unknown>
      : null;
    const before = event.data?.before.exists
      ? (event.data.before.data() ?? {}) as Record<string, unknown>
      : null;
    const communityId = normalizeSafeId(
      after?.['communityId'] ?? before?.['communityId']
    );
    if (!communityId) return;

    const communityRef = db.collection('communities').doc(communityId);
    const discoveryRef = db
      .collection('community_discovery_index')
      .doc(communityId);
    const [communitySnapshot, discoverySnapshot] = await Promise.all([
      communityRef.get(),
      discoveryRef.get(),
    ]);

    if (!discoverySnapshot.exists) return;

    const community = communitySnapshot.exists
      ? (communitySnapshot.data() ?? {}) as Record<string, unknown>
      : null;
    const expectedAssociationKey = normalizeCommunityOfficialAssociationKey(
      community?.['officialAssociationKey']
    );

    if (!after || expectedAssociationKey !== associationKey) {
      await discoveryRef.set(
        {
          officialAssociation: FieldValue.delete(),
        },
        { merge: true }
      );
      return;
    }

    const projection = sanitizeCommunityOfficialAssociationPublicProjection(
      after
    );

    if (!projection) {
      await discoveryRef.set(
        {
          officialAssociation: FieldValue.delete(),
        },
        { merge: true }
      );
      return;
    }

    await discoveryRef.set(
      {
        officialAssociation: projection,
      },
      { merge: true }
    );
  }
);
