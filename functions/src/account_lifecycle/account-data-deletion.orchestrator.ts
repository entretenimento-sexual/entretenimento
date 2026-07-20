// functions/src/account_lifecycle/account-data-deletion.orchestrator.ts
// -----------------------------------------------------------------------------
// ACCOUNT DATA DELETION ORCHESTRATOR
// -----------------------------------------------------------------------------
// Preserva o nome público do executor e compõe os domínios especializados sem
// ampliar o contrato do adapter histórico de forma abrupta.
// -----------------------------------------------------------------------------
import {
  executeAccountDataDeletionDomains as executeCoreAccountDataDeletionDomains,
  type AccountDataDeletionAdapter,
  type AccountDataDeletionDomainExecution,
  type AccountDataDeletionExecutionSummary,
  type ExecuteAccountDataDeletionInput,
} from './account-data-deletion.executor';
import {
  executeFinancialRetentionDomain,
  type AccountFinancialRetentionAdapter,
} from './account-financial-retention.executor';
import {
  FirestoreAccountFinancialRetentionAdapter,
} from './account-financial-retention.firestore';
import {
  executeModerationEvidenceRetentionDomain,
  type AccountModerationEvidenceRetentionAdapter,
} from './account-moderation-evidence-retention.executor';
import {
  FirestoreAccountModerationEvidenceRetentionAdapter,
} from './account-moderation-evidence-retention.firestore';
import {
  executeOwnedMediaAndStorageDomain,
  type AccountOwnedMediaDeletionAdapter,
} from './account-owned-media-deletion.executor';
import {
  executeRelationshipEdgeRetentionDomain,
  type AccountRelationshipEdgeRetentionAdapter,
} from './account-relationship-edge-retention.executor';
import {
  FirestoreAccountRelationshipEdgeRetentionAdapter,
} from './account-relationship-edge-retention.firestore';
import {
  executeSharedMessageAnonymizationDomain,
  type AccountSharedMessageAnonymizationAdapter,
} from './account-shared-message-anonymization.executor';
import {
  executeSharedPublicationAnonymizationDomain,
  type AccountSharedPublicationAnonymizationAdapter,
} from './account-shared-publication-anonymization.executor';
import {
  FirestoreAccountSharedPublicationAnonymizationAdapter,
} from './account-shared-publication-anonymization.firestore';

export type AccountDataDeletionOrchestratorAdapter =
  AccountDataDeletionAdapter &
  AccountOwnedMediaDeletionAdapter &
  AccountSharedMessageAnonymizationAdapter;

const defaultSharedPublicationAdapter =
  new FirestoreAccountSharedPublicationAnonymizationAdapter();
const defaultRelationshipEdgeAdapter =
  new FirestoreAccountRelationshipEdgeRetentionAdapter();
const defaultModerationEvidenceAdapter =
  new FirestoreAccountModerationEvidenceRetentionAdapter();
const defaultFinancialRetentionAdapter =
  new FirestoreAccountFinancialRetentionAdapter();

export async function executeAccountDataDeletionDomains(
  adapter: AccountDataDeletionOrchestratorAdapter,
  input: ExecuteAccountDataDeletionInput,
  sharedPublicationAdapter?: AccountSharedPublicationAnonymizationAdapter,
  relationshipEdgeAdapter?: AccountRelationshipEdgeRetentionAdapter,
  moderationEvidenceAdapter?: AccountModerationEvidenceRetentionAdapter,
  financialRetentionAdapter?: AccountFinancialRetentionAdapter
): Promise<AccountDataDeletionExecutionSummary> {
  const sharedMessages = await executeSharedMessageAnonymizationDomain(
    adapter,
    {
      uid: input.uid,
      pageSize: input.pageSize,
      maxPagesPerStep: input.maxPagesPerDomain,
    }
  );
  const sharedPublications =
    await executeSharedPublicationAnonymizationDomain(
      sharedPublicationAdapter ?? defaultSharedPublicationAdapter,
      {
        uid: input.uid,
        pageSize: input.pageSize,
        maxPagesPerStep: input.maxPagesPerDomain,
      }
    );
  const coreSummary = await executeCoreAccountDataDeletionDomains(
    adapter,
    input
  );
  const relationshipRetention = await executeRelationshipEdgeRetentionDomain(
    relationshipEdgeAdapter ?? defaultRelationshipEdgeAdapter,
    {
      uid: input.uid,
      pageSize: input.pageSize,
      maxPagesPerDirection: input.maxPagesPerDomain,
    }
  );
  const moderationEvidence = await executeModerationEvidenceRetentionDomain(
    moderationEvidenceAdapter ?? defaultModerationEvidenceAdapter,
    {
      uid: input.uid,
      pageSize: input.pageSize,
      maxPagesPerStep: input.maxPagesPerDomain,
    }
  );
  const financialRetention = await executeFinancialRetentionDomain(
    financialRetentionAdapter ?? defaultFinancialRetentionAdapter,
    {
      uid: input.uid,
      pageSize: input.pageSize,
      maxPagesPerStep: input.maxPagesPerDomain,
    }
  );
  const legacyRelationship = coreSummary.results.find(
    (result) => result.domain === 'relationship_edges'
  );
  const relationshipEdges = mergeRelationshipEdgeResults(
    legacyRelationship,
    relationshipRetention
  );
  const ownedMedia = await executeOwnedMediaAndStorageDomain(adapter, {
    uid: input.uid,
    pageSize: input.pageSize,
    maxPagesPerStep: input.maxPagesPerDomain,
  });
  const coreResultsWithoutRelationship = coreSummary.results.filter(
    (result) => result.domain !== 'relationship_edges'
  );
  const results = [
    sharedMessages,
    sharedPublications,
    moderationEvidence,
    financialRetention,
    ...coreResultsWithoutRelationship,
    relationshipEdges,
    ownedMedia,
  ];
  const completedDomains = results
    .filter((result) => result.status === 'completed')
    .map((result) => result.domain);

  return {
    ...coreSummary,
    completedDomains: [...new Set(completedDomains)],
    results,
  };
}

function mergeRelationshipEdgeResults(
  legacy: AccountDataDeletionDomainExecution | undefined,
  retention: AccountDataDeletionDomainExecution
): AccountDataDeletionDomainExecution {
  if (!legacy) return retention;

  const details = {
    ...(legacy.details ?? {}),
    ...(retention.details ?? {}),
  };
  const common = {
    domain: 'relationship_edges' as const,
    processed: legacy.processed + retention.processed,
    pages: legacy.pages + retention.pages,
    details,
  };

  if (legacy.status === 'failed' || legacy.status === 'partial') {
    return {
      ...common,
      status: legacy.status,
      ...(legacy.blocker ? { blocker: legacy.blocker } : {}),
      ...(legacy.errorCode ? { errorCode: legacy.errorCode } : {}),
    };
  }

  if (retention.status !== 'completed') {
    return {
      ...common,
      status: retention.status,
      ...(retention.blocker ? { blocker: retention.blocker } : {}),
      ...(retention.errorCode ? { errorCode: retention.errorCode } : {}),
    };
  }

  if (
    legacy.status === 'blocked' &&
    legacy.blocker !== 'block-event-retention-contract-required'
  ) {
    return {
      ...common,
      status: 'blocked',
      ...(legacy.blocker ? { blocker: legacy.blocker } : {}),
    };
  }

  return {
    ...common,
    status: 'completed',
  };
}
