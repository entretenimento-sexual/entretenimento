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

export type AccountDataDeletionOrchestratorAdapter =
  AccountDataDeletionAdapter & AccountOwnedMediaDeletionAdapter;

export async function executeAccountDataDeletionDomains(
  adapter: AccountDataDeletionOrchestratorAdapter,
  input: ExecuteAccountDataDeletionInput
): Promise<AccountDataDeletionExecutionSummary> {
  const coreSummary = await executeCoreAccountDataDeletionDomains(adapter, input);
  const ownedMedia = await executeOwnedMediaAndStorageDomain(adapter, {
    uid: input.uid,
    pageSize: input.pageSize,
    maxPagesPerStep: input.maxPagesPerDomain,
  });
  const results = [...coreSummary.results, ownedMedia];
  const completedDomains = results
    .filter((result) => result.status === 'completed')
    .map((result) => result.domain);

  return {
    ...coreSummary,
    completedDomains: [...new Set(completedDomains)],
    results,
  };
}
