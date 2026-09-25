import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAccountLifecycleSubscriptionRenewalStatus,
} from './account-lifecycle-billing.service';

test('prioriza obrigação local de cancelamento ainda pendente', () => {
  assert.equal(
    resolveAccountLifecycleSubscriptionRenewalStatus({
      billingCancellationPending: true,
      currentContractId: 'contract-1',
      stateRenewalEnabled: false,
      contractExists: true,
      contractData: {
        needsProviderCancellation: false,
        providerCancellationNextAttemptAt: null,
      },
    }),
    'pending'
  );
});

test('mantém pending enquanto provider ainda precisa cancelar a recorrência', () => {
  assert.equal(
    resolveAccountLifecycleSubscriptionRenewalStatus({
      billingCancellationPending: false,
      currentContractId: 'contract-1',
      stateRenewalEnabled: false,
      contractExists: true,
      contractData: {
        needsProviderCancellation: true,
        providerCancellationNextAttemptAt: 1_900_000_000_000,
      },
    }),
    'pending'
  );
});

test('contrato apontado mas ausente permanece fail closed como pending', () => {
  assert.equal(
    resolveAccountLifecycleSubscriptionRenewalStatus({
      billingCancellationPending: false,
      currentContractId: 'contract-missing',
      stateRenewalEnabled: false,
      contractExists: false,
      contractData: null,
    }),
    'pending'
  );
});

test('retorna canceled somente após convergência externa sem retry pendente', () => {
  assert.equal(
    resolveAccountLifecycleSubscriptionRenewalStatus({
      billingCancellationPending: false,
      currentContractId: 'contract-1',
      stateRenewalEnabled: false,
      contractExists: true,
      contractData: {
        needsProviderCancellation: false,
        providerCancellationNextAttemptAt: null,
      },
    }),
    'canceled'
  );
});

test('retorna active apenas quando state mantém renovação habilitada', () => {
  assert.equal(
    resolveAccountLifecycleSubscriptionRenewalStatus({
      billingCancellationPending: false,
      currentContractId: 'contract-1',
      stateRenewalEnabled: true,
      contractExists: true,
      contractData: {
        needsProviderCancellation: false,
        providerCancellationNextAttemptAt: null,
      },
    }),
    'active'
  );
});

test('sem contrato recorrente retorna none', () => {
  assert.equal(
    resolveAccountLifecycleSubscriptionRenewalStatus({
      billingCancellationPending: false,
      currentContractId: null,
      stateRenewalEnabled: false,
      contractExists: false,
      contractData: null,
    }),
    'none'
  );
});
