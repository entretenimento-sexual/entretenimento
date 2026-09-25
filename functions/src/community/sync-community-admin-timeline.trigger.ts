// functions/src/community/sync-community-admin-timeline.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY ADMIN TIMELINE
// -----------------------------------------------------------------------------
// Projeta apenas eventos administrativos explicitamente permitidos.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildCommunityAdminTimelineProjection,
  buildCommunityAdminTimelineProjectionId,
  type CommunityAdminTimelineSource,
} from './community-admin-timeline.projection';

async function projectAudit(
  source: CommunityAdminTimelineSource,
  auditId: string,
  rawAudit: unknown
): Promise<void> {
  const projection = buildCommunityAdminTimelineProjection({
    source,
    auditId,
    rawAudit,
  });

  if (!projection) {
    logger.debug('community_admin_timeline_audit_skipped', {
      source,
      auditId,
    });
    return;
  }

  const projectionId = buildCommunityAdminTimelineProjectionId(source, auditId);
  await db
    .collection('community_admin_timeline')
    .doc(projection.communityId)
    .collection('items')
    .doc(projectionId)
    .set({
      ...projection,
      projectedAtMs: Date.now(),
    });

  logger.debug('community_admin_timeline_projected', {
    source,
    communityId: projection.communityId,
    eventType: projection.eventType,
  });
}

export const syncCommunityAdminTimelineMembershipAudit = onDocumentCreated(
  {
    document: 'community_membership_audit/{auditId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    if (!event.data) return;
    await projectAudit(
      'membership',
      String(event.params['auditId'] ?? ''),
      event.data.data()
    );
  }
);

export const syncCommunityAdminTimelineSettingsAudit = onDocumentCreated(
  {
    document: 'community_settings_audit/{auditId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    if (!event.data) return;
    await projectAudit(
      'settings',
      String(event.params['auditId'] ?? ''),
      event.data.data()
    );
  }
);

export const syncCommunityAdminTimelineFeedAudit = onDocumentCreated(
  {
    document: 'community_feed_audit/{auditId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    if (!event.data) return;
    await projectAudit(
      'feed',
      String(event.params['auditId'] ?? ''),
      event.data.data()
    );
  }
);

export const syncCommunityAdminTimelineTopicAudit = onDocumentCreated(
  {
    document: 'community_topic_audit/{auditId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    if (!event.data) return;
    await projectAudit(
      'topic',
      String(event.params['auditId'] ?? ''),
      event.data.data()
    );
  }
);

export const syncCommunityAdminTimelineOfficialClaimAudit = onDocumentCreated(
  {
    document: 'community_official_claim_audit/{auditId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    if (!event.data) return;
    await projectAudit(
      'official',
      String(event.params['auditId'] ?? ''),
      event.data.data()
    );
  }
);

export const syncCommunityAdminTimelineOfficialAssociationAudit =
  onDocumentCreated(
    {
      document: 'community_official_association_audit/{auditId}',
      region: FUNCTIONS_REGION,
    },
    async (event) => {
      if (!event.data) return;
      await projectAudit(
        'official_association',
        String(event.params['auditId'] ?? ''),
        event.data.data()
      );
    }
  );

export const syncCommunityAdminTimelineLifecycleAudit = onDocumentCreated(
  {
    document: 'community_lifecycle_audit/{auditId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    if (!event.data) return;
    await projectAudit(
      'lifecycle',
      String(event.params['auditId'] ?? ''),
      event.data.data()
    );
  }
);
