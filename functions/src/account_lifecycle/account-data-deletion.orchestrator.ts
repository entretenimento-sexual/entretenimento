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
  type AccountDataDeletionExecutionSummary,
  type ExecuteAccountDataDeletionInput,
} from './account-data-deletion.executor';
import {
  executeOwnedMediaAndStorageDomain,
  type AccountOwnedMediaDeletionAdapter,
} from './account-owned-media-deletion.executor';
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

export async function executeAccountDataDeletionDomains(
  adapter: AccountDataDeletionOrchestratorAdapter,
  input: ExecuteAccountDataDeletionInput,
  sharedPublicationAdapter: AccountSharedPublicationAnonymizationAdapter =
  defaultSharedPublicationAdapter
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
      sharedPublicationAdapter,
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
  const ownedMedia = await executeOwnedMediaAndStorageDomain(adapter, {
    uid: input.uid,
    pageSize: input.pageSize,
    maxPagesPerStep: input.maxPagesPerDomain,
  });
  const results = [
    sharedMessages,
    sharedPublications,
    ...coreSummary.results,
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
