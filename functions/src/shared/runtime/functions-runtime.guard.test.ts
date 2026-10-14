import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertExternalPaymentEgressAllowed,
  isFunctionsEmulatorRuntime,
} from './functions-runtime.guard';

test('external payment egress remains permitted in cloud runtime', () => {
  const before = process.env.FUNCTIONS_EMULATOR;
  try {
    delete process.env.FUNCTIONS_EMULATOR;
    assert.equal(isFunctionsEmulatorRuntime(), false);
    assert.doesNotThrow(() => assertExternalPaymentEgressAllowed());
    process.env.FUNCTIONS_EMULATOR = 'false';
    assert.doesNotThrow(() => assertExternalPaymentEgressAllowed());
  } finally {
    if (before === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = before;
  }
});

test('external payment egress is blocked in Functions Emulator', () => {
  const before = process.env.FUNCTIONS_EMULATOR;
  try {
    process.env.FUNCTIONS_EMULATOR = 'true';
    assert.equal(isFunctionsEmulatorRuntime(), true);
    assert.throws(
      () => assertExternalPaymentEgressAllowed(),
      /external_payment_egress_blocked_in_emulator/
    );
  } finally {
    if (before === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = before;
  }
});
