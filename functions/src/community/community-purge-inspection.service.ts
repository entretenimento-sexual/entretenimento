// functions/src/community/community-purge-inspection.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY PURGE INSPECTION SERVICE
// -----------------------------------------------------------------------------
// Consolida a leitura somente-leitura usada pelo diagnóstico administrativo e
// pelo dry-run agendado. Não executa exclusão nem altera lifecycle/configuração.
// O scheduler pode injetar snapshots já carregados para evitar leituras repetidas.
// -----------------------------------------------------------------------------

import { db } from '../firebaseApp';
import { hasCommunityLifecycleHold } from './community-lifecycle.policy';
import { readCommunityPurgeEvidence } from './community-purge-readiness.service';
import {
  resolveCommunityPurgeScheduleOptions,
  type CommunityPurgeScheduleMode,
} from './community-purge-schedule.policy';
import {
  evaluateCommunityPurgeReadiness,
  resolveCommunityPurgeGraceDays,
  type CommunityPurgeDenialReason,
} from './community-purge.policy';

export interface CommunityPurgeInspection {
  communityId: string;
  eligible: boolean;
  denialReason: CommunityPurgeDenialReason | null;
  purgeEligibleAt: number | null;
  graceDays: number;
  schedulerMode: CommunityPurgeScheduleMode;
  snapshot: {
    sourceType: string | null;
    status: string | null;
    ownerReleased: boolean;
    memberCount: number | null;
    retentionHold: boolean;
  };
  evidence: {
    hasLiveMemberships: boolean | null;
    hasRetainedContent: boolean | null;
    hasModerationEvidence: boolean | null;
    failedProbes: readonly string[];
  };
  generatedAt: number;
}

export interface CommunityPurgeInspectionContext {
  now?: number;
  community?: unknown;
  config?: unknown;
}

export async function readCommunityPurgeInspection(
  communityId: string,
  context: CommunityPurgeInspectionContext = {}
): Promise<CommunityPurgeInspection | null> {
  const now = typeof context.now === 'number' && Number.isFinite(context.now)
    ? Math.trunc(context.now)
    : Date.now();

  const communitySnapshotPromise = context.community === undefined
    ? db.collection('communities').doc(communityId).get()
    : null;
  const configSnapshotPromise = context.config === undefined
    ? db.collection('platform_config').doc('community').get()
    : null;

  const [communitySnapshot, configSnapshot] = await Promise.all([
    communitySnapshotPromise,
    configSnapshotPromise,
  ]);

  if (communitySnapshot && !communitySnapshot.exists) return null;

  const community = context.community !== undefined
    ? normalizeRecord(context.community)
    : normalizeRecord(communitySnapshot?.data());
  const config = context.config !== undefined
    ? normalizeRecord(context.config)
    : normalizeRecord(configSnapshot?.data());
  const evidenceRead = await readCommunityPurgeEvidence(communityId);
  const graceDays = resolveCommunityPurgeGraceDays(config);
  const decision = evaluateCommunityPurgeReadiness(
    community,
    evidenceRead.evidence,
    now,
    graceDays
  );
  const scheduleOptions = resolveCommunityPurgeScheduleOptions(config);
  const source = normalizeRecord(community['source']);
  const metrics = normalizeRecord(community['metrics']);

  return {
    communityId,
    eligible: decision.eligible,
    denialReason: decision.denialReason,
    purgeEligibleAt: decision.purgeEligibleAt,
    graceDays,
    schedulerMode: scheduleOptions.mode,
    snapshot: {
      sourceType: typeof source['type'] === 'string' ? source['type'] : null,
      status: typeof community['status'] === 'string' ? community['status'] : null,
      ownerReleased: String(community['ownerUid'] ?? '').trim().length === 0,
      memberCount: normalizeOptionalCount(metrics['memberCount']),
      retentionHold: hasCommunityLifecycleHold(community),
    },
    evidence: {
      ...evidenceRead.evidence,
      failedProbes: evidenceRead.failedProbes,
    },
    generatedAt: now,
  };
}

function normalizeOptionalCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
