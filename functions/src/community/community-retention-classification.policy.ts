// functions/src/community/community-retention-classification.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY RETENTION CLASSIFICATION
// -----------------------------------------------------------------------------
// Matriz canônica de retenção do domínio Comunidades:
// - lifecycleProjection: read-model vivo; acompanha a fonte canônica/purge;
// - ttlOperational: receipt/artefato operacional com retenção finita;
// - rollingTelemetry: observabilidade agregada com janela própria;
// - durableEvidence: auditoria/evidência que não participa de TTL nem purge.
// -----------------------------------------------------------------------------

import {
  COMMUNITY_OPERATIONAL_REQUEST_COLLECTIONS,
} from './community-operational-retention.policy';
import {
  COMMUNITY_PURGE_MEMBER_SCOPED_COLLECTIONS,
  COMMUNITY_PURGE_PROJECTION_ROOT_COLLECTIONS,
  COMMUNITY_PURGE_PROTECTED_COLLECTIONS,
} from './community-purge.firestore.policy';

export const COMMUNITY_RETENTION_CLASSIFICATION = Object.freeze({
  lifecycleProjection: Object.freeze([
    ...COMMUNITY_PURGE_PROJECTION_ROOT_COLLECTIONS,
    ...COMMUNITY_PURGE_MEMBER_SCOPED_COLLECTIONS,
    'community_user_index',
  ]),
  ttlOperational: Object.freeze([
    ...Object.keys(COMMUNITY_OPERATIONAL_REQUEST_COLLECTIONS),
    'invites',
  ]),
  rollingTelemetry: Object.freeze([
    'community_discovery_exposure_daily',
  ]),
  durableEvidence: COMMUNITY_PURGE_PROTECTED_COLLECTIONS,
});
