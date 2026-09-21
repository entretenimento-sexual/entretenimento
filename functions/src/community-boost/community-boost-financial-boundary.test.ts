import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(file: string): string {
  return readFileSync(
    path.resolve(process.cwd(), 'src', 'community-boost', file),
    'utf8'
  );
}

test('faturamento patrocinado nasce no placement server-side', () => {
  const selection = source('community-boost-selection.service.ts');

  assert.equal(selection.includes("billingReason: 'served_placement'"), true);
  assert.equal(selection.includes("collection('billing_ledger')"), true);
  assert.equal(selection.includes('spentMilliCents: nextSpentMilliCents'), true);
  assert.equal(selection.includes('rateCpmCentsSnapshot'), true);
});

test('evento cliente não altera budget, rate ou ledger financeiro', () => {
  const eventHandler = source('./record-community-boost-event.handler.ts');

  for (const forbidden of [
    "collection('billing_ledger')",
    'spentMilliCents',
    'dailySpentMilliCents',
    'rateCpmCentsSnapshot',
  ]) {
    assert.equal(
      eventHandler.includes(forbidden),
      false,
      `evento cliente contém autoridade financeira indevida: ${forbidden}`
    );
  }

  assert.equal(eventHandler.includes('qualifiedExposureCount'), true);
  assert.equal(eventHandler.includes('clickCount'), true);
});
