import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_RESPONSE_WINDOW_MS,
  normalizeComplianceCategory,
  normalizeComplianceText,
  normalizeResponseDueAt,
} from './compliance-case.shared';

describe('compliance case validation', () => {
  it('normaliza categoria e texto sem caracteres de controle', () => {
    assert.equal(
      normalizeComplianceCategory(' account_integrity '),
      'ACCOUNT_INTEGRITY'
    );
    assert.equal(
      normalizeComplianceText('  fato\n\t objetivo confirmado  ', 'Resumo', 10, 80),
      'fato objetivo confirmado'
    );
  });

  it('rejeita categoria e tamanho inválidos', () => {
    assert.throws(() => normalizeComplianceCategory('UNKNOWN'));
    assert.throws(() => normalizeComplianceText('curto', 'Resumo', 10, 80));
  });

  it('aplica prazo padrão e limites de 1 a 30 dias', () => {
    const now = 1_800_000_000_000;

    assert.equal(
      normalizeResponseDueAt(null, now),
      now + DEFAULT_RESPONSE_WINDOW_MS
    );
    assert.throws(() =>
      normalizeResponseDueAt(now + 60 * 60 * 1_000, now)
    );
    assert.throws(() =>
      normalizeResponseDueAt(now + 31 * 24 * 60 * 60 * 1_000, now)
    );
  });
});
