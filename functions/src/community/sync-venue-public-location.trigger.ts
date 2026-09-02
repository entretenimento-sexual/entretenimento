// functions/src/community/sync-venue-public-location.trigger.ts
// -----------------------------------------------------------------------------
// SYNC VENUE PUBLIC LOCATION
// -----------------------------------------------------------------------------
// `venues` é a fonte canônica. Somente a localização coarse explicitamente
// permitida é denormalizada para Comunidade/Discovery. A sincronização acontece
// apenas quando a região muda e nunca projeta addressHint ou localização precisa.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { normalizeCommunityOfficialAssociationKey } from './community-official-association.model';
import {
  areCommunityPublicLocationsEqual,
  normalizeCommunityPublicLocation,
} from './community-public-location.model';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function resolveVenueAssociationKey(raw: unknown): string | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  return normalizeCommunityOfficialAssociationKey(source['officialAssociationKey']);
}

export const syncVenuePublicLocation = onDocumentWritten(
  {
    document: 'venues/{venueId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const venueId = normalizeSafeId(event.params['venueId']);
    if (!venueId) return;

    const beforeRaw = event.data?.before.exists
      ? (event.data.before.data() ?? {}) as Record<string, unknown>
      : null;
    const afterRaw = event.data?.after.exists
      ? (event.data.after.data() ?? {}) as Record<string, unknown>
      : null;
    const beforeLocation = normalizeCommunityPublicLocation(beforeRaw?.['region']);
    const afterLocation = normalizeCommunityPublicLocation(afterRaw?.['region']);

    if (areCommunityPublicLocationsEqual(beforeLocation, afterLocation)) return;

    const associationKey = resolveVenueAssociationKey(afterRaw ?? beforeRaw);
    if (!associationKey) return;

    const associationSnapshot = await db
      .collection('community_official_associations')
      .doc(associationKey)
      .get();
    if (!associationSnapshot.exists) return;

    const association = associationSnapshot.data() ?? {};
    const target = (association['target'] ?? {}) as Record<string, unknown>;
    const communityId = normalizeSafeId(association['communityId']);

    if (
      !communityId
      || target['type'] !== 'venue'
      || normalizeSafeId(target['id']) !== venueId
    ) {
      logger.warn('venue_public_location_association_mismatch', {
        venueId,
        associationKey,
      });
      return;
    }

    const communityRef = db.collection('communities').doc(communityId);
    const discoveryRef = db
      .collection('community_discovery_index')
      .doc(communityId);
    const [communitySnapshot, discoverySnapshot] = await Promise.all([
      communityRef.get(),
      discoveryRef.get(),
    ]);

    const community = communitySnapshot.exists
      ? communitySnapshot.data() ?? {}
      : null;
    const discovery = discoverySnapshot.exists
      ? discoverySnapshot.data() ?? {}
      : null;
    const communitySource = (community?.['source'] ?? {}) as Record<string, unknown>;
    const discoverySource = (discovery?.['source'] ?? {}) as Record<string, unknown>;
    const communityMatchesVenue =
      communitySource['type'] === 'venue'
      && normalizeSafeId(communitySource['id']) === venueId;
    const discoveryMatchesVenue =
      discoverySource['type'] === 'venue'
      && normalizeSafeId(discoverySource['id']) === venueId;

    if (!communityMatchesVenue && !discoveryMatchesVenue) return;

    const batch = db.batch();
    let writes = 0;

    if (
      communityMatchesVenue
      && !areCommunityPublicLocationsEqual(
        normalizeCommunityPublicLocation(community?.['publicLocation']),
        afterLocation
      )
    ) {
      batch.set(
        communityRef,
        {
          publicLocation: afterLocation ?? FieldValue.delete(),
        },
        { merge: true }
      );
      writes += 1;
    }

    if (
      discoveryMatchesVenue
      && !areCommunityPublicLocationsEqual(
        normalizeCommunityPublicLocation(discovery?.['publicLocation']),
        afterLocation
      )
    ) {
      batch.set(
        discoveryRef,
        {
          publicLocation: afterLocation ?? FieldValue.delete(),
        },
        { merge: true }
      );
      writes += 1;
    }

    if (writes === 0) return;

    await batch.commit();

    logger.debug('venue_public_location_synced', {
      venueId,
      communityId,
      writes,
      hasDistrict: afterLocation?.district !== null && afterLocation?.district !== undefined,
      removed: afterLocation === null,
    });
  }
);
