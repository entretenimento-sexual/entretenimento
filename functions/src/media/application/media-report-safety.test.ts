import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMediaReportSafetyState,
  isCriticalMinorMediaSafetyReason,
  normalizeMinorMediaSafetyReason,
  shouldPreserveMediaEvidence,
  shouldQuarantineMediaAfterReport,
} from './media-report-safety';

describe('media-report-safety', () => {
  it('normaliza somente motivos de proteção de menores próprios de Media', () => {
    assert.equal(
      normalizeMinorMediaSafetyReason('minor_exposure_safety'),
      'minor_exposure_safety'
    );
    assert.equal(
      normalizeMinorMediaSafetyReason('minor_content_safety'),
      'minor_content_safety'
    );
    assert.equal(normalizeMinorMediaSafetyReason('minor_safety'), null);
    assert.equal(normalizeMinorMediaSafetyReason('nudity'), null);
  });

  it('trata exposição de criança/adolescente em mídia adulta como crítica', () => {
    assert.equal(isCriticalMinorMediaSafetyReason('minor_exposure_safety'), true);
    assert.equal(
      shouldQuarantineMediaAfterReport('minor_exposure_safety', 1),
      true
    );
    assert.equal(shouldPreserveMediaEvidence('minor_exposure_safety'), true);
  });

  it('trata possível conteúdo sexual ou íntimo envolvendo menor como crítico', () => {
    assert.equal(isCriticalMinorMediaSafetyReason('minor_content_safety'), true);
    assert.equal(
      shouldQuarantineMediaAfterReport('minor_content_safety', 1),
      true
    );
    assert.equal(shouldPreserveMediaEvidence('minor_content_safety'), true);
  });

  it('não transforma conteúdo adulto comum em risco por ausência de sinal de menor', () => {
    assert.equal(shouldQuarantineMediaAfterReport('privacy', 1), false);
    assert.equal(shouldQuarantineMediaAfterReport('spam', 2), false);
  });

  it('mantém limiar antifraude para denúncias gerais', () => {
    assert.equal(shouldQuarantineMediaAfterReport('privacy', 3), true);
  });

  it('mantém contadores de segurança independentes da autoridade etária do perfil', () => {
    assert.deepEqual(buildMediaReportSafetyState({}, 'OPEN'), {
      reportsCount: 1,
      openReportsCount: 1,
      confirmedReportsCount: 0,
      safetyScore: 92,
    });
  });
});
