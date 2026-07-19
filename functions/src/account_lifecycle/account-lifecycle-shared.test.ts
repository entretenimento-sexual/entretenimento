import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_LIFECYCLE_REASON_LENGTH,
  assertRecentAuthentication,
  normalizeOptionalReason,
  normalizeRequiredReason,
} from './_shared';

describe('account lifecycle shared guards', () => {
  it('aceita autenticação recente', () => {
    const nowSeconds = Math.floor(Date.now() / 1_000);

    assert.doesNotThrow(() =>
      assertRecentAuthentication({ auth_time: nowSeconds - 30 })
    );
  });

  it('rejeita sessão antiga ou sem auth_time', () => {
    const nowSeconds = Math.floor(Date.now() / 1_000);

    assert.throws(() =>
      assertRecentAuthentication({ auth_time: nowSeconds - 601 })
    );
    assert.throws(() => assertRecentAuthentication({}));
  });

  it('normaliza espaços e caracteres de controle do motivo', () => {
    assert.equal(
      normalizeOptionalReason('  pausa\n\t pessoal  '),
      'pausa pessoal'
    );
  });

  it('rejeita motivo acima do limite', () => {
    assert.throws(() =>
      normalizeOptionalReason('a'.repeat(MAX_LIFECYCLE_REASON_LENGTH + 1))
    );
  });

  it('exige motivo nos fluxos administrativos', () => {
    assert.throws(() => normalizeRequiredReason('   '));
    assert.equal(normalizeRequiredReason('violação confirmada'), 'violação confirmada');
  });
});
