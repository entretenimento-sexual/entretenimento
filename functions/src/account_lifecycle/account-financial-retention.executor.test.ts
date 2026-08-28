import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeFinancialRetentionDomain,
  type AccountFinancialRetentionAdapter,
  type FinancialPartyField,
  type FinancialRetentionPageSummary,
} from './account-financial-retention.executor';

const EMPTY_PAGE: FinancialRetentionPageSummary = { processed: 0 };

class FakeFinancialRetentionAdapter
implements AccountFinancialRetentionAdapter
{
  checkouts: Record<FinancialPartyField, FinancialRetentionPageSummary[]> = {
    buyerUid: [{ ...EMPTY_PAGE }],
    sellerUid: [{ ...EMPTY_PAGE }],
  };
  transactions: Record<FinancialPartyField, FinancialRetentionPageSummary[]> = {
    buyerUid: [{ ...EMPTY_PAGE }],
    sellerUid: [{ ...EMPTY_PAGE }],
  };
  entitlements: Record<FinancialPartyField, FinancialRetentionPageSummary[]> = {
    buyerUid: [{ ...EMPTY_PAGE }],
    sellerUid: [{ ...EMPTY_PAGE }],
  };
  audits: Record<FinancialPartyField, FinancialRetentionPageSummary[]> = {
    buyerUid: [{ ...EMPTY_PAGE }],
    sellerUid: [{ ...EMPTY_PAGE }],
  };
  error: unknown = null;

  async retainCheckoutSessionsPage(
    _uid: string,
    field: FinancialPartyField
  ): Promise<FinancialRetentionPageSummary> {
    if (this.error) throw this.error;
    return this.checkouts[field].shift() ?? { ...EMPTY_PAGE };
  }

  async retainPaymentTransactionsPage(
    _uid: string,
    field: FinancialPartyField
  ): Promise<FinancialRetentionPageSummary> {
    return this.transactions[field].shift() ?? { ...EMPTY_PAGE };
  }

  async archiveEntitlementsPage(
    _uid: string,
    field: FinancialPartyField
  ): Promise<FinancialRetentionPageSummary> {
    return this.entitlements[field].shift() ?? { ...EMPTY_PAGE };
  }

  async retainBillingAuditPage(
    _uid: string,
    field: FinancialPartyField
  ): Promise<FinancialRetentionPageSummary> {
    return this.audits[field].shift() ?? { ...EMPTY_PAGE };
  }
}

test('financial retention cancels pending access and preserves audit records', async () => {
  const adapter = new FakeFinancialRetentionAdapter();
  adapter.checkouts.buyerUid = [
    { processed: 2, pendingCheckoutsCanceled: 1 },
  ];
  adapter.transactions.buyerUid = [{ processed: 3 }];
  adapter.transactions.sellerUid = [{ processed: 1 }];
  adapter.entitlements.buyerUid = [
    {
      processed: 1,
      entitlementsArchived: 1,
      entitlementsRevoked: 1,
    },
  ];
  adapter.audits.buyerUid = [{ processed: 2 }];

  const result = await executeFinancialRetentionDomain(adapter, {
    uid: 'billing-user',
    pageSize: 20,
    maxPagesPerStep: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.processed, 9);
  assert.deepEqual(result.details, {
    checkoutReferencesRetained: 2,
    pendingCheckoutsCanceled: 1,
    transactionReferencesRetained: 4,
    entitlementsArchived: 1,
    entitlementsRevoked: 1,
    billingAuditReferencesRetained: 2,
    paymentEventsRetainedWithoutDirectUid: true,
    externalRecurringSubscriptionsCanceled: 0,
    walletLedgerRecordsProcessed: 0,
    payoutAccountsProcessed: 0,
  });
});

test('financial retention remains partial at pagination limit', async () => {
  const adapter = new FakeFinancialRetentionAdapter();
  adapter.checkouts.buyerUid = [
    { processed: 2, pendingCheckoutsCanceled: 1 },
    { processed: 2, pendingCheckoutsCanceled: 1 },
  ];

  const result = await executeFinancialRetentionDomain(adapter, {
    uid: 'billing-pagination-user',
    pageSize: 2,
    maxPagesPerStep: 2,
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.blocker, 'pagination-limit-reached');
  assert.equal(result.details?.['checkoutReferencesRetained'], 4);
  assert.equal(result.details?.['pendingCheckoutsCanceled'], 2);
});

test('financial retention isolates adapter failures', async () => {
  const adapter = new FakeFinancialRetentionAdapter();
  adapter.error = Object.assign(new Error('billing unavailable'), {
    code: 'firestore/unavailable',
  });

  const result = await executeFinancialRetentionDomain(adapter, {
    uid: 'billing-error-user',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'firestore/unavailable');
  assert.equal(result.details?.['errorMessage'], 'billing unavailable');
});

test('invalid uid fails before financial queries', async () => {
  const adapter = new FakeFinancialRetentionAdapter();

  const result = await executeFinancialRetentionDomain(adapter, {
    uid: '../invalid',
  });

  assert.equal(result.status, 'failed');
  assert.deepEqual(adapter.checkouts.buyerUid, [{ ...EMPTY_PAGE }]);
  assert.deepEqual(adapter.transactions.buyerUid, [{ ...EMPTY_PAGE }]);
  assert.deepEqual(adapter.entitlements.buyerUid, [{ ...EMPTY_PAGE }]);
});
